/**
 * Builds `store.config.json`, EAS Metadata's App Store listing, from the four listing files in
 * this directory — issue #165.
 *
 * Usage: `node apps/mobile/store/store-config.js` rewrites `apps/mobile/store.config.json`.
 * `store.test.ts` fails when the committed file is not what this builds, so the listing texts have
 * one source and the generated file cannot drift from it.
 *
 * <h2>Why a generated JSON rather than `store.config.js`</h2>
 *
 * EAS Metadata reads `store.config.json` from the project root unless a submit profile's
 * `metadataPath` points elsewhere. A JS config would need that `eas.json` entry, and it would make
 * `eas metadata:push` depend on code running at submit time; the JSON is a file a reviewer can read
 * in the pull request, exactly as App Store Connect will receive it.
 *
 * <h2>Which listings</h2>
 *
 * App Store Connect has no Azerbaijani localisation (checked 2026-10-08 against Apple's "App Store
 * localizations" reference), so the App Store gets English (U.K.) — the proposed primary language,
 * and Apple's default for Azerbaijan — Russian and Turkish. `az.json` is still written: Google Play
 * supports `az-AZ`, and the text is the app's own voice in its primary language.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Listing file → App Store Connect locale. Azerbaijani is absent on purpose; see above. */
const APPLE_LOCALES = { en: 'en-GB', ru: 'ru', tr: 'tr' };

const SITE = 'https://ideyanest.com';

/**
 * Whether the App Store version being prepared is the app's first. App Store Connect refuses
 * "What's New" (`releaseNotes`) on a first version, so `eas metadata:push` would fail with it.
 * `whatsNew` stays in the listing files for Google Play and for the next version: set this to
 * `false` once 1.0 is live, and the release notes are written again.
 */
const FIRST_VERSION = true;

function listing(locale) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, `${locale}.json`), 'utf8'));
}

function buildStoreConfig() {
  const info = {};
  for (const [locale, appleLocale] of Object.entries(APPLE_LOCALES)) {
    const text = listing(locale);
    info[appleLocale] = {
      title: text.appName,
      subtitle: text.subtitle,
      promoText: text.promotionalText,
      description: text.description,
      keywords: text.keywords.split(',').map((keyword) => keyword.trim()),
      ...(FIRST_VERSION ? {} : { releaseNotes: text.whatsNew }),
      marketingUrl: `${SITE}/${locale}`,
      supportUrl: `${SITE}/${locale}/about`,
      privacyPolicyUrl: `${SITE}/${locale}/legal/privacy-policy`,
    };
  }
  return { configVersion: 0, apple: { info } };
}

const OUTPUT = path.join(__dirname, '..', 'store.config.json');

function render() {
  return `${JSON.stringify(buildStoreConfig(), null, 2)}\n`;
}

if (require.main === module) {
  fs.writeFileSync(OUTPUT, render());
  console.log(`Wrote ${OUTPUT}`);
}

module.exports = { APPLE_LOCALES, FIRST_VERSION, OUTPUT, buildStoreConfig, render };
