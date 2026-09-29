import { readEnv } from '../app-config';
import { synchronousName } from '../app-config/parsers';

import type Database from 'better-sqlite3';

export interface ActiveDurability {
  journalMode: string;
  synchronous: string;
}

/**
 * Applies the configured journal_mode / synchronous pragmas to a freshly opened
 * connection and reports back what SQLite actually settled on.
 *
 * journal_mode is stored in the database file header, so it is not a per-process
 * setting: whichever process opened the file last decides the mode for all of
 * them. reset-admin.js and scripts/migrate-encryption.ts open the same file and
 * therefore read the same two variables — they cannot import this module (they
 * are standalone scripts and src/ is not in the image), so keep the three in
 * sync when the defaults change.
 *
 * The returned values are read back from the engine rather than echoed from the
 * config, so a mode SQLite refused shows up as what it really is — an in-memory
 * database stays MEMORY however hard you ask for WAL.
 */
export function applyDurabilityPragmas(db: Database.Database): ActiveDurability {
  const { journalMode, synchronous, durabilityWarnings } = readEnv().db;
  durabilityWarnings.forEach((warning) => console.warn(`[DB] ${warning}`));

  db.exec(`PRAGMA journal_mode = ${journalMode}`);
  db.exec(`PRAGMA synchronous = ${synchronous}`);

  return {
    journalMode: String(db.pragma('journal_mode', { simple: true })).toUpperCase(),
    synchronous: synchronousName(db.pragma('synchronous', { simple: true })),
  };
}

export interface ActiveReadTuning {
  /** Bytes of the database file this connection may map into memory. */
  mmapSize: number;
  /** Pages this connection caches; SQLite's own default is ~2 MiB worth. */
  cacheSize: number;
  /** The name the operator asked for — `PRAGMA temp_store` reads back as an unnamed integer. */
  tempStore: string;
}

/**
 * Applies the per-connection read tuning (mmap window, page cache, temp store) to
 * a freshly opened connection and reports what SQLite settled on.
 *
 * These are connection-scoped, so unlike journal_mode there is no cross-process
 * agreement to keep — a script that opens the file without them is merely slower,
 * not unsafe.
 */
export function applyReadTuningPragmas(db: Database.Database): ActiveReadTuning {
  const { mmapSize, cacheSizeKiB, tempStore, readTuningWarnings } = readEnv().db;
  readTuningWarnings.forEach((warning) => console.warn(`[DB] ${warning}`));

  db.exec(`PRAGMA mmap_size = ${mmapSize}`);
  // Negative cache_size is SQLite's "size in KiB" form; a page count would make
  // the setting depend on the page size instead.
  db.exec(`PRAGMA cache_size = ${-cacheSizeKiB}`);
  db.exec(`PRAGMA temp_store = ${tempStore}`);

  return {
    mmapSize: Number(db.pragma('mmap_size', { simple: true })),
    cacheSize: Number(db.pragma('cache_size', { simple: true })),
    tempStore,
  };
}
