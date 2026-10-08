#!/usr/bin/env node
/**
 * Prints the environment an EAS build of one `eas.json` profile evaluates `app.config.ts` with,
 * as `KEY=VALUE` lines for `$GITHUB_ENV` — #165.
 *
 * Usage: `node apps/mobile/scripts/eas-profile-env.mjs <profile> [android|ios]`
 *
 * Why it exists: `eas update` reads its environment from the shell, not from `eas.json`'s build
 * profiles. The runtime version is a fingerprint of the evaluated configuration, `extra` included,
 * so an update published without the profile's `IDEANEST_*` values would carry the wrong API
 * origin, hash to a different runtime, and reach none of the builds it was meant for. The release
 * workflow exports this before `eas build` and `eas update` alike, so both evaluate the same file
 * the same way. `EAS_BUILD_PROFILE` is what EAS sets on its build workers; setting it here is
 * what keeps `app.config.ts`'s development-only exceptions out of the update too.
 *
 * The merge is `@expo/eas-json`'s: `extends` resolved base first, then the platform's own `env`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const easJson = JSON.parse(readFileSync(join(here, '..', 'eas.json'), 'utf8'));

function resolve(name, depth = 0) {
  if (depth >= 5) throw new Error('eas.json: "extends" chain too long or circular');
  const profile = easJson.build?.[name];
  if (profile === undefined) {
    throw new Error(`eas.json has no build profile "${name}"`);
  }
  const { extends: parent, ...rest } = profile;
  if (parent === undefined) return rest;
  const base = resolve(parent, depth + 1);
  return {
    ...base,
    ...rest,
    env: { ...base.env, ...rest.env },
    android: { ...base.android, ...rest.android },
    ios: { ...base.ios, ...rest.ios },
  };
}

const [name, platform] = process.argv.slice(2);
if (name === undefined || (platform !== undefined && platform !== 'android' && platform !== 'ios')) {
  console.error('Usage: eas-profile-env.mjs <profile> [android|ios]');
  process.exit(2);
}

const profile = resolve(name);
const env = {
  ...profile.env,
  ...(platform === undefined ? {} : profile[platform]?.env),
  EAS_BUILD_PROFILE: name,
};

for (const [key, value] of Object.entries(env)) {
  if (/[\r\n]/.test(String(value))) throw new Error(`eas.json: ${key} spans lines`);
  console.log(`${key}=${value}`);
}
