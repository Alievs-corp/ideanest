import { colors } from '@ideanest/design-tokens';
import { androidIntentData } from '@ideanest/links/claims';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import { SUPPORTED_LOCALES } from '@ideanest/messages/locale';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';

import type { ExpoConfig } from 'expo/config';
import {
  withAndroidManifest,
  withAppBuildGradle,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
  type AndroidConfig,
  type ConfigPlugin,
  type IOSConfig,
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

/**
 * The EAS project, which is where over-the-air updates are served from (§4.12 MB-13) and whose
 * id push registration asks Expo for a token with (`src/lib/push.ts`).
 *
 * `eas init` creates the project and prints the id. It is not a secret — it is in every update
 * manifest a phone downloads — so it belongs in `eas.json`'s `build.base.env`, where every
 * profile and the release workflow's `eas update` read the same value. Unset means a build with
 * updates switched off and no push token, which is what every build was before #165.
 */
const EAS_PROJECT_ID_VARIABLE = 'IDEANEST_EAS_PROJECT_ID';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function easProjectId(): string | undefined {
  const raw = process.env[EAS_PROJECT_ID_VARIABLE]?.trim();
  if (raw === undefined || raw === '') return undefined;
  if (!UUID.test(raw)) {
    throw new Error(`${EAS_PROJECT_ID_VARIABLE} is not an EAS project id: ${JSON.stringify(raw)}`);
  }
  return raw.toLowerCase();
}

const projectId = easProjectId();

/**
 * Over-the-air updates, for JavaScript-only changes and only from the manual release workflow.
 *
 * `fingerprint` hashes the native inputs — dependencies, config plugins, this configuration —
 * into the runtime version. A change that needs a new binary therefore produces a new runtime,
 * and an update published from it reaches only builds of that runtime: never a store build whose
 * native code it would not match. Each build profile's `channel` in `eas.json` is the channel its
 * builds listen on.
 */
const updates: Pick<ExpoConfig, 'runtimeVersion' | 'updates'> = {
  runtimeVersion: { policy: 'fingerprint' },
  updates:
    projectId === undefined
      ? { enabled: false }
      : { enabled: true, url: `https://u.expo.dev/${projectId}`, checkAutomatically: 'ON_LOAD' },
};

/**
 * The strings the operating system shows on the application's behalf: its name under the icon
 * and the reason in each permission prompt. They are UI, so they come from the catalogue
 * (`mobile.native`) in the reader's language rather than from literals in English (#165).
 * `src/lib/native-strings.test.ts` holds them against the catalogues.
 */
const NATIVE_CATALOGUES = { az, en, ru, tr };

/** The development language's copy, for the base `Info.plist` a missing translation falls back to. */
const BASE_NATIVE = en.mobile.native;

/**
 * Expo's per-language overrides: iOS `<lang>.lproj/InfoPlist.strings`, Android
 * `values-b+<lang>/strings.xml`. Android has no per-language permission rationale — the system
 * words its own prompts — so the name is the only Android string.
 */
export function nativeLocales(): Record<
  string,
  { ios: IOSConfig.InfoPlist; android: Record<string, string> }
> {
  return Object.fromEntries(
    Object.entries(NATIVE_CATALOGUES).map(([locale, catalogue]) => {
      const strings = catalogue.mobile.native;
      return [
        locale,
        {
          ios: {
            CFBundleDisplayName: strings.displayName,
            NSFaceIDUsageDescription: strings.faceIdUsage,
            NSCameraUsageDescription: strings.cameraUsage,
            NSPhotoLibraryUsageDescription: strings.photoLibraryUsage,
          },
          android: { app_name: strings.displayName },
        },
      ];
    }),
  );
}

/**
 * Whether this build may speak plain HTTP to the developer's machine — the API on
 * `http://10.0.2.2:8080` from an Android emulator, `http://localhost:8080` from a simulator.
 *
 * Opt-in. Allowed only when `EAS_BUILD_PROFILE` is `development` — EAS sets it on every build
 * worker from the profile's name — or when `IDEANEST_ALLOW_LOCAL_NETWORK` is `true`, which a
 * developer sets for a local `expo run` against a local API. Nothing set means not allowed: a
 * release built or prebuilt on somebody's machine, with no profile, must not carry the exception
 * because a variable was missing.
 */
export function allowsLocalNetwork(profile: string | undefined, optIn: string | undefined): boolean {
  return profile?.trim() === 'development' || optIn?.trim() === 'true';
}

/**
 * iOS: `NSAllowsLocalNetworking` in development, and taken out of every other build. Expo's
 * native template ships it switched on for every configuration, so a store build would otherwise
 * keep the exception without anybody having decided it should.
 */
export function setLocalNetworking(plist: IOSConfig.InfoPlist, allowed: boolean): IOSConfig.InfoPlist {
  const current = plist.NSAppTransportSecurity;
  const transport: Record<string, unknown> =
    current !== null && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  if (allowed) transport.NSAllowsLocalNetworking = true;
  else delete transport.NSAllowsLocalNetworking;

  const { NSAppTransportSecurity: _dropped, ...rest } = plist;
  return Object.keys(transport).length === 0
    ? rest
    : { ...rest, NSAppTransportSecurity: transport as IOSConfig.InfoPlist[string] };
}

/**
 * Android: `usesCleartextTraffic` on the application, `true` in development and `false`
 * otherwise. Android 9 and later refuse cleartext by default; saying so explicitly in a release
 * build keeps a future plugin from switching it on unnoticed.
 */
export function setCleartextTraffic(
  manifest: AndroidConfig.Manifest.AndroidManifest,
  allowed: boolean,
): AndroidConfig.Manifest.AndroidManifest {
  const applications = manifest.manifest.application ?? [];
  return {
    ...manifest,
    manifest: {
      ...manifest.manifest,
      application: applications.map((application) => ({
        ...application,
        $: { ...application.$, 'android:usesCleartextTraffic': allowed ? 'true' : 'false' },
      })),
    },
  };
}

const withLocalNetworkOnlyInDevelopment: ConfigPlugin<boolean> = (expoConfig, allowed) =>
  withAndroidManifest(
    withInfoPlist(expoConfig, (plist) => {
      plist.modResults = setLocalNetworking(plist.modResults, allowed);
      return plist;
    }),
    (manifest) => {
      manifest.modResults = setCleartextTraffic(manifest.modResults, allowed);
      return manifest;
    },
  );

/**
 * Crash reporting (#165): where reports go, or nowhere.
 *
 * <p>`IDEANEST_SENTRY_DSN` is the whole switch. Unset, the app never starts the SDK
 * (`src/lib/crash/reporting.ts`) and the privacy manifest below claims no diagnostics. Sentry's
 * EU region or a GlitchTip on the Coolify server is the owner's decision (`README.md`), and the
 * DSN is the only thing that differs between them — so no host is assumed here, for
 * `IDEANEST_REALTIME_ORIGIN`'s reason. A DSN is public by design: it is in every shipped binary.
 *
 * <p>The environment is the EAS channel. `eas.json` names each profile's channel after the profile
 * (`src/lib/crash/build-config.test.ts` holds them level), so `EAS_BUILD_PROFILE`, which EAS sets
 * while it builds, is the channel; the release workflow exports it before `eas update` too
 * (`scripts/eas-profile-env.mjs`). `IDEANEST_SENTRY_ENVIRONMENT` overrides it.
 */
function sentryDsnFromEnvironment(): string | undefined {
  const raw = process.env.IDEANEST_SENTRY_DSN?.trim();
  if (raw === undefined || raw === '') return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('IDEANEST_SENTRY_DSN is not an absolute URL.');
  }
  // https only: a crash report over plain http is a stack and a breadcrumb trail in clear.
  if (url.protocol !== 'https:' || url.username === '' || !/\/\d+$/.test(url.pathname)) {
    throw new Error('IDEANEST_SENTRY_DSN must look like https://<public key>@<host>/<project id>.');
  }
  return raw;
}

const sentryDsn = sentryDsnFromEnvironment();
const sentryEnvironment =
  process.env.IDEANEST_SENTRY_ENVIRONMENT?.trim() ||
  process.env.EAS_BUILD_PROFILE?.trim() ||
  'development';

/** The phases the Sentry plugin adds to, or creates in, the Xcode project. */
const SENTRY_XCODE_PHASES = ['Bundle React Native code and images', 'Upload Debug Symbols to Sentry'];

/** Prepended to each: no token in the build's environment means no upload, not a failed build. */
const SKIP_UPLOAD_WITHOUT_TOKEN =
  'if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then export SENTRY_DISABLE_AUTO_UPLOAD=true; fi\n';

/** One phase's script, decoded, with the gate in front of it — once. */
export function gateSentryXcodeScript(script: string): string {
  return script.startsWith(SKIP_UPLOAD_WITHOUT_TOKEN) ? script : SKIP_UPLOAD_WITHOUT_TOKEN + script;
}

const GRADLE_APPLY = /^apply from: .*"sentry\.gradle"\)[ \t\r]*$/m;
const GRADLE_GATE =
  "project.ext.shouldSentryAutoUploadGeneral = { -> System.getenv('SENTRY_DISABLE_AUTO_UPLOAD') != 'true' && (System.getenv('SENTRY_AUTH_TOKEN') ?: '') != '' }";

/** `android/app/build.gradle`, with the same gate after Sentry's `apply from` — once. */
export function gateSentryGradle(buildGradle: string): string {
  if (buildGradle.includes(GRADLE_GATE)) return buildGradle;
  if (!GRADLE_APPLY.test(buildGradle)) {
    throw new Error('The Sentry plugin did not apply sentry.gradle; the upload gate has nothing to follow.');
  }
  return buildGradle.replace(GRADLE_APPLY, (line) => `${line}\n${GRADLE_GATE}`);
}

/**
 * Source maps and debug symbols are uploaded from EAS builds only when the build has the
 * credentials — `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` (and `SENTRY_URL` for a
 * GlitchTip), set as EAS environment variables, never in this repository.
 *
 * <p>Without the gate, Sentry's build steps fail the whole build when the token is missing, and
 * their own off switch, `SENTRY_DISABLE_AUTO_UPLOAD`, would have to be set by hand on every build
 * that should not upload. The gate decides inside the build steps, from the build's own
 * environment, rather than here: a config that changed with a secret's presence would change the
 * native project's fingerprint between a build and the OTA update meant for it.
 */
const withSentryUploadOnlyWithToken: ConfigPlugin = (expoConfig) =>
  withAppBuildGradle(
    withXcodeProject(expoConfig, (project) => {
      for (const name of SENTRY_XCODE_PHASES) {
        const phase = project.modResults.pbxItemByComment(name, 'PBXShellScriptBuildPhase') as
          | { shellScript?: string }
          | undefined;
        if (phase?.shellScript === undefined) continue;
        phase.shellScript = JSON.stringify(
          gateSentryXcodeScript(JSON.parse(phase.shellScript) as string),
        );
      }
      return project;
    }),
    (gradle) => {
      if (gradle.modResults.language === 'groovy') {
        gradle.modResults.contents = gateSentryGradle(gradle.modResults.contents);
      }
      return gradle;
    },
  );

/**
 * What the app collects, as Apple's privacy manifest names it — `store/data-inventory.md` is the
 * table this list is read from, and `store/data-inventory.test.ts` holds the two level. Every
 * type is linked to the account and used for app functionality only; nothing is used to track.
 * Crash, performance and diagnostic data are collected only by a build with a DSN.
 */
const COLLECTED_DATA_TYPES = [
  'EmailAddress',
  'Name',
  'PhoneNumber',
  'PhysicalAddress',
  'UserID',
  'DeviceID',
  'PurchaseHistory',
  'OtherFinancialInfo',
  'PhotosorVideos',
  'OtherUserContent',
  'CustomerSupport',
  ...(sentryDsn === undefined ? [] : ['CrashData', 'PerformanceData', 'OtherDiagnosticData']),
];

/**
 * The privacy manifest (#165). `NSPrivacyAccessedAPITypes` lists the required-reason APIs the
 * app's dependency set reaches. Each pod that ships a manifest of its own (React Native,
 * `expo-constants`, `expo-file-system`, `expo-notifications`…) is merged into the app's at
 * `pod install` by React Native's privacy aggregation; these are the reasons the app answers for
 * itself — and for the code that ships without a manifest, like `expo-sharing`'s `UserDefaults`.
 * The final word is Xcode's privacy report on an archived build (`store/README.md`).
 */
const privacyManifests: NonNullable<ExpoConfig['ios']>['privacyManifests'] = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyAccessedAPITypes: [
    // The app's own defaults.
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
    },
    // Timestamps of files inside the app's container: caches, the MMKV store, exports.
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
      NSPrivacyAccessedAPITypeReasons: ['C617.1'],
    },
    // Time elapsed between events in the app: React Native's timing, the crash SDK's app start.
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
      NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
    },
    // Whether there is room to write a file before writing it (`expo-file-system`).
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
      NSPrivacyAccessedAPITypeReasons: ['E174.1'],
    },
  ],
  NSPrivacyCollectedDataTypes: COLLECTED_DATA_TYPES.map((type) => ({
    NSPrivacyCollectedDataType: `NSPrivacyCollectedDataType${type}`,
    NSPrivacyCollectedDataTypeLinked: true,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
  })),
};

const config: ExpoConfig = {
  name: BASE_NATIVE.displayName,
  slug: 'ideanest',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  // Every image below is rendered from the brand mark and the tokens by
  // `scripts/generate-assets.mjs`, and CI fails when they drift. Never edit one by hand.
  icon: './assets/icon.png',
  ...updates,
  locales: nativeLocales(),

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
    // The iOS 18 home-screen appearances: light, dark (the mark alone, over the system's dark
    // backdrop) and tinted (grayscale, coloured by the system).
    icon: {
      light: './assets/icon.png',
      dark: './assets/icon-dark.png',
      tinted: './assets/icon-tinted.png',
    },
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
    privacyManifests,
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
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
         * Every row of `@ideanest/links`' `CLAIMED_ROUTES` (#165), bare and under each locale
         * prefix — the table the web's association file (`apps/web/src/lib/mobile/association.ts`)
         * claims for iOS, so the two platforms open the same links. Android cannot exclude, so
         * this is an allowlist of exact paths and prefixes, and none of them reaches `/admin`. A
         * path a prefix covers that the app has no screen for (an OG image under `/projects/`)
         * opens in the in-app browser (`lib/links.ts`). `scripts/check-association.mjs` fails
         * when this list and the table disagree. Never hand-edit an entry in here.
         */
        data: androidIntentData(siteHost),
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
         * The catalogue's own list, from `@ideanest/messages/locale`: that module imports
         * nothing, so Node's loader, which the Expo CLI evaluates this file with, can read it —
         * unlike the package's root, whose extensionless TypeScript imports it cannot follow.
         * `src/lib/locale-registration.test.ts` holds the registration to the list.
         */
        supportedLocales: [...SUPPORTED_LOCALES],
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        backgroundColor: colors.surface1,
        // The UI is dark only, so the dark-mode splash is the same picture rather than a variant.
        dark: { image: './assets/splash-icon.png', backgroundColor: colors.surface1 },
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
         *
         * The base `Info.plist` gets the English sentence; `locales` above gives every other
         * language its own, from the same catalogue key.
         */
        faceIDPermission: BASE_NATIVE.faceIdUsage,
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
        photosPermission: BASE_NATIVE.photoLibraryUsage,
        cameraPermission: BASE_NATIVE.cameraUsage,
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
         * every time — so both read the one catalogue key rather than being left
         * to that ordering.
         */
        faceIDPermission: BASE_NATIVE.faceIdUsage,
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
    [
      /*
       * Crash reporting's native half and its build steps (#165). The organisation and project
       * are named and left undefined on purpose: `SENTRY_ORG` and `SENTRY_PROJECT` come from the
       * build's environment, which sentry-cli reads itself, and naming the keys is what stops the
       * plugin warning about them on every `expo config`. The upload gate is applied below.
       */
      '@sentry/react-native/expo',
      { organization: undefined, project: undefined },
    ],
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
    // Where `eas init` would write it, and where `src/lib/push.ts` reads it back.
    ...(projectId === undefined ? {} : { eas: { projectId } }),
    // Omitted when unset, like the socket: a build without a DSN starts no crash reporter.
    ...(sentryDsn === undefined ? {} : { sentryDsn }),
    sentryEnvironment,
  },
};

/*
 * Applied to the configuration itself rather than listed in `plugins`, so that its mod is
 * registered before every listed and autolinked plugin's — and Expo runs mods in reverse order of
 * registration, so this one sees the entitlements last, after `expo-apple-authentication` wrote them.
 */
export default withSentryUploadOnlyWithToken(
  withLocalNetworkOnlyInDevelopment(
    withAuthenticatorQueries(withAppleSignInOnlyWhenEnabled(config, appleSignIn)),
    allowsLocalNetwork(process.env.EAS_BUILD_PROFILE, process.env.IDEANEST_ALLOW_LOCAL_NETWORK),
  ),
);
