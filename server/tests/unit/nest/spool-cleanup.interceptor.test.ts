import { SpoolCleanupInterceptor } from '../../../src/nest/common/spool-cleanup.interceptor';
import { CallHandler, ExecutionContext } from '@nestjs/common';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unlinking what multer spooled when the request dies before the handler.
 *
 * Nest resolves handler parameters — and therefore runs the validation pipe —
 * only after every interceptor is entered, and `FilesInterceptor` has already
 * written the parts to the spool by then. Nothing sweeps that directory, so a
 * body the pipe rejects leaves the bytes behind, and the request is repeatable:
 * a disk-fill anybody with upload rights can trigger in a loop.
 */
describe('SpoolCleanupInterceptor', () => {
  const interceptor = new SpoolCleanupInterceptor();
  const tmpDirs: string[] = [];
  const spooled: string[] = [];

  /** A real file on disk, since the interceptor's whole job is unlinking one. */
  function spoolFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spool-cleanup-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'upload.bin');
    fs.writeFileSync(file, 'bytes');
    spooled.push(file);
    return file;
  }

  function contextWith(req: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  const handler = (fn: () => unknown): CallHandler => ({ handle: fn as CallHandler['handle'] });

  beforeEach(() => {
    spooled.length = 0;
  });

  afterEach(() => {
    while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  it('SPOOL-001: a successful handler keeps its spooled file', async () => {
    const file = spoolFile();
    await firstValueFrom(
      interceptor.intercept(
        contextWith({ file: { path: file } }),
        handler(() => of('ok')),
      ),
    );
    // The handler owns the file on success — it moves it into storage itself.
    expect(fs.existsSync(file)).toBe(true);
  });

  it('SPOOL-002: a failure unlinks the single spooled file and rethrows', async () => {
    const file = spoolFile();
    const boom = new Error('validation failed');
    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextWith({ file: { path: file } }),
          handler(() => throwError(() => boom)),
        ),
      ),
    ).rejects.toBe(boom);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('SPOOL-003: a failure unlinks every file of an array upload', async () => {
    const a = spoolFile();
    const b = spoolFile();
    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextWith({ files: [{ path: a }, { path: b }] }),
          handler(() => throwError(() => new Error('nope'))),
        ),
      ),
    ).rejects.toThrow('nope');
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
  });

  it('SPOOL-004: the original error survives a failing unlink', async () => {
    // An entry whose path does not exist is the realistic case: the handler may
    // already have moved it. Cleanup must never mask the real failure.
    const missing = path.join(os.tmpdir(), 'spool-cleanup-not-here', 'gone.bin');
    const boom = new Error('the real problem');
    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextWith({ file: { path: missing } }),
          handler(() => throwError(() => boom)),
        ),
      ),
    ).rejects.toBe(boom);
  });

  it('SPOOL-005: a request with no upload at all is left alone', async () => {
    const boom = new Error('unrelated failure');
    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextWith({}),
          handler(() => throwError(() => boom)),
        ),
      ),
    ).rejects.toBe(boom);
  });

  it('SPOOL-006: an entry without a path is skipped rather than throwing', async () => {
    const file = spoolFile();
    const boom = new Error('still the real one');
    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextWith({ files: [{}, { path: undefined }, { path: file }] }),
          handler(() => throwError(() => boom)),
        ),
      ),
    ).rejects.toBe(boom);
    expect(fs.existsSync(file)).toBe(false);
  });
});
