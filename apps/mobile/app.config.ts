import { colors } from '@ideanest/design-tokens';
import { SUPPORTED_LOCALES } from '@ideanest/messages/locale';
import type { ExpoConfig } from 'expo/config';
import {
  withAndroidManifest,
  withEntitlementsPlist,
  type AndroidConfig,
  type ConfigPlugin,
} from 'expo/config-plugins';

/**
 * The Expo configuration — §14.3, and half of the deep links (§4.12 MB-02).
 *
 * <h2>Why this is `app.config.ts` and not `app.json`</h2>
 *
 * Three of the values below are per-environment: the origin the application talks
 * to, the origin whose links it claims, and — optionally — the origin of the live
 * campaign counter's socket. A static `app.json` would hard-code
 * production into every build, which is the same mistake `lib/seo/sitemap/config.ts`
 * refuses on the web — a staging build that advertises production URLs is a lie
 * somebody eventually believes. The variable names are deliberately the web's
 * own, so a deployment answers "where is the API" once rather than twice.
 */

/** Where the Spring Boot service listens. */
const API_ORIGIN_VARIABLE = 'IDEANEST_API_ORIGIN';
/** The public origin whose links this application claims. */
const SITE_URL_VARIABLE = 'IDEANEST_SITE_URL';

/**
 * Where the campaign page may open §12.1's live-counter socket (#155) — the web's own variable,
 * spelled out because this file cannot import `@ideanest/campaign` (see the `expo-localization`
 * note below).
 *
 * Unlike the two above it has **no default**. Unset means the build opens no socket and the
 * campaign figures stay as the page read them, which is exactly what the web does when the
 * same variable is unset; a guessed host would be a build that quietly holds a connection
 * attempt open against somebody else's server.
 */
const REALTIME_ORIGIN_VARIABLE = 'IDEANEST_REALTIME_ORIGIN';

const DEFAULT_API_ORIGIN = 'http://localhost:8080';
const DEFAULT_SITE_URL = 'https://ideyanest.com';

const HTTP = ['http:', 'https:'] as const;
/** A socket origin may be written as the API's (`https://`) or as a socket's own (`wss://`). */
const HTTP_OR_SOCKET = ['http:', 'https:', 'ws:', 'wss:'] as const;

/**
 * A set variable as an origin with no trailing slash, `undefined` when unset, or a thrown build.
 *
 * Set-but-unusable throws rather than falling back, for `siteUrl()`'s reason: an
 * unset variable is somebody running locally, and a variable set to `ideyanest.com`
 * without a scheme is a misconfiguration that would otherwise ship a build
 * pointing at localhost.
 */
function optionalOrigin(variable: string, protocols: readonly string[]): string | undefined {
  const raw = process.env[variable]?.trim();
  if (raw === undefined || raw === '') return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${variable} is not an absolute URL: ${JSON.stringify(raw)}`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(
      `${variable} must be ${protocols.map((protocol) => protocol.slice(0, -1)).join(' or ')}, not ${url.protocol}`,
    );
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/** {@link optionalOrigin} for a variable that has a local default. */
function origin(variable: string, fallback: string): string {
  return optionalOrigin(variable, HTTP) ?? fallback;
}

const siteUrl = origin(SITE_URL_VARIABLE, DEFAULT_SITE_URL);
const realtimeOrigin = optionalOrigin(REALTIME_ORIGIN_VARIABLE, HTTP_OR_SOCKET);
const siteHost = new URL(siteUrl).host;

/**
 * The three Inter weights the type scale uses, as module specifiers the `expo-font` plugin
 * resolves itself — so the files come from the package at its locked version rather than from a
 * copy in `assets/` that nobody updates. `src/theme/fonts.test.ts` holds this list against the
 * faces `src/theme/index.ts` asks for.
 */
const INTER_FACES = [
  {
    family: 'Inter-Regular',
    path: '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
    weight: 400,
  },
  {
    family: 'Inter-Medium',
    path: '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
    weight: 500,
  },
  {
    family: 'Inter-SemiBold',
    path: '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
    weight: 600,
  },
];

/** The bundle identifier, which is also the scheme Google's iOS client redirects to. */
const BUNDLE_ID = 'az.ideanest.app';

/**
 * The provider sign-ins this build offers (issue #152) — the web's `configuredProviders()`,
 * decided at build time.
 *
 *   - `IDEANEST_GOOGLE_IOS_CLIENT_ID`: Google's iOS OAuth client. Unset means no Google button
 *     on iOS, because the service would refuse a token whose audience it does not list
 *     (`GOOGLE_CLIENT_IDS` must carry the same value).
 *   - `IDEANEST_APPLE_SIGN_IN`: `true` turns on Sign in with Apple — the entitlement and the
 *     button. The bundle identifier must be in `APPLE_CLIENT_IDS`.
 *
 * Google on Android is not offered yet; `src/lib/providers.ts` says why.
 */
const googleIosClientId = process.env.IDEANEST_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
const appleSignIn = process.env.IDEANEST_APPLE_SIGN_IN?.trim() === 'true';

/**
 * Whether a plan is chosen and cancelled inside the app (#164). Off unless
 * `IDEANEST_IN_APP_PLAN_CHOICE` is `true`.
 *
 * <p>A plan unlocks publishing, and both stores generally require their own billing for a
 * subscription that unlocks app functionality (App Review 3.1.1, Google Play's payments policy).
 * Until the owner decides between store billing and a written exemption, the app shows the plans
 * and what the reader holds, and the choice is made on the web. Turn this on only with that
 * decision recorded.
 */
const inAppPlanChoice = process.env.IDEANEST_IN_APP_PLAN_CHOICE?.trim() === 'true';

/**
 * Takes the Sign in with Apple entitlement back out when this build does not offer it.
 *
 * <p>`expo-apple-authentication`'s config plugin is AUTOLINKED — it runs because the package is
 * installed, listed or not (the trap `expo-image-picker` set in #151) — and it adds
 * `com.apple.developer.applesignin` unconditionally. A build whose provisioning profile lacks the
 * capability would then fail to sign, and EAS-managed credentials would switch the capability on
 * for the App ID without anybody deciding to. So the variable decides; see the export for why
 * it is applied where it is.
 */
const withAppleSignInOnlyWhenEnabled: ConfigPlugin<boolean> = (expoConfig, enabled) =>
  withEntitlementsPlist(expoConfig, (entitlements) => {
    if (!enabled) delete entitlements.modResults['com.apple.developer.applesignin'];
    return entitlements;
  });

/**
 * The scheme an authenticator app answers to. Two-factor enrolment (#161) asks
 * `Linking.canOpenURL` whether one is installed before offering "Open in your authenticator app",
 * and both platforms answer "no" for a scheme the app did not declare: iOS reads
 * `LSApplicationQueriesSchemes` (below), Android 11+ reads the manifest's `<queries>`.
 */
const AUTHENTICATOR_SCHEME = 'otpauth';

/** Adds `<queries><intent>VIEW otpauth:</intent></queries>`, once, beside whatever is there. */
export function addAuthenticatorQuery(
  manifest: AndroidConfig.Manifest.AndroidManifest,
): AndroidConfig.Manifest.AndroidManifest {
  const queries = manifest.manifest.queries ?? [];
  const declared = queries.some((query) =>
    (query.intent ?? []).some((intent) =>
      (intent.data ?? []).some((data) => data.$['android:scheme'] === AUTHENTICATOR_SCHEME),
    ),
  );
  if (declared) return manifest;
  const intent = {
    action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
    data: [{ $: { 'android:scheme': AUTHENTICATOR_SCHEME } }],
  };
  return {
    ...manifest,
    manifest: { ...manifest.manifest, queries: [...queries, { intent: [intent] }] },
  };
}

const withAuthenticatorQueries: ConfigPlugin = (expoConfig) =>
  withAndroidManifest(expoConfig, (manifest) => {
    manifest.modResults = addAuthenticatorQuery(manifest.modResults);
    return manifest;
  });

const config: ExpoConfig = {
  name: 'IdeyaNest',
  slug: 'ideanest',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  icon: './assets/icon.png',

  /**
   * The custom scheme. `ideanest://projects/<creator>/<campaign>` is what a push
   * notification opens, and it works with no server involvement — which is why
   * Push (§4.12 MB-01) uses it rather than an https link that depends on a verification file
   * being reachable.
   */
  // Google's redirect (`az.ideanest.app:/oauthredirect`) needs no scheme here: prebuild already
  // registers the bundle identifier on iOS, and the browser session hands the callback back itself.
  scheme: 'ideanest',

  ios: {
    bundleIdentifier: BUNDLE_ID,
    usesAppleSignIn: appleSignIn,
    supportsTablet: false,
    /**
     * Universal links. `applinks:` is what makes iOS ask
     * `https://<host>/.well-known/apple-app-site-association` whether this
     * application may open that host's URLs; the file is served by `apps/web`,
     * so the two halves of §4.12 MB-02 sit in one pull request on purpose.
     */
    associatedDomains: [`applinks:${siteHost}`],
    infoPlist: {
      // A shared campaign opened from Safari must reach the same screen a push
      // does, and a phone with no network still has to render the saved copy.
      ITSAppUsesNonExemptEncryption: false,
      // Without it `canOpenURL('otpauth://…')` is always false; see AUTHENTICATOR_SCHEME.
      LSApplicationQueriesSchemes: [AUTHENTICATOR_SCHEME],
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: colors.surface1,
    },
    /**
     * App Links. `autoVerify` is what stops Android showing a disambiguation
     * sheet: it fetches `https://<host>/.well-known/assetlinks.json` at install
     * time and, if this package's signing fingerprint is in it, opens the link
     * directly.
     */
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        /*
         * Campaign pages; #153's discovery entry points: the home page, the feed and search, each
         * an exact path whose state rides in the query string; and #154's browse pages, the
         * category and collection indexes and everything under them — bare, and under every
         * locale prefix, because the site serves every page there and that is the URL people
         * share. The entries share one scheme and one host, so they add up to these paths and
         * nothing more. A path under a prefix that the app has no screen for (`/categories/a/b/c`)
         * is refused by `lib/links.ts`, as a deeper path under `/projects` already is.
         * The web's association file (`apps/web/src/lib/mobile/association.ts`) claims the same,
         * for iOS.
         */
        data: ['', ...SUPPORTED_LOCALES.map((locale) => `/${locale}`)].flatMap((root) => [
          { scheme: 'https', host: siteHost, pathPrefix: `${root}/projects` },
          { scheme: 'https', host: siteHost, path: root === '' ? '/' : root },
          { scheme: 'https', host: siteHost, path: `${root}/discover` },
          { scheme: 'https', host: siteHost, path: `${root}/search` },
          // Exactly as the web's association file does: the index, and everything under it.
          { scheme: 'https', host: siteHost, path: `${root}/categories` },
          { scheme: 'https', host: siteHost, pathPrefix: `${root}/categories/` },
          { scheme: 'https', host: siteHost, path: `${root}/collections` },
          { scheme: 'https', host: siteHost, pathPrefix: `${root}/collections/` },
        ]),
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },

  plugins: [
    'expo-router',
    [
      'expo-font',
      {
        /*
         * Inter, embedded in the binary rather than loaded by `useFonts` at startup, so the first
         * frame is already in the right typeface (issue #151). Every face answers to its
         * PostScript name on both platforms: iOS reads it from the file, and Android gets one XML
         * family per face under the same name. Not one `Inter` family with three weights —
         * below Android 9 React Native rounds 500 and 600 down to regular before it asks.
         */
        ios: { fonts: INTER_FACES.map(({ path }) => path) },
        android: {
          fonts: INTER_FACES.map(({ family, path, weight }) => ({
            fontFamily: family,
            fontDefinitions: [{ path, weight }],
          })),
        },
      },
    ],
    [
      'expo-localization',
      {
        /**
         * The four languages, registered with the operating system (issue #150): iOS
         * `CFBundleLocalizations` and Android's `localeConfig`, so the per-app language
         * setting on both lists exactly these.
         *
         * Spelled out rather than imported from `@ideanest/messages`: the Expo CLI loads this
         * file with Node's own ESM loader, which cannot resolve that package's extensionless
         * TypeScript imports. `src/lib/locale-registration.test.ts` holds the two lists level,
         * so a fifth language cannot reach the catalogues without reaching the settings too.
         */
        supportedLocales: ['az', 'en', 'ru', 'tr'],
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        backgroundColor: colors.surface1,
      },
    ],
    [
      'expo-secure-store',
      {
        /**
         * `NSFaceIDUsageDescription`, and it is the one string in this file a
         * stranger reads.
         *
         * iOS refuses to present a Face ID prompt at all without it — the call
         * fails rather than the sheet appearing — so the lock's (MB-03) whole feature is one
         * missing Info.plist key away from being silently unavailable on every
         * iPhone. The plugin's own default says "access your Face ID biometric
         * data", which is both alarming and untrue: the application never sees
         * biometric data, it asks the operating system whether the device owner
         * is present. This says what actually happens and why.
         */
        faceIDPermission: 'IdeyaNest uses Face ID to unlock the session kept on this device.',
      },
    ],
    [
      /*
       * The photo library and the camera, for the UI kit's `FilePicker` (issue #151) — a campaign
       * cover, an avatar. The plugin runs whether or not it is listed, because the package is
       * autolinked, and its defaults add a microphone permission this app never uses and prompts
       * in generic English. Stating it here is what turns the microphone off and gives the
       * prompts a reason a reviewer and a backer can read.
       */
      'expo-image-picker',
      {
        photosPermission:
          'IdeyaNest opens your photos so you can choose a campaign image or an avatar.',
        cameraPermission:
          'IdeyaNest uses the camera so you can take a campaign image or an avatar.',
        microphonePermission: false,
      },
    ],
    [
      'expo-local-authentication',
      {
        /**
         * The same sentence as `expo-secure-store` above, and it has to be the
         * same sentence.
         *
         * Both plugins write `NSFaceIDUsageDescription`, and Expo's permissions
         * plugin lets the last one win. Two different descriptions would mean
         * the prompt saying whichever of them the plugin order happened to
         * leave in the plist — a string a reviewer reads once and a user reads
         * every time — so it is stated identically rather than left to that
         * ordering.
         */
        faceIDPermission: 'IdeyaNest uses Face ID to unlock the session kept on this device.',
      },
    ],
    [
      'expo-notifications',
      {
        // A token rather than a literal, for docs/ui-kit.md §2's reason: an
        // Android notification icon tint is as much part of the palette as a
        // card is, and it is the one that ends up on a lock screen.
        color: colors.lime500,
        icon: './assets/notification-icon.png',
      },
    ],
    'expo-apple-authentication',
  ],

  experiments: { typedRoutes: true },

  extra: {
    apiOrigin: origin(API_ORIGIN_VARIABLE, DEFAULT_API_ORIGIN),
    siteUrl,
    // Omitted rather than `undefined` when unset, so the manifest says nothing about a socket.
    ...(realtimeOrigin === undefined ? {} : { realtimeOrigin }),
    googleIosClientId,
    appleSignIn,
    inAppPlanChoice,
  },
};

/*
 * Applied to the configuration itself rather than listed in `plugins`, so that its mod is
 * registered before every listed and autolinked plugin's — and Expo runs mods in reverse order of
 * registration, so this one sees the entitlements last, after `expo-apple-authentication` wrote them.
 */
export default withAuthenticatorQueries(withAppleSignInOnlyWhenEnabled(config, appleSignIn));
