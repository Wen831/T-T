import { createUser } from '../../helpers/factories';
import { createTestDb } from '../../helpers/test-db';
import { DatabaseService } from '../../../src/nest/database/database.service';
import { PushService } from '../../../src/nest/notifications/transports/push.service';
import type Database from 'better-sqlite3';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/db/database', () => ({
  db: { prepare: () => ({ get: vi.fn(() => undefined), all: vi.fn(() => []) }) },
}));
vi.mock('../../../src/nest/common/crypto/apiKeyCrypto', () => ({
  decrypt_api_key: vi.fn((v: string) => v),
  maybe_encrypt_api_key: vi.fn((v: string) => v),
}));

const generateVAPIDKeys = vi.fn(() => ({ publicKey: 'MINTED-PUB', privateKey: 'MINTED-PRIV' }));
const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  generateVAPIDKeys: () => generateVAPIDKeys(),
  sendNotification: (sub: unknown, body: unknown, opts: unknown) => sendNotification(sub, body, opts),
}));

const SUB = { endpoint: 'https://push.example/a', p256dh: 'P256', auth: 'AUTH' };

function makeService(testDb: Database.Database) {
  return new PushService(new DatabaseService(testDb as unknown as ConstructorParameters<typeof DatabaseService>[0]));
}

describe('PushService', () => {
  let testDb: Database.Database;
  let userId: number;
  let push: PushService;

  beforeEach(() => {
    testDb = createTestDb();
    userId = createUser(testDb).user.id;
    push = makeService(testDb);
    generateVAPIDKeys.mockClear();
    sendNotification.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    testDb.close();
  });

  // ── VAPID keys ─────────────────────────────────────────────────────────────

  describe('getVapidKeys', () => {
    it('mints a pair on first use and persists it to app_settings', () => {
      expect(push.getVapidKeys()).toEqual({ publicKey: 'MINTED-PUB', privateKey: 'MINTED-PRIV' });
      const stored = testDb
        .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'push_vapid_%' ORDER BY key")
        .all() as { key: string; value: string }[];
      expect(stored.map((r) => [r.key, r.value])).toEqual([
        ['push_vapid_private_key', 'MINTED-PRIV'],
        ['push_vapid_public_key', 'MINTED-PUB'],
      ]);
    });

    it('reuses the stored pair instead of re-minting (a restart must not orphan subscriptions)', () => {
      push.getVapidKeys();
      const fresh = makeService(testDb);
      expect(fresh.getVapidKeys()).toEqual({ publicKey: 'MINTED-PUB', privateKey: 'MINTED-PRIV' });
      expect(generateVAPIDKeys).toHaveBeenCalledTimes(1);
    });

    it('prefers a complete env pair over the stored one', () => {
      vi.stubEnv('PUSH_VAPID_PUBLIC_KEY', 'ENV-PUB');
      vi.stubEnv('PUSH_VAPID_PRIVATE_KEY', 'ENV-PRIV');
      expect(push.getVapidKeys()).toEqual({ publicKey: 'ENV-PUB', privateKey: 'ENV-PRIV' });
      expect(generateVAPIDKeys).not.toHaveBeenCalled();
    });

    it('ignores a half env pair (a public key alone cannot sign)', () => {
      vi.stubEnv('PUSH_VAPID_PUBLIC_KEY', 'ENV-PUB');
      expect(push.getVapidKeys()).toEqual({ publicKey: 'MINTED-PUB', privateKey: 'MINTED-PRIV' });
    });
  });

  // ── Subscriptions ──────────────────────────────────────────────────────────

  describe('subscriptions', () => {
    it('upserts by endpoint: re-subscribing refreshes the keys, not the row count', () => {
      push.saveSubscription(userId, SUB);
      push.saveSubscription(userId, { ...SUB, p256dh: 'P256-NEW' });
      const rows = testDb.prepare('SELECT * FROM push_subscriptions').all() as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0].p256dh).toBe('P256-NEW');
    });

    it('removeSubscription reports whether a row was actually deleted', () => {
      push.saveSubscription(userId, SUB);
      expect(push.removeSubscription(userId, SUB.endpoint)).toBe(true);
      expect(push.removeSubscription(userId, SUB.endpoint)).toBe(false);
    });

    it('cannot remove another user\'s subscription', () => {
      const otherId = createUser(testDb).user.id;
      push.saveSubscription(userId, SUB);
      expect(push.removeSubscription(otherId, SUB.endpoint)).toBe(false);
      expect(push.hasSubscription(userId)).toBe(true);
    });
  });

  // ── Sending ────────────────────────────────────────────────────────────────

  describe('sendToUser', () => {
    it('false without subscriptions, and nothing is sent', async () => {
      await expect(push.sendToUser(userId, { title: 'T', body: 'B' })).resolves.toBe(false);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('delivers the JSON payload with VAPID details to every subscription', async () => {
      push.saveSubscription(userId, SUB);
      push.saveSubscription(userId, { ...SUB, endpoint: 'https://push.example/b' });
      sendNotification.mockResolvedValue(undefined);

      await expect(push.sendToUser(userId, { title: 'T', body: 'B', navigateTarget: '/trips/9' })).resolves.toBe(true);
      expect(sendNotification).toHaveBeenCalledTimes(2);
      const [sub, body, opts] = sendNotification.mock.calls[0];
      expect(sub).toEqual({ endpoint: SUB.endpoint, keys: { p256dh: 'P256', auth: 'AUTH' } });
      expect(JSON.parse(body)).toEqual({ title: 'T', body: 'B', navigateTarget: '/trips/9' });
      expect(opts.vapidDetails).toEqual({
        subject: expect.stringMatching(/^mailto:/),
        publicKey: 'MINTED-PUB',
        privateKey: 'MINTED-PRIV',
      });
    });

    it('prunes a subscription the push service reports as gone (404/410)', async () => {
      push.saveSubscription(userId, SUB);
      sendNotification.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }));

      await expect(push.sendToUser(userId, { title: 'T', body: 'B' })).resolves.toBe(false);
      expect(push.hasSubscription(userId)).toBe(false);
    });

    it('keeps a subscription after a transient failure (5xx must not silently unsubscribe)', async () => {
      push.saveSubscription(userId, SUB);
      sendNotification.mockRejectedValue(Object.assign(new Error('Busy'), { statusCode: 503 }));

      await expect(push.sendToUser(userId, { title: 'T', body: 'B' })).resolves.toBe(false);
      expect(push.hasSubscription(userId)).toBe(true);
    });

    it('succeeds when at least one subscription takes delivery, pruning the dead one', async () => {
      push.saveSubscription(userId, SUB);
      push.saveSubscription(userId, { ...SUB, endpoint: 'https://push.example/dead' });
      sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
        if (sub.endpoint.endsWith('/dead')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      });

      await expect(push.sendToUser(userId, { title: 'T', body: 'B' })).resolves.toBe(true);
      const endpoints = (testDb.prepare('SELECT endpoint FROM push_subscriptions').all() as { endpoint: string }[]).map(
        (r) => r.endpoint,
      );
      expect(endpoints).toEqual([SUB.endpoint]);
    });
  });

  // ── Test send ──────────────────────────────────────────────────────────────

  describe('test', () => {
    it('reports failure without a subscription instead of sending', async () => {
      const result = await push.test(userId);
      expect(result.success).toBe(false);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('sends once subscribed', async () => {
      push.saveSubscription(userId, SUB);
      sendNotification.mockResolvedValue(undefined);
      await expect(push.test(userId)).resolves.toEqual({ success: true });
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });
  });
});
