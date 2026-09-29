import { notificationsApi } from '../api/client';

/**
 * The browser half of Web Push: permission, subscription, and the server
 * handshake. The server half (VAPID keys, delivery) lives in the push
 * transport; the service worker (`public/push-sw.js`) displays what arrives.
 *
 * Everything here must run from a user gesture (the settings toggle) —
 * `Notification.requestPermission` is ignored outside one on both major
 * engines, and the permission prompt is the gate the whole channel sits behind.
 */

/** The subscription shape `pushManager.subscribe` resolves with, flattened. */
export interface PushSubscriptionState {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** RFC 8292: the VAPID public key arrives base64url; the API wants bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Explicit ArrayBuffer: `subscribe` wants a BufferSource, and a plain
  // Uint8Array is typed over ArrayBufferLike (SharedArrayBuffer included).
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Current channel state, without prompting for anything. */
export async function pushState(): Promise<PushSubscriptionState> {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };

  const permission = Notification.permission;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return { supported: true, permission, subscribed: !!subscription };
}

/**
 * Ask, subscribe, and hand the subscription to the server.
 * Call from a click handler.
 */
export async function subscribeToPush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, error: 'denied' };

  try {
    // The Workbox SW drives the whole offline strategy; push rides on it.
    const registration = await navigator.serviceWorker.ready;
    const { publicKey } = await notificationsApi.getPushPublicKey();

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    const json = subscription.toJSON();
    const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string };
    if (!json.endpoint || !keys.p256dh || !keys.auth) {
      return { ok: false, error: 'The browser returned an incomplete subscription' };
    }

    await notificationsApi.subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: navigator.userAgent,
    });
    return { ok: true };
  } catch (err) {
    // A rejected key (wrong/stale VAPID public key) and a blocked permission
    // both land here; the message text is the caller's i18n decision.
    return { ok: false, error: err instanceof Error ? err.message : 'subscribe failed' };
  }
}

/** Unsubscribe locally and drop the server row. Idempotent. */
export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});
    await notificationsApi.unsubscribePush({ endpoint }).catch(() => {});
  }
}
