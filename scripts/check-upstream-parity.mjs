#!/usr/bin/env node
/**
 * Compare TT's 4.3 port against upstream TREK, pinned at v4.3.0.
 *
 * This exists because the port's own handoff notes said the upstream reference
 * was unreachable, which left every fidelity claim resting on TT's git history
 * alone — i.e. on the port grading its own homework. The repo is public, so the
 * reference is obtainable, and this script makes the comparison repeatable
 * instead of a one-off you have to redo from scratch.
 *
 * It is DELIBERATELY read-only against upstream and only ever runs `git show`
 * against a pinned tag — never the working tree, whose HEAD is 4.3.1+ and would
 * quietly answer a different question.
 *
 * Usage:
 *   node scripts/check-upstream-parity.mjs [--ref /path/to/TREK]
 *
 * Exit code is 0 when every ported migration is present and identical, and the
 * only absent upstream schema statements are the ones the port decided on
 * purpose to skip (see SKIPPED below).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const TAG = "v4.3.0";

/** `--ref` overrides; otherwise a clone in /tmp, then the handoff's original path. */
function findRef() {
  const arg = process.argv.indexOf("--ref");
  if (arg !== -1 && process.argv[arg + 1]) return process.argv[arg + 1];
  const candidates = [
    "/tmp/trek-ref",
    "/mnt/openclaw-data/tt-port/TREK",
    path.join(REPO, "..", "TREK"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, ".git"))) return c;
  return null;
}

const ref = findRef();
if (!ref) {
  console.error(
    "No upstream TREK clone found. One command gets it, pinned:\n" +
      "  git clone --filter=blob:none --no-checkout --branch v4.3.0 \\\n" +
      "    https://github.com/liketrek/TREK.git /tmp/trek-ref",
  );
  process.exit(2);
}

const show = (p) =>
  execFileSync("git", ["-C", ref, "show", `${TAG}:${p}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * Statements upstream makes that TT does not, on purpose.
 *
 * Upstream's migration #221 adds a per-user AMap key and its own POI column.
 * TT keeps the key instance-wide (`app_settings`) and the place key as
 * `amap_id`, so both are absent by decision. Anything NOT on this list showing
 * up as missing is a real unported migration.
 */
const SKIPPED = [
  ["ADDCOL", "users", "amap_api_key"],
  ["ADDCOL", "places", "amap_poi_id"],
];

/** A `table.column` pair the port claims to have taken from upstream. */
const PORTED_COLUMNS = [
  ["places", "stop_type"],
  ["places", "fill_percent"],
  ["places", "source"],
  ["trip_files", "message_id"],
  ["budget_settlements", "settled_at"],
  ["reservations", "accommodation_id"],
  ["reservations", "end_day_id"],
];

function schemaUnits(src) {
  const out = new Set();
  for (const m of src.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/g))
    out.add(`ADDCOL ${m[1]} ${m[2]}`.toLowerCase());
  for (const m of src.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/g))
    out.add(`TABLE ${m[1]}`.toLowerCase());
  for (const m of src.matchAll(
    /CREATE (?:UNIQUE )?INDEX(?:\s+IF NOT EXISTS)?\s+(\w+)/g,
  ))
    out.add(`INDEX ${m[1]}`.toLowerCase());
  return out;
}

const squash = (s) =>
  s
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function addColumnText(src, table, column) {
  const m = src.match(
    new RegExp(
      `ALTER TABLE\\s+${table}\\s+ADD COLUMN\\s+${column}\\b[^;\`'"]*`,
      "i",
    ),
  );
  return m ? squash(m[0]) : null;
}

let failures = 0;
const upstreamMigrations = show("server/src/db/migrations.ts");
const oursMigrations = fs.readFileSync(
  path.join(REPO, "server/src/db/migrations.ts"),
  "utf8",
);

console.log(`upstream: ${ref} @ ${TAG}`);
console.log(
  `upstream commit: ${execFileSync("git", ["-C", ref, "rev-parse", `${TAG}^{commit}`], { encoding: "utf8" }).trim()}\n`,
);

// 1. Every schema statement upstream makes, minus the decisions, must exist here.
const missing = [...schemaUnits(upstreamMigrations)].filter((u) => {
  const [kind, a, b] = u.split(" ");
  if (
    SKIPPED.some(([k, t, c]) => k === kind.toUpperCase() && t === a && c === b)
  )
    return false;
  return !schemaUnits(oursMigrations).has(u);
});
console.log(
  `1. schema statements upstream makes that TT lacks: ${missing.length}`,
);
for (const u of missing) {
  console.log(`   MISSING  ${u}`);
  failures++;
}
if (!missing.length)
  console.log(
    "   every upstream statement is present (modulo the two documented skips)",
  );

// 2. The skips really are absent — i.e. TT did not half-import #221.
const oursUnits = schemaUnits(oursMigrations);
const halfImported = SKIPPED.filter(([k, t, c]) =>
  oursUnits.has(`${k} ${t} ${c}`.toLowerCase()),
);
console.log(
  `\n2. documented skips accidentally present: ${halfImported.length}`,
);
for (const [k, t, c] of halfImported) {
  // TT's `places.amap_id` is the intended stand-in, `amap_poi_id` is not.
  console.log(`   UNEXPECTED  ${k} ${t}.${c}`);
  failures++;
}

// 3. The ported columns exist AND match upstream's statement, not merely exist.
console.log("\n3. ported columns vs upstream:");
for (const [table, column] of PORTED_COLUMNS) {
  const u = addColumnText(upstreamMigrations, table, column);
  const o = addColumnText(oursMigrations, table, column);
  if (!o) {
    console.log(`   MISSING  ${table}.${column}`);
    failures++;
  } else if (!u) {
    console.log(`   EXTRA    ${table}.${column} (TT-only, fine)`);
  } else if (u === o) {
    console.log(`   same     ${table}.${column}`);
  } else {
    console.log(`   DIFFERS  ${table}.${column}`);
    console.log(`      upstream: ${u}`);
    console.log(`      TT      : ${o}`);
    failures++;
  }
}

// 4. Shared contracts: identical field-name sets, with any delta named.
console.log("\n4. shared contracts:");
const SHARED = [
  "shared/src/roadtrip/preferences.schema.ts",
  "shared/src/dawarich/dawarich.schema.ts",
  "shared/src/place/place.schema.ts",
];
for (const rel of SHARED) {
  let upstreamText;
  try {
    upstreamText = show(rel);
  } catch {
    console.log(`   ABSENT UPSTREAM  ${rel}`);
    continue;
  }
  const ours = fs.readFileSync(path.join(REPO, rel), "utf8");
  const fields = (s) =>
    new Set([...s.matchAll(/^\s{2}([a-z][a-z0-9_]*)\s*:/gm)].map((m) => m[1]));
  const u = fields(upstreamText);
  const o = fields(ours);
  const onlyUp = [...u].filter((x) => !o.has(x));
  const onlyOurs = [...o].filter((x) => !u.has(x));
  if (!onlyUp.length && !onlyOurs.length) {
    console.log(`   same fields (${u.size})  ${rel}`);
  } else {
    console.log(`   ${rel}`);
    if (onlyUp.length) console.log(`      only upstream: ${onlyUp.join(", ")}`);
    if (onlyOurs.length)
      console.log(`      only TT      : ${onlyOurs.join(", ")}`);
  }
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} mismatch(es)`}`);
process.exit(failures === 0 ? 0 : 1);
