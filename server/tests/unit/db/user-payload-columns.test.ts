/**
 * Schema-driven guard for the auth payload.
 *
 * `stripUserForClient` picks from an allowlist, so a credential column added to
 * `users` tomorrow is withheld by default — but only for as long as the guard
 * keeps up with the table. So this walks the real schema rather than a
 * hand-written list of secrets: every column is filled with a sentinel value and
 * anything outside `PUBLIC_USER_FIELDS` must not survive the call.
 */
import { PUBLIC_USER_FIELDS, stripUserForClient } from '../../../src/nest/auth/auth.helpers';
import type { User } from '../../../src/types';
import { createTestDb } from '../../helpers/test-db';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// stripUserForClient derives these two booleans from the row regardless of the
// allowlist, so they are expected in the payload.
const DERIVED_FIELDS = ['mfa_enabled', 'must_change_password'];

let db: Database.Database;
let columns: string[];

beforeAll(() => {
  db = createTestDb();
  columns = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((c) => c.name);
});

afterAll(() => {
  db?.close();
});

/** A row in which EVERY column, including ones nobody expected, carries a marker. */
function sentinelRow(): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of columns) row[column] = `sentinel:${column}`;
  return row;
}

describe('stripUserForClient against the live users schema', () => {
  it('SEC-020: withholds every column outside the allowlist', () => {
    const result = stripUserForClient(sentinelRow() as unknown as User);
    const kept = new Set<string>([...PUBLIC_USER_FIELDS, ...DERIVED_FIELDS]);

    const leaked = columns.filter((column) => !kept.has(column) && column in result);
    expect(leaked).toEqual([]);
  });

  it('SEC-020: keeps every allowlisted column', () => {
    const result = stripUserForClient(sentinelRow() as unknown as User);

    for (const field of PUBLIC_USER_FIELDS) expect(field in result).toBe(true);
    // The three timestamps go through utcSuffix, so only id/username/email/role
    // and oidc_issuer come through untouched.
    for (const field of ['id', 'username', 'email', 'role', 'oidc_issuer'] as const) {
      expect(result[field]).toBe(`sentinel:${field}`);
    }
  });

  it('SEC-020: the allowlist names no column that stopped existing', () => {
    for (const field of PUBLIC_USER_FIELDS) {
      expect(columns, `${field} is not a users column`).toContain(field);
    }
  });

  it.each([
    // Accepted as a bearer credential in a URL by feeds.service.ts, so a copy of
    // it in a login response is a usable account, not an identifier.
    'feed_token',
    'immich_api_key',
    'immich_access_token',
    'synology_password',
    'synology_sid',
    'synology_did',
    'airtrail_api_key',
    'oidc_sub',
    'password_version',
    // Uploaded filename; the client is served avatar_url instead.
    'avatar',
  ])('SEC-020: %s stays in the database', (column) => {
    expect(columns, `${column} should still exist for this assertion to mean anything`).toContain(column);
    const result = stripUserForClient(sentinelRow() as unknown as User);
    expect(result).not.toHaveProperty(column);
  });
});
