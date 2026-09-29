import { getChannel } from '../../../src/nest/notifications/channel-registry';
import { buildBuiltinChannels, registerBuiltinChannels } from '../../../src/nest/notifications/channels/builtins';
import type { PushService } from '../../../src/nest/notifications/transports/push.service';
import type { ChannelMessage } from '../../../src/nest/notifications/notification-events';

import { describe, it, expect, vi } from 'vitest';

// builtins → ntfy.service pulls in the legacy db singleton; keep it out of the test process.
vi.mock('../../../src/db/database', () => ({
  db: { prepare: () => ({ get: vi.fn(() => undefined), all: vi.fn(() => []) }) },
}));

const msg: ChannelMessage = {
  event: 'trip_invite',
  title: 'Shared trip',
  body: 'Alice shared Tokyo with you',
  navigateTarget: '/trips/12',
};

function makePush() {
  return {
    hasSubscription: vi.fn().mockReturnValue(true),
    sendToUser: vi.fn().mockResolvedValue(true),
    test: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as PushService & {
    hasSubscription: ReturnType<typeof vi.fn>;
    sendToUser: ReturnType<typeof vi.fn>;
    test: ReturnType<typeof vi.fn>;
  };
}

describe('built-in push channel', () => {
  it('is registered under id "push" with the i18n label key', () => {
    const push = makePush();
    const channels = buildBuiltinChannels({ mailer: {}, webhook: {}, ntfy: {}, push } as never);
    const channel = channels.find((c) => c.id === 'push');
    expect(channel).toBeDefined();
    expect(channel!.labelKey).toBe('settings.notificationPreferences.push');
    expect(channel!.source).toBe('builtin');
  });

  it('never sends an admin-global copy (per-recipient path renders in their language)', () => {
    const channel = buildBuiltinChannels({ mailer: {}, webhook: {}, ntfy: {}, push: makePush() } as never).find(
      (c) => c.id === 'push',
    )!;
    expect(channel.supportsAdminGlobal).toBe(false);
    expect(channel.sendGlobal).toBeUndefined();
  });

  it('supportsEvent follows the built-in rule (everything but synology_session_cleared)', () => {
    const channel = buildBuiltinChannels({ mailer: {}, webhook: {}, ntfy: {}, push: makePush() } as never).find(
      (c) => c.id === 'push',
    )!;
    expect(channel.supportsEvent('trip_invite')).toBe(true);
    expect(channel.supportsEvent('synology_session_cleared')).toBe(false);
  });

  it('isConfiguredFor is the recipient\'s subscription state, not an instance credential', () => {
    const push = makePush();
    const channel = buildBuiltinChannels({ mailer: {}, webhook: {}, ntfy: {}, push } as never).find(
      (c) => c.id === 'push',
    )!;
    expect(channel.isConfiguredFor(7)).toBe(true);
    expect(push.hasSubscription).toHaveBeenCalledWith(7);
    expect(channel.isInstanceConfigured).toBeUndefined();
  });

  it('sendToUser forwards title/body/navigateTarget/event to the transport', async () => {
    const push = makePush();
    const channel = buildBuiltinChannels({ mailer: {}, webhook: {}, ntfy: {}, push } as never).find(
      (c) => c.id === 'push',
    )!;
    await expect(channel.sendToUser(3, msg)).resolves.toBe(true);
    expect(push.sendToUser).toHaveBeenCalledWith(3, {
      title: msg.title,
      body: msg.body,
      navigateTarget: '/trips/12',
      event: 'trip_invite',
    });
  });

  it('test delegates to the transport', async () => {
    const push = makePush();
    const channel = buildBuiltinChannels({ mailer: {}, webhook: {}, ntfy: {}, push } as never).find(
      (c) => c.id === 'push',
    )!;
    await expect(channel.test!(9)).resolves.toEqual({ success: true });
    expect(push.test).toHaveBeenCalledWith(9);
  });

  it('registerBuiltinChannels puts push into the registry (idempotent)', () => {
    const push = makePush();
    registerBuiltinChannels({ mailer: {}, webhook: {}, ntfy: {}, push } as never);
    registerBuiltinChannels({ mailer: {}, webhook: {}, ntfy: {}, push } as never);
    expect(getChannel('push')?.id).toBe('push');
  });
});
