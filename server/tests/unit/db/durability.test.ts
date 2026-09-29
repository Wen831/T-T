import { resolveDurability, resolveReadTuning } from '../../../src/app-config/parsers';
import { applyDurabilityPragmas, applyReadTuningPragmas } from '../../../src/db/durability';

import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// journal_mode is written into the database file header, so it outlives the
// connection that set it. Anything asserting a mode here therefore reopens the
// file: that is the property operators on SMB/NFS volumes actually depend on.

const SERVER_ROOT = path.resolve(__dirname, '../../..');

let tmpDir: string;
let dbPath: string;

function readModes(file: string): { journalMode: string; synchronous: number } {
  const db = new Database(file);
  try {
    return {
      journalMode: String(db.pragma('journal_mode', { simple: true })).toUpperCase(),
      synchronous: Number(db.pragma('synchronous', { simple: true })),
    };
  } finally {
    db.close();
  }
}

const READ_TUNING_ENV = ['TREK_DB_MMAP_SIZE', 'TREK_DB_CACHE_SIZE_KIB', 'TREK_DB_TEMP_STORE'] as const;

function clearReadTuningEnv(): void {
  READ_TUNING_ENV.forEach((key) => delete process.env[key]);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trek-durability-'));
  dbPath = path.join(tmpDir, 'travel.db');
  delete process.env.TREK_DB_JOURNAL_MODE;
  delete process.env.TREK_DB_SYNCHRONOUS;
  clearReadTuningEnv();
});

afterEach(() => {
  delete process.env.TREK_DB_JOURNAL_MODE;
  delete process.env.TREK_DB_SYNCHRONOUS;
  clearReadTuningEnv();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveDurability', () => {
  it('defaults to WAL with the synchronous level a WAL database already runs at', () => {
    expect(resolveDurability(undefined, undefined)).toEqual({
      journalMode: 'WAL',
      synchronous: 'NORMAL',
      warnings: [],
    });
    expect(resolveDurability('', '')).toEqual({ journalMode: 'WAL', synchronous: 'NORMAL', warnings: [] });
  });

  it('accepts every SQLite journal mode, case- and padding-insensitively', () => {
    expect(resolveDurability('delete', undefined).journalMode).toBe('DELETE');
    expect(resolveDurability('  Truncate  ', undefined).journalMode).toBe('TRUNCATE');
    expect(resolveDurability('PERSIST', undefined).journalMode).toBe('PERSIST');
    expect(resolveDurability('memory', undefined).journalMode).toBe('MEMORY');
    expect(resolveDurability('off', undefined).journalMode).toBe('OFF');
  });

  it('raises the default to FULL once a rollback journal is in play', () => {
    // NORMAL is only safe under WAL; on DELETE/TRUNCATE it lets a power cut eat
    // committed transactions, which would defeat the point of leaving WAL.
    expect(resolveDurability('DELETE', undefined).synchronous).toBe('FULL');
    expect(resolveDurability('TRUNCATE', undefined).synchronous).toBe('FULL');
    expect(resolveDurability('WAL', undefined).synchronous).toBe('NORMAL');
  });

  it('lets synchronous be set independently of the journal mode', () => {
    expect(resolveDurability('WAL', 'full').synchronous).toBe('FULL');
    expect(resolveDurability('DELETE', 'normal').synchronous).toBe('NORMAL');
    expect(resolveDurability(undefined, 'EXTRA').synchronous).toBe('EXTRA');
    expect(resolveDurability(undefined, 'off').synchronous).toBe('OFF');
  });

  it('falls back and reports instead of rejecting an unusable value', () => {
    const result = resolveDurability('WALL', 'sort-of');
    expect(result.journalMode).toBe('WAL');
    expect(result.synchronous).toBe('NORMAL');
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('TREK_DB_JOURNAL_MODE="WALL"');
    expect(result.warnings[1]).toContain('TREK_DB_SYNCHRONOUS="sort-of"');
  });

  it('keeps the per-mode synchronous default when only that value is bogus', () => {
    const result = resolveDurability('DELETE', 'maybe');
    expect(result.journalMode).toBe('DELETE');
    expect(result.synchronous).toBe('FULL');
    expect(result.warnings).toHaveLength(1);
  });
});

describe('applyDurabilityPragmas', () => {
  it('leaves an unconfigured install on WAL', () => {
    const db = new Database(dbPath);
    const active = applyDurabilityPragmas(db);
    db.exec('CREATE TABLE t (a)');
    db.close();

    expect(active).toEqual({ journalMode: 'WAL', synchronous: 'NORMAL' });
    expect(readModes(dbPath).journalMode).toBe('WAL');
  });

  it('switches the file to the configured mode and persists it', () => {
    process.env.TREK_DB_JOURNAL_MODE = 'DELETE';

    const wal = new Database(dbPath);
    wal.exec('PRAGMA journal_mode = WAL');
    wal.exec('CREATE TABLE t (a)');
    wal.close();
    expect(readModes(dbPath).journalMode).toBe('WAL');

    const db = new Database(dbPath);
    const active = applyDurabilityPragmas(db);
    db.close();

    expect(active.journalMode).toBe('DELETE');
    // FULL (2) — a rollback journal without it is no safer than the WAL setup
    // the operator moved away from.
    expect(active.synchronous).toBe('FULL');
    expect(readModes(dbPath)).toEqual({ journalMode: 'DELETE', synchronous: 2 });
  });

  it('applies an explicit synchronous level on top of the journal mode', () => {
    process.env.TREK_DB_SYNCHRONOUS = 'FULL';

    const db = new Database(dbPath);
    const active = applyDurabilityPragmas(db);
    expect(active).toEqual({ journalMode: 'WAL', synchronous: 'FULL' });
    expect(Number(db.pragma('synchronous', { simple: true }))).toBe(2);
    db.close();
  });

  it('warns and stays on the default when the mode is misspelled', () => {
    process.env.TREK_DB_JOURNAL_MODE = 'DELET';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const db = new Database(dbPath);
    const active = applyDurabilityPragmas(db);
    db.close();

    expect(active.journalMode).toBe('WAL');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('TREK_DB_JOURNAL_MODE="DELET"');
  });

  it('warns and keeps the mode default when synchronous is misspelled', () => {
    process.env.TREK_DB_SYNCHRONOUS = 'VERY';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const db = new Database(dbPath);
    const active = applyDurabilityPragmas(db);
    db.close();

    expect(active.synchronous).toBe('NORMAL');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('TREK_DB_SYNCHRONOUS="VERY"');
  });

  it('reports what the engine settled on, not what was asked for', () => {
    process.env.TREK_DB_JOURNAL_MODE = 'WAL';
    const db = new Database(':memory:');
    expect(applyDurabilityPragmas(db).journalMode).toBe('MEMORY');
    db.close();
  });
});

describe('resolveReadTuning', () => {
  it('defaults to a 256 MiB mapping window, a 20 MiB cache and an in-memory temp store', () => {
    expect(resolveReadTuning(undefined, undefined, undefined)).toEqual({
      mmapSize: 268_435_456,
      cacheSizeKiB: 20_480,
      tempStore: 'MEMORY',
      warnings: [],
    });
    expect(resolveReadTuning('', '', '')).toEqual(resolveReadTuning(undefined, undefined, undefined));
  });

  it('takes an explicit zero mmap as "stop mapping the file"', () => {
    expect(resolveReadTuning('0', undefined, undefined)).toMatchObject({ mmapSize: 0, warnings: [] });
  });

  it('reads every value case- and padding-insensitively', () => {
    expect(resolveReadTuning(' 1048576 ', ' 40960 ', ' file ')).toEqual({
      mmapSize: 1_048_576,
      cacheSizeKiB: 40_960,
      tempStore: 'FILE',
      warnings: [],
    });
  });

  it('falls back and reports instead of rejecting an unusable value', () => {
    const result = resolveReadTuning('huge', '-5', 'DISK');
    expect(result).toMatchObject({ mmapSize: 268_435_456, cacheSizeKiB: 20_480, tempStore: 'MEMORY' });
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toContain('TREK_DB_MMAP_SIZE="huge"');
    expect(result.warnings[1]).toContain('TREK_DB_CACHE_SIZE_KIB="-5"');
    expect(result.warnings[2]).toContain('TREK_DB_TEMP_STORE="DISK"');
  });

  it('rejects a fractional cache size instead of silently rounding it', () => {
    // 1.5 KiB is not a page count SQLite can store, and a silently rounded value
    // is a worse surprise than a reported one.
    const result = resolveReadTuning(undefined, '1.5', undefined);
    expect(result.cacheSizeKiB).toBe(20_480);
    expect(result.warnings[0]).toContain('TREK_DB_CACHE_SIZE_KIB="1.5"');
  });

  it('caps an absurd cache rather than honouring it per connection', () => {
    const result = resolveReadTuning(undefined, String(4 * 1024 * 1024), undefined);
    expect(result.cacheSizeKiB).toBe(20_480);
    expect(result.warnings[0]).toContain('exceeds the 2097152 KiB ceiling');
  });
});

describe('applyReadTuningPragmas', () => {
  it('hands the connection the tuned cache and mapping window', () => {
    const db = new Database(dbPath);
    const tuning = applyReadTuningPragmas(db);
    const cacheSize = Number(db.pragma('cache_size', { simple: true }));
    const mmapSize = Number(db.pragma('mmap_size', { simple: true }));
    db.close();

    // Negative is SQLite's own spelling of "KiB, not pages" — the point of the
    // setting is that it does not move with the page size.
    expect(tuning).toEqual({ mmapSize: 268_435_456, cacheSize: -20_480, tempStore: 'MEMORY' });
    expect(cacheSize).toBe(-20_480);
    expect(mmapSize).toBeGreaterThan(0);
  });

  it('honours an operator who switches mapping off', () => {
    process.env.TREK_DB_MMAP_SIZE = '0';
    process.env.TREK_DB_CACHE_SIZE_KIB = '4096';
    process.env.TREK_DB_TEMP_STORE = 'file';

    const db = new Database(dbPath);
    expect(applyReadTuningPragmas(db)).toEqual({ mmapSize: 0, cacheSize: -4_096, tempStore: 'FILE' });
    db.close();
  });

  it('warns about a bad value and still opens on the defaults', () => {
    process.env.TREK_DB_TEMP_STORE = 'RAMDISK';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const db = new Database(dbPath);
    const tuning = applyReadTuningPragmas(db);
    db.close();

    expect(tuning.tempStore).toBe('MEMORY');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('TREK_DB_TEMP_STORE="RAMDISK"');
  });
});

// The other two processes that open travel.db read-write. They cannot import
// the module above (standalone scripts, and src/ is not in the container
// image), so they are exercised as processes — a copy of the resolution that
// drifts flips the header back and silently un-does the operator's choice.
describe('standalone scripts honour the same configuration', () => {
  function seedWalDb(): void {
    const db = new Database(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        must_change_password INTEGER DEFAULT 0,
        mfa_secret TEXT,
        maps_api_key TEXT,
        openweather_api_key TEXT,
        immich_api_key TEXT,
        synology_password TEXT,
        synology_sid TEXT,
        synology_did TEXT
      );
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE settings (user_id INTEGER, key TEXT, value TEXT);
      CREATE TABLE trip_album_links (id INTEGER PRIMARY KEY, passphrase TEXT);
      CREATE TABLE trek_photos (id INTEGER PRIMARY KEY, passphrase TEXT);
    `);
    db.close();
    expect(readModes(dbPath).journalMode).toBe('WAL');
  }

  it('reset-admin.js applies TREK_DB_JOURNAL_MODE instead of leaving WAL behind', () => {
    seedWalDb();

    execFileSync(process.execPath, ['reset-admin.js'], {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        TREK_DB_FILE: dbPath,
        TREK_DB_JOURNAL_MODE: 'DELETE',
        RESET_ADMIN_EMAIL: 'locked-out@example.com',
        RESET_ADMIN_PASSWORD: 'Recovery12345!',
      },
      stdio: 'pipe',
    });

    expect(readModes(dbPath)).toEqual({ journalMode: 'DELETE', synchronous: 2 });

    const db = new Database(dbPath);
    const admin = db.prepare('SELECT role FROM users WHERE email = ?').get('locked-out@example.com') as
      | { role: string }
      | undefined;
    db.close();
    expect(admin?.role).toBe('admin');
  }, 60000);

  it('migrate-encryption.ts no longer forces the database back to WAL', () => {
    seedWalDb();

    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-encryption.ts'], {
      cwd: SERVER_ROOT,
      env: { ...process.env, DB_PATH: dbPath, TREK_DB_JOURNAL_MODE: 'DELETE' },
      input: 'old-key\nnew-key\nyes\n',
      stdio: 'pipe',
    });

    expect(readModes(dbPath)).toEqual({ journalMode: 'DELETE', synchronous: 2 });
  }, 120000);
});
