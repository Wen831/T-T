import type { VersionInfo } from '../../../src/nest/admin/admin.helpers';
import { UpdatePrepService } from '../../../src/nest/admin/update-prep.service';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Preparing an update, without performing one.
 *
 * This application cannot update itself — the container is read_only, drops all
 * capabilities and has no Docker socket — so what the browser can usefully do is
 * everything up to the command. These cases pin the parts that decide what an
 * operator is told: which deployment this is, whether a backup was actually
 * written, and what the instructions say.
 */

const DOCKER_ENV = process.env.SOURCE_BUILD;

function service(opts: { backupOk?: boolean; inContainer?: boolean } = {}) {
  const createBackup = vi.fn(async () => {
    if (opts.backupOk === false) throw new Error('disk full');
    return { filename: 'backup-2026-09-26T10-00-00.zip' };
  });
  const svc = new UpdatePrepService({ createBackup } as never);
  // Defaults to a Docker install: that is what the deployment-specific cases
  // below are about, and the manual branch has its own case.
  svc.inContainer = () => opts.inContainer ?? true;
  return { svc, createBackup };
}

const version = (over: Partial<VersionInfo> = {}): VersionInfo => ({
  current: '0.7.2',
  latest: '0.7.3',
  update_available: true,
  is_docker: true,
  is_prerelease: false,
  release_url: 'https://github.com/bhxnms/T-T/releases/tag/v0.7.3',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SOURCE_BUILD;
  delete process.env.IMAGE_NAME;
  delete process.env.IMAGE_TAG;
});

describe('UpdatePrepService — nothing to do', () => {
  it('UPDATE-PREP-001: an up-to-date instance is told so, and no backup is taken', async () => {
    const { svc, createBackup } = service();
    const result = await svc.prepare(version({ update_available: false, latest: '0.7.2' }));

    expect(result.ready).toBe(false);
    expect(result.reason).toBe('up-to-date');
    // Writing an archive for an update that is not happening would be a surprise
    // on the operator's disk.
    expect(createBackup).not.toHaveBeenCalled();
  });
});

describe('UpdatePrepService — the backup', () => {
  it('UPDATE-PREP-002: a backup is taken before the operator is told to update', async () => {
    const { svc, createBackup } = service();
    const result = await svc.prepare(version());

    expect(createBackup).toHaveBeenCalledWith('backup');
    expect(result.backup).toEqual({ created: true, filename: 'backup-2026-09-26T10-00-00.zip', error: null });
  });

  it('UPDATE-PREP-003: a failed backup is reported, not swallowed, and still prepares', async () => {
    const { svc } = service({ backupOk: false });
    const result = await svc.prepare(version());

    // The operator must not be told "backed up" when nothing was written.
    expect(result.backup?.created).toBe(false);
    expect(result.backup?.error).toContain('disk full');
    // But an operator who can reach their own data directory may still want the
    // command, so the failure does not block the steps.
    expect(result.ready).toBe(true);
    expect(result.steps?.length).toBeGreaterThan(0);
  });
});

describe('UpdatePrepService — which deployment this is', () => {
  it('UPDATE-PREP-004: a published-image install is told to pull, and the tag is the release', async () => {
    process.env.SOURCE_BUILD = 'false'; // operator left it at the default
    process.env.IMAGE_NAME = 'ghcr.io/example/tt';
    const { svc } = service();
    const result = await svc.prepare(version());

    expect(result.deployment).toBe('docker-image');
    const pull = result.steps!.find((s) => s.command?.startsWith('docker pull'));
    expect(pull?.command).toBe('docker pull ghcr.io/example/tt:0.7.3');
  });

  it('UPDATE-PREP-005: a checkout build is told to pull and rebuild, never to pull an image', async () => {
    process.env.SOURCE_BUILD = 'true';
    const { svc } = service();
    const result = await svc.prepare(version());

    expect(result.deployment).toBe('docker-source');
    const commands = result.steps!.map((s) => s.command);
    expect(commands).toContain('git pull');
    expect(commands).toContain('docker compose up -d --build');
    // Pulling a published image here would install somebody else's build over
    // the operator's own.
    expect(commands.some((c) => c?.startsWith('docker pull'))).toBe(false);
  });

  it('UPDATE-PREP-006: an unset image name is a placeholder, never an invented default', async () => {
    const { svc } = service();
    const result = await svc.prepare(version());

    // The server cannot see IMAGE_NAME — it lives in the shell that runs
    // compose — so guessing the upstream image would quietly pull the wrong
    // build on a fork.
    const pull = result.steps!.find((s) => s.command?.startsWith('docker pull'));
    expect(pull?.command).toContain('<your-image>');
    expect(pull?.command).not.toContain('ghcr.io/bhxnms');
  });

  it('UPDATE-PREP-011: outside a container the guidance is the install method, not a compose command', async () => {
    const { svc } = service({ inContainer: false });
    const result = await svc.prepare(version());

    expect(result.deployment).toBe('manual');
    expect(result.deployment_reason).toBe('notDocker');
    // A bare-metal install has no compose file to run: every command here would
    // be wrong, so there are none.
    expect(result.steps!.every((s) => s.command === null)).toBe(true);
  });

  it('UPDATE-PREP-007: every step says what it is, and prose steps carry no command', async () => {
    const { svc } = service();
    const result = await svc.prepare(version());
    for (const step of result.steps!) {
      expect(step.labelKey).toMatch(/^admin\.update\.step\./);
      if (step.command === null) expect(step.noteKey).toBeTruthy();
    }
  });
});

describe('UpdatePrepService — what it must never do', () => {
  it('UPDATE-PREP-008: it returns text, and runs nothing', async () => {
    const { svc } = service();
    const result = await svc.prepare(version());
    // Every command is a string for a human to paste. There is no field here
    // that a browser could act on, and no shell is spawned to produce one.
    for (const step of result.steps!) {
      expect(typeof step.command === 'string' || step.command === null).toBe(true);
    }
  });

  it('UPDATE-PREP-009: the release URL is passed through for the reader to check', async () => {
    const { svc } = service();
    const result = await svc.prepare(version());
    expect(result.release_url).toBe('https://github.com/bhxnms/T-T/releases/tag/v0.7.3');
  });

  it('UPDATE-PREP-010: a missing release URL is null, not undefined-shaped text', async () => {
    const { svc } = service();
    const result = await svc.prepare(version({ release_url: undefined }));
    expect(result.release_url).toBeNull();
  });
});
