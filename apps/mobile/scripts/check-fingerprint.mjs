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
 * It also holds the code-signing certificate in the hash (#579), which `fingerprint.config.js`
 * adds because nothing else reads its bytes. A build embeds the certificate, so a different one
 * must be a different runtime, or an update signed with the new key reaches builds that refuse it:
 *
 *   4. a different certificate changes the fingerprint;
 *   5. the same certificate with CRLF line endings, as a Windows checkout has it, does not.
 *
 * Steps 2 and 3 edit `packages/messages/src/en.json`, steps 4 and 5 `certs/certificate.pem`, and
 * each is put back to its exact bytes afterwards, also on Ctrl-C. Run it on its own, never beside
 * a test run that reads the catalogue.
 *
 * Usage: `node apps/mobile/scripts/check-fingerprint.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = resolve(mobile, '../../packages/messages/src/en.json');
const certificate = resolve(mobile, 'certs/certificate.pem');
const fingerprintConfig = resolve(mobile, 'fingerprint.config.js');

// @expo/fingerprint is expo-updates' dependency, not the app's: resolve it the way expo-updates does.
const fromMobile = createRequire(join(mobile, 'package.json'));
const fromUpdates = createRequire(fromMobile.resolve('expo-updates/package.json'));
const { createFingerprintAsync } = fromUpdates('@expo/fingerprint');

// The fingerprint `require`s `fingerprint.config.js`, which reads the certificate as it loads, and
// Node keeps the module: without dropping it first, steps 4 and 5 would hash the certificate as it
// was on the first run.
const fingerprint = () => {
  delete fromMobile.cache[fingerprintConfig];
  return createFingerprintAsync(mobile, { silent: true });
};

const original = readFileSync(catalogue);
const originalCertificate = readFileSync(certificate);
let edited = false;
let certificateEdited = false;
const restore = () => {
  if (edited) writeFileSync(catalogue, original);
  if (certificateEdited) writeFileSync(certificate, originalCertificate);
  edited = false;
  certificateEdited = false;
};

/** The certificate file replaced by `contents`, until `restore` puts the original back. */
function writeCertificate(contents) {
  certificateEdited = true;
  writeFileSync(certificate, contents);
}
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

  const pem = originalCertificate.toString('utf8');
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error(`${certificate} is not a PEM certificate`);
  if (!before.sources.some((source) => source.type === 'contents' && source.id === 'codeSigningCertificate')) {
    failures.push('the code-signing certificate is not a hash source; fingerprint.config.js did not load');
  }

  // Any change to the bytes stands in for another certificate: the hash cannot tell them apart.
  writeCertificate(`${pem.trimEnd()}\n\n`);
  const rotated = await fingerprint();
  restore();
  if (rotated.hash === before.hash) {
    failures.push('another code-signing certificate left the fingerprint unchanged; its updates would reach builds that refuse them');
  }

  writeCertificate(pem.replace(/\r?\n/g, '\r\n'));
  const crlf = await fingerprint();
  restore();
  if (crlf.hash !== before.hash) {
    failures.push('the certificate with CRLF line endings changed the fingerprint; a Windows checkout would compute another runtime');
  }

  console.log(`fingerprint ${before.hash}`);
  console.log(`  ${key.join('.')} edited: ${unrelated.hash === before.hash ? 'unchanged' : unrelated.hash}`);
  console.log(`  mobile.native.displayName edited: ${native.hash === before.hash ? 'unchanged' : native.hash}`);
  console.log(`  certificate replaced: ${rotated.hash === before.hash ? 'unchanged' : rotated.hash}`);
  console.log(`  certificate with CRLF: ${crlf.hash === before.hash ? 'unchanged' : crlf.hash}`);
} finally {
  restore();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`check-fingerprint: ${failure}`);
  process.exit(1);
}
console.log('check-fingerprint: catalogue files are out of the hash, the native strings and the certificate are in it');
