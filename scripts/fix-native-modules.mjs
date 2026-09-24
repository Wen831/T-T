#!/usr/bin/env node
/**
 * Make `better-sqlite3` loadable by the Node that is actually running.
 *
 * Why this exists: the server's test suite (unit, integration and e2e) opens a
 * real SQLite database, and better-sqlite3 is a native addon compiled against
 * one specific NODE_MODULE_VERSION (ABI). `npm ci` on a different Node, or a
 * node_modules tree copied or rsynced from another machine, leaves an addon
 * built for an ABI this Node cannot load — every server test then dies at
 * import with ERR_DLOPEN_FAILED, which reads like a broken test suite rather
 * than a stale binary.
 *
 * What it does: compares the addon's ABI with the running Node's, and when they
 * differ, installs the matching prebuilt binary through prebuild-install. The
 * build it asks for targets exactly the running Node, so the result is
 * reproducible rather than dependent on a hard-coded version.
 *
 * Usage:
 *   node scripts/fix-native-modules.mjs          # only acts when mismatched
 *   node scripts/fix-native-modules.mjs --force   # reinstall regardless
 *
 * Needs network access on first run (the prebuilt binary is downloaded).
 * Without a C toolchain this is the only route — compiling from source needs
 * gcc/g++/make/python.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'better-sqlite3';
const force = process.argv.includes('--force');

/** The ABI tag NODE_MODULE_VERSION for the process running this script. */
const wantAbi = process.versions.modules;

function pkgDir() {
  // Resolve through Node so a hoisted or nested install both land on the copy
  // the server will actually import.
  const require = createRequire(join(REPO, 'server', 'index.js'));
  return dirname(require.resolve(`${PKG}/package.json`));
}

function addonPath(dir) {
  return join(dir, 'build', 'Release', 'better_sqlite3.node');
}

/**
 * Read the ABI a .node file was built for, or null when it cannot be read.
 *
 * The value lives in the binary's dynamic symbol table, so rather than parsing
 * ELF/Mach-O/PE headers this asks Node itself: a failed require reports the
 * expected ABI in its message, and a successful one proves it already matches.
 */
function currentAbiTag(nodeFile) {
  try {
    const out = execFileSync(process.execPath, ['-e', `require(${JSON.stringify(nodeFile)})`], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    void out;
    return String(wantAbi); // loaded fine under this Node
  } catch (err) {
    const msg = `${err.stderr ?? ''}${err.stdout ?? ''}${err.message ?? ''}`;
    const m = msg.match(/NODE_MODULE_VERSION (\d+)/);
    return m ? m[1] : null;
  }
}

function main() {
  let dir;
  try {
    dir = pkgDir();
  } catch {
    console.error(`✗ ${PKG} is not installed — run \`npm install\` first.`);
    process.exit(1);
  }

  const addon = addonPath(dir);
  if (!existsSync(addon)) {
    console.error(`✗ ${addon} is missing — run \`npm install\` first.`);
    process.exit(1);
  }

  const haveAbi = currentAbiTag(addon);

  if (!force && haveAbi === String(wantAbi)) {
    console.log(`✓ ${PKG} already loads on Node ${process.version} (ABI ${wantAbi}).`);
    return;
  }

  if (haveAbi === null) {
    console.log(`… could not determine the installed ABI; reinstalling for certainty.`);
  } else {
    console.log(
      `… ${PKG} was built for ABI ${haveAbi} but Node ${process.version} needs ${wantAbi}.`,
    );
  }

  console.log(`… installing the prebuilt binary for Node ${process.version} (ABI ${wantAbi})…`);
  try {
    execFileSync(
      process.execPath,
      [
        join(REPO, 'node_modules', 'prebuild-install', 'bin.js'),
        `--target=${process.versions.node}`,
        `--arch=${process.arch}`,
        '--force',
      ],
      { cwd: dir, stdio: 'inherit' },
    );
  } catch {
    console.error(
      '\n✗ prebuild-install failed. It needs network access, and this fallback\n' +
        '  has no compiler: installing gcc/g++/make/python3 and then running\n' +
        `  \`npm rebuild ${PKG}\` inside ${dir} also works.`,
    );
    process.exit(1);
  }

  const after = currentAbiTag(addonPath(dir));
  if (after !== String(wantAbi)) {
    console.error(`✗ Still mismatched after reinstall (addon ABI ${after ?? 'unknown'}).`);
    process.exit(1);
  }
  console.log(`✓ ${PKG} now loads on Node ${process.version}. Server tests can run.`);
}

main();
