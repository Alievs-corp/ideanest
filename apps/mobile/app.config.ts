import { colors } from '@ideanest/design-tokens';
import type { ExpoConfig } from 'expo/config';

/**
 * The Expo configuration — §14.3, and half of the deep links (§4.12 MB-02).
 *
 * <h2>Why this is `app.config.ts` and not `app.json`</h2>
 *
 * Two of the values below are per-environment: the origin the application talks
 * to, and the origin whose links it claims. A static `app.json` would hard-code
 * production into every build, which is the same mistake `lib/seo/sitemap/config.ts`
 * refuses on the web — a staging build that advertises production URLs is a lie
 * somebody eventually believes. The variable names are deliberately the web's
 * own, so a deployment answers "where is the API" once rather than twice.
 */

/** Where the Spring Boot service listens. */
const API_ORIGIN_VARIABLE = 'IDEANEST_API_ORIGIN';
/** The public origin whose links this application claims. */
const SITE_URL_VARIABLE = 'IDEANEST_SITE_URL';

const DEFAULT_API_ORIGIN = 'http://localhost:8080';
const DEFAULT_SITE_URL = 'https://ideyanest.com';

/**
 * An origin, with no trailing slash, or a thrown build.
 *
 * Set-but-unusable throws rather than falling back, for `siteUrl()`'s reason: an
 * unset variable is somebody running locally, and a variable set to `ideyanest.com`
 * without a scheme is a misconfiguration that would otherwise ship a build
 * pointing at localhost.
 */
function origin(variable: string, fallback: string): string {
  const raw = process.env[variable]?.trim();
  if (raw === undefined || raw === '') return fallback;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${variable} is not an absolute URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${variable} must be http or https, not ${url.protocol}`);
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

const siteUrl = origin(SITE_URL_VARIABLE, DEFAULT_SITE_URL);
const siteHost = new URL(siteUrl).host;

/**
 * The three Inter weights the type scale uses, as module specifiers the `expo-font` plugin
 * resolves itself — so the files come from the package at its locked version rather than from a
 * copy in `assets/` that nobody updates. `src/theme/fonts.test.ts` holds this list against the
 * faces `src/theme/index.ts` asks for.
 */
const INTER_FACES = [
  { path: '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf', weight: 400 },
  { path: '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf', weight: 500 },
  { path: '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf', weight: 600 },
];

const config: ExpoConfig = {
  name: 'IdeyaNest',
  slug: 'ideanest',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  icon: './assets/icon.png',

  /**
   * The custom scheme. `ideanest://project/<creator>/<campaign>` is what a push
   * notification opens, and it works with no server involvement — which is why
   * Push (§4.12 MB-01) uses it rather than an https link that depends on a verification file
   * being reachable.
   */
  scheme: 'ideanest',

  ios: {
    bundleIdentifier: 'az.ideanest.app',
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
    },
  },

  android: {
    package: 'az.ideanest.app',
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
        data: [{ scheme: 'https', host: siteHost, pathPrefix: '/projects' }],
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
         * frame is already in the right typeface (issue #151). Each platform gets the shape
         * `src/theme/index.ts`'s `font` reads: iOS registers the three files and finds each by
         * its PostScript name; Android gets one XML family called `Inter` with a weight per
         * file, which is what lets a weight choose a face there.
         */
        ios: { fonts: INTER_FACES.map(({ path }) => path) },
        android: { fonts: [{ fontFamily: 'Inter', fontDefinitions: INTER_FACES }] },
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
  ],

  experiments: { typedRoutes: true },

  extra: {
    apiOrigin: origin(API_ORIGIN_VARIABLE, DEFAULT_API_ORIGIN),
    siteUrl,
  },
};

export default config;
