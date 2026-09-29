import { Injectable } from '@nestjs/common';
import { getAppUrl, readEnv } from '../../../app-config';
import { DatabaseService } from '../../database/database.service';
import { maybe_encrypt_api_key, decrypt_api_key } from '../../common/crypto/apiKeyCrypto';
import { generateVAPIDKeys, sendNotification, type VapidKeys } from 'web-push';

/**
 * The Web Push transport: VAPID key management, subscription storage, and the
 * sender the `push` channel wraps.
 *
 * Everything here is server-to-push-service. The browser half (permission
 * request, `pushManager.subscribe`, the SW `push` handler) lives in the client;
 * the two meet at the subscription row this service stores.
 */

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const VAPID_PUBLIC_KEY = 'push_vapid_public_key';
const VAPID_PRIVATE_KEY = 'push_vapid_private_key';

/**
 * Push payloads are small (most push services cap near 4 KB) and the SW only
 * needs what it will show and where a tap should land. `tag` collapses bursts
 * of the same event (ten chat messages → one notification that updates in
 * place) instead of stacking a pile on the lock screen.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** Relative navigate target (e.g. `/trips/12`) — the SW resolves it against the app origin. */
  navigateTarget?: string;
  event?: string;
}

@Injectable()
export class PushService {
  /** Memoized so concurrent sends do not each re-derive the keys. */
  private vapidCache: VapidKeys | null = null;

  constructor(private readonly db: DatabaseService) {}

  // ── VAPID keys ─────────────────────────────────────────────────────────────

  /**
   * The instance's VAPID identity: an operator-provided pair from
   * PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY wins, otherwise the pair
   * persisted in app_settings, minted on first use. Both env halves must be
   * set (a public key alone can't sign anything); setting them after
   * subscriptions exist orphans those bound to the previous pair.
   *
   * A push endpoint is useless without a stable key pair — the browser binds its
   * subscription to the public key at subscribe time, and every later send must
   * sign with the matching private key. The pair therefore lives in app_settings
   * (private key under the same encryption envelope as the other settings
   * secrets) and never changes once minted: rotating it would silently orphan
   * every existing subscription, which is a migration-grade decision, not a
   * side effect of a restart.
   */
  getVapidKeys(): VapidKeys {
    // readEnv() is live per repo convention, so an env toggle takes effect
    // without restarting (and tests can set the pair at will).
    const env = readEnv().push;
    if (env.vapidPublicKey && env.vapidPrivateKey) {
      return { publicKey: env.vapidPublicKey, privateKey: env.vapidPrivateKey };
    }

    if (this.vapidCache) return this.vapidCache;

    let publicKey = this.db.get<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      VAPID_PUBLIC_KEY,
    )?.value;
    let privateKeyEnc = this.db.get<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      VAPID_PRIVATE_KEY,
    )?.value;

    if (!publicKey || !privateKeyEnc) {
      // No pair yet — mint one, store it, and reuse the stored envelope so the
      // encryption is applied in exactly one place.
      const fresh = generateVAPIDKeys();
      privateKeyEnc = maybe_encrypt_api_key(fresh.privateKey);
      this.db.transaction(() => {
        this.db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', VAPID_PUBLIC_KEY, fresh.publicKey);
        this.db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', VAPID_PRIVATE_KEY, privateKeyEnc);
      });
      publicKey = fresh.publicKey;
    }

    const privateKey = decrypt_api_key(privateKeyEnc);
    if (!privateKey) throw new Error('Failed to decrypt the VAPID private key');
    this.vapidCache = { publicKey, privateKey };
    return this.vapidCache;
  }

  /** The only half the browser may see. */
  getPublicKey(): string {
    return this.getVapidKeys().publicKey;
  }

  /** VAPID requires a contact URI; the instance's own URL is the honest one. */
  private subject(): string {
    try {
      const url = getAppUrl();
      return url ? `mailto:admin@${new URL(url).hostname}` : 'mailto:admin@tt.local';
    } catch {
      return 'mailto:admin@tt.local';
    }
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  /** Upsert by endpoint — a browser re-subscribing replaces its own row. */
  saveSubscription(
    userId: number,
    sub: { endpoint: string; p256dh: string; auth: string },
    userAgent?: string,
  ): void {
    this.db.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent`,
      userId,
      sub.endpoint,
      sub.p256dh,
      sub.auth,
      userAgent ?? null,
    );
  }

  removeSubscription(userId: number, endpoint: string): boolean {
    return this.db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', userId, endpoint)
      .changes > 0;
  }

  hasSubscription(userId: number): boolean {
    return (
      this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', userId)!.n > 0
    );
  }

  private subscriptionsFor(userId: number): PushSubscriptionRow[] {
    return this.db.all<PushSubscriptionRow>(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      userId,
    );
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  /**
   * Deliver one payload to every subscription the user holds.
   *
   * A 404/410 from the push service means the subscription is gone (browser
   * lost its push permission, the SW was unregistered, the endpoint expired) —
   * the row is dead weight, so it is pruned here rather than retried forever.
   * Any other failure is left in place: a transient 5xx from the push service
   * should not silently unsubscribe somebody.
   */
  async sendToUser(userId: number, payload: PushPayload): Promise<boolean> {
    const subs = this.subscriptionsFor(userId);
    if (subs.length === 0) return false;

    const keys = this.getVapidKeys();
    const options = {
      TTL: 4 * 60 * 60, // 4 h: a stale "booking changed" is worse than no push
      headers: { Urgency: 'normal' as const },
    };
    const body = JSON.stringify(payload);

    const results = await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            { ...options, vapidDetails: { subject: this.subject(), publicKey: keys.publicKey, privateKey: keys.privateKey } },
          );
          return true;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            this.db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', sub.endpoint);
            return false;
          }
          throw err;
        }
      }),
    );

    return results.some((r) => r.status === 'fulfilled' && r.value === true);
  }

  /** A test push the settings page can fire — proves the whole chain end to end. */
  async test(userId: number): Promise<{ success: boolean; error?: string }> {
    if (!this.hasSubscription(userId)) {
      return { success: false, error: 'No push subscription on this device (or none at all)' };
    }
    const ok = await this.sendToUser(userId, {
      title: 'TT',
      body: 'Test push notification — if you can read this on your lock screen, the channel works.',
      event: 'test',
    });
    return ok ? { success: true } : { success: false, error: 'Every subscription failed' };
  }
}
