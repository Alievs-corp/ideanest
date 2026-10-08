#!/usr/bin/env node
/**
 * Holds the OTA runtime version to the native inputs it is meant to hash — issue #165.
 *
 * `runtimeVersion: { policy: 'fingerprint' }` makes the runtime a hash of the project's native
 * inputs, and an update reaches only builds of the same runtime. @expo/fingerprint hashes every
 * module `app.config.ts` loads as a config-plugin source, and that file imports the message
 * catalogues, the colour tokens and the claimed-route table for their VALUES. Hashed whole, any
 * edit to a catalogue — a typo fixed on the web — would give the next update a runtime no
 * installed build has. `.fingerprintignore` leaves those files out; the values they contribute
 * reach the hash anyway, through the resolved Expo config.
 *
 * This proves both halves against the real project:
 *
 *   1. no file under `packages/` contributes a hash;
 *   2. an edit to a catalogue key the config does not read leaves the fingerprint as it was;
 *   3. an edit to `mobile.native.displayName`, which the config does read, changes it.
 *
 * Steps 2 and 3 edit `packages/messages/src/en.json` and put back its exact bytes afterwards,
 * also on Ctrl-C. Run it on its own, never beside a test run that reads the catalogue.
 *
 * Usage: `node apps/mobile/scripts/check-fingerprint.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = resolve(mobile, '../../packages/messages/src/en.json');

// @expo/fingerprint is expo-updates' dependency, not the app's: resolve it the way expo-updates does.
const fromMobile = createRequire(join(mobile, 'package.json'));
const fromUpdates = createRequire(fromMobile.resolve('expo-updates/package.json'));
const { createFingerprintAsync } = fromUpdates('@expo/fingerprint');

const fingerprint = () => createFingerprintAsync(mobile, { silent: true });

const original = readFileSync(catalogue);
let edited = false;
const restore = () => {
  if (edited) writeFileSync(catalogue, original);
  edited = false;
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

/** The catalogue with one string changed, written in its own CRLF format. */
function writeEdited(change) {
  const json = JSON.parse(original.toString('utf8'));
  change(json);
  edited = true;
  writeFileSync(catalogue, `${JSON.stringify(json, null, 2).replace(/\n/g, '\r\n')}\r\n`);
}

/** The first string leaf outside `mobile.native`: a key `app.config.ts` never reads. */
function unrelatedKey(json) {
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const here = [...path, key];
      if (here.join('.') === 'mobile.native') continue;
      if (typeof value === 'string') return here;
      if (value !== null && typeof value === 'object') {
        const found = walk(value, here);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return walk(json, []);
}

function setAt(json, path, value) {
  const parent = path.slice(0, -1).reduce((node, key) => node[key], json);
  parent[path.at(-1)] = value;
}

const failures = [];

try {
  const before = await fingerprint();

  const outside = before.sources
    // An ignored file may still be listed (the config loader matches Windows paths literally), but
    // with no hash, which is what keeps it out of the fingerprint.
    .filter((source) => source.type !== 'contents' && source.hash !== null)
    .map((source) => source.filePath.replace(/\\/g, '/'))
    .filter((path) => /(^|\/)packages\//.test(path) && !path.includes('node_modules/'));
  if (outside.length > 0) {
    failures.push(`workspace files are hash sources; add them to .fingerprintignore:\n  ${outside.join('\n  ')}`);
  }

  const key = unrelatedKey(JSON.parse(original.toString('utf8')));
  if (key === null) throw new Error('en.json has no string outside mobile.native');
  writeEdited((json) => setAt(json, key, `${key.reduce((node, part) => node[part], json)} (edited)`));
  const unrelated = await fingerprint();
  restore();
  if (unrelated.hash !== before.hash) {
    failures.push(`editing ${key.join('.')} changed the fingerprint; an OTA update would match no build`);
  }

  writeEdited((json) => setAt(json, ['mobile', 'native', 'displayName'], `${json.mobile.native.displayName} X`));
  const native = await fingerprint();
  restore();
  if (native.hash === before.hash) {
    failures.push('editing mobile.native.displayName left the fingerprint unchanged; the name would ship by OTA');
  }

  console.log(`fingerprint ${before.hash}`);
  console.log(`  ${key.join('.')} edited: ${unrelated.hash === before.hash ? 'unchanged' : unrelated.hash}`);
  console.log(`  mobile.native.displayName edited: ${native.hash === before.hash ? 'unchanged' : native.hash}`);
} finally {
  restore();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`check-fingerprint: ${failure}`);
  process.exit(1);
}
console.log('check-fingerprint: catalogue files are out of the hash, the native strings are in it');
