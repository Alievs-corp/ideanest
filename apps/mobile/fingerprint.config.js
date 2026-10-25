/**
 * What @expo/fingerprint hashes into the runtime version beyond its defaults (#579).
 *
 * The code-signing certificate. `app.config.ts` names it, so the path and the signing metadata are
 * already in the hash through the resolved Expo config, but the file's bytes are not: the
 * fingerprint reads them nowhere, and prebuild copies them into the native project only after
 * the runtime has been decided. Without this source, a rotated certificate at the same path would
 * be the same runtime, and an update signed with the new key would be offered to every build that
 * embeds the old certificate and refuses it. With it, a new certificate is a new runtime that only
 * a new build receives.
 *
 * The contents are hashed with their line endings normalised, because a Windows checkout turns
 * the certificate's LF into CRLF and the same certificate must be the same runtime everywhere.
 * `scripts/check-fingerprint.mjs` proves both.
 *
 * The loader swallows an exception thrown here and carries on with no config, so this file only
 * reads the certificate and never throws on purpose: a missing one is an empty source, and
 * `check-fingerprint.mjs` fails on that instead.
 */
const fs = require('node:fs');
const path = require('node:path');

const CERTIFICATE = path.join(__dirname, 'certs', 'certificate.pem');

function certificate() {
  try {
    return fs.readFileSync(CERTIFICATE, 'utf8').replace(/\r\n?/g, '\n');
  } catch {
    return '';
  }
}

module.exports = {
  extraSources: [
    {
      type: 'contents',
      id: 'codeSigningCertificate',
      contents: certificate(),
      reasons: ['codeSigningCertificate'],
    },
  ],
};
