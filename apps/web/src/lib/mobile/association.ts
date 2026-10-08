import { appleComponents, type AppleComponent } from '@ideanest/links/claims';

/**
 * The two files that let a link on this site open the mobile application —
 * §4.12 MB-02, the half that lives on the web.
 *
 * <h2>Why this is a module and not two route handlers with literals in them</h2>
 *
 * Neither file can be a static asset. Both name an identifier that only exists
 * once an application has been signed — Apple's team prefix, and the SHA-256 of
 * the Android signing certificate — and both differ between the internal build
 * and the store build (`apps/mobile/eas.json`, §19.2). A literal here would
 * be one of those two, wrong for the other, and wrong in a way nothing fails on:
 * the operating system fetches the file, disagrees with it, and quietly stops
 * treating the link as a universal one. Nobody sees an error. The link just
 * opens the browser for ever.
 *
 * <h2>Unconfigured answers 404, and never a file</h2>
 *
 * A deployment that has not been told the identifiers serves neither file. That
 * is deliberate and it is the safer of the two failures: a 404 is what both
 * platforms already expect from a site with no application, and they retry. A
 * file served with a placeholder identifier is a file iOS caches — its CDN holds
 * an association for as long as a week — so a wrong one shipped once outlives
 * the deployment that fixed it.
 */

/**
 * Apple's team prefix joined to the bundle identifier, e.g. `ABCDE12345.az.ideanest.app`.
 *
 * The prefix is not a secret — it is readable from any signed build — but it is
 * environment-specific, which is the reason it is read rather than written down.
 */
export const IOS_APP_ID_VARIABLE = 'IDEANEST_IOS_APP_ID';

/**
 * The Android package name. Matches `android.package` in `apps/mobile/app.config.ts`.
 *
 * Configurable because the internal-distribution build carries a different one:
 * two applications that claim the same package cannot be installed side by side,
 * and testers need both.
 */
export const ANDROID_PACKAGE_VARIABLE = 'IDEANEST_ANDROID_PACKAGE';

/**
 * The SHA-256 fingerprints of the certificates Android builds are signed with,
 * comma-separated.
 *
 * A list rather than one value because a release rotates: Play App Signing
 * introduces a new certificate while the old one is still on installed devices,
 * and an assetlinks file naming only the new one breaks every link on every
 * phone that has not updated yet.
 */
export const ANDROID_FINGERPRINTS_VARIABLE = 'IDEANEST_ANDROID_SHA256_FINGERPRINTS';

/**
 * The paths a link may open the mobile application at, and the paths it never may — issue #165.
 *
 * Built from `@ideanest/links`' claimed-route table, which `apps/mobile/app.config.ts` builds
 * Android's intent filters from and the app's link parser answers, so the three halves of a
 * link cannot drift. The excludes come first because iOS stops at the first component that
 * matches: `/projects/*` would otherwise hand an OG image under it to the application. Every
 * claim is listed bare and under each locale, because the site serves every page under its
 * locale (`i18n/routing.ts`, `localePrefix: 'always'`) and that is the URL people copy, while
 * the API's emails and the app's own share sheet send the bare form, which the site redirects.
 */
export function claimedComponents(): readonly AppleComponent[] {
  return appleComponents();
}

type Env = Record<string, string | undefined>;

function configured(env: Env, variable: string): string | null {
  const raw = env[variable];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Apple's association document, or `null` when this deployment has no iOS
 * application.
 *
 * The modern `components` form rather than the legacy `paths` array. Both are
 * still read, but `paths` is matched against a percent-decoded path in a way
 * Apple's own documentation calls out as ambiguous, and `components` can say
 * "never this" (`exclude`), which the claim needs for `/admin` and the OG images.
 *
 * `apps: []` is required and not decorative: iOS reads its absence as a
 * malformed file rather than as an empty list.
 */
export function appleAppSiteAssociation(env: Env = process.env): unknown | null {
  const appId = configured(env, IOS_APP_ID_VARIABLE);
  if (appId === null) return null;

  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [appId],
          components: claimedComponents(),
        },
      ],
    },
  };
}

/**
 * Android's Digital Asset Links statement, or `null` when this deployment has no
 * Android application.
 *
 * One statement per fingerprint rather than one statement listing all of them.
 * Both are valid; the split form is what Play Console emits and what its
 * verification tester compares against, and a file that differs from what the
 * tester expects is a file somebody spends an afternoon on.
 */
export function assetLinks(env: Env = process.env): unknown[] | null {
  const packageName = configured(env, ANDROID_PACKAGE_VARIABLE);
  const fingerprints = configured(env, ANDROID_FINGERPRINTS_VARIABLE)
    ?.split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value !== '');

  if (packageName === null || fingerprints === undefined || fingerprints.length === 0) {
    return null;
  }

  return fingerprints.map((fingerprint) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: [fingerprint],
    },
  }));
}
