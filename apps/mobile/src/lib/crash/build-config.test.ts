import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpoConfig } from 'expo/config';

/**
 * Crash reporting's half of `app.config.ts` (#165): the DSN switch, the environment, and the gate
 * that keeps a build without Sentry credentials from failing at the upload step.
 *
 * The gate is tested against what Sentry's own plugin writes — its exported helpers produce the
 * Gradle file and the Xcode script the gate edits — because a gate tested against a hand-written
 * copy would keep passing after the plugin changed the line it looks for.
 */

type AppConfig = typeof import('../../../app.config');

const VARIABLES = ['IDEANEST_SENTRY_DSN', 'IDEANEST_SENTRY_ENVIRONMENT', 'EAS_BUILD_PROFILE'] as const;

function loadWith(env: Partial<Record<(typeof VARIABLES)[number], string>>): AppConfig {
  const previous = VARIABLES.map((name) => [name, process.env[name]] as const);
  for (const name of VARIABLES) {
    const value = env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    let loaded: AppConfig | undefined;
    jest.isolateModules(() => {
      loaded = require('../../../app.config') as AppConfig;
    });
    if (loaded === undefined) throw new Error('app.config.ts did not load');
    return loaded;
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const config = (env: Parameters<typeof loadWith>[0] = {}): ExpoConfig => loadWith(env).default;

const DSN = 'https://0123abcd@o42.ingest.de.sentry.io/4507';

const collected = (expo: ExpoConfig): string[] =>
  (expo.ios?.privacyManifests?.NSPrivacyCollectedDataTypes ?? []).map(
    (entry) => entry.NSPrivacyCollectedDataType,
  );

describe('IDEANEST_SENTRY_DSN', () => {
  it('leaves the DSN out of extra, and diagnostics out of the privacy manifest, when unset', () => {
    const expo = config();
    expect(expo.extra).not.toHaveProperty('sentryDsn');
    expect(collected(expo)).not.toContain('NSPrivacyCollectedDataTypeCrashData');
  });

  it('passes a DSN through, and declares crash, performance and diagnostic data', () => {
    const expo = config({ IDEANEST_SENTRY_DSN: DSN });
    expect(expo.extra?.sentryDsn).toBe(DSN);
    expect(collected(expo)).toEqual(
      expect.arrayContaining([
        'NSPrivacyCollectedDataTypeCrashData',
        'NSPrivacyCollectedDataTypePerformanceData',
        'NSPrivacyCollectedDataTypeOtherDiagnosticData',
      ]),
    );
  });

  it.each([
    ['not a URL', 'o42.ingest.sentry.io/4507'],
    ['plain http', 'http://0123abcd@o42.ingest.de.sentry.io/4507'],
    ['no public key', 'https://o42.ingest.de.sentry.io/4507'],
    ['no project id', 'https://0123abcd@o42.ingest.de.sentry.io/'],
  ])('throws the build on a DSN that is %s', (_what, value) => {
    expect(() => config({ IDEANEST_SENTRY_DSN: value })).toThrow(/IDEANEST_SENTRY_DSN/);
  });
});

describe('the crash environment', () => {
  it("is the EAS profile's channel while EAS builds, the override for an update, development otherwise", () => {
    expect(config({ EAS_BUILD_PROFILE: 'production' }).extra?.sentryEnvironment).toBe('production');
    expect(
      config({ EAS_BUILD_PROFILE: 'production', IDEANEST_SENTRY_ENVIRONMENT: 'preview' }).extra
        ?.sentryEnvironment,
    ).toBe('preview');
    expect(config().extra?.sentryEnvironment).toBe('development');
  });

  it("can use the profile's name because every profile's channel is its name", () => {
    const eas = JSON.parse(readFileSync(join(__dirname, '../../../eas.json'), 'utf8')) as {
      build: Record<string, { channel?: string }>;
    };
    const withChannels = Object.entries(eas.build).filter(([, profile]) => profile.channel !== undefined);
    expect(withChannels.length).toBeGreaterThan(0);
    for (const [name, profile] of withChannels) expect(profile.channel).toBe(name);
  });
});

describe('the source-map upload gate', () => {
  const { gateSentryGradle, gateSentryXcodeScript } = loadWith({});
  const sentryAndroid = require('@sentry/react-native/plugin/build/withSentryAndroid') as {
    modifyAppBuildGradle: (gradle: string) => string;
  };
  const sentryIos = require('@sentry/react-native/plugin/build/withSentryIOS') as {
    addSentryWithBundledScriptsToBundleShellScript: (script: string) => string;
  };

  it("overrides sentry.gradle's upload switch right after Sentry applies it, once", () => {
    const gradle = sentryAndroid.modifyAppBuildGradle('plugins {}\n\nandroid {\n  namespace "x"\n}\n');
    const gated = gateSentryGradle(gradle);
    const lines = gated.split('\n');
    const applied = lines.findIndex((line) => line.includes('"sentry.gradle")'));

    expect(lines[applied + 1]).toMatch(/^project\.ext\.shouldSentryAutoUploadGeneral = .*SENTRY_AUTH_TOKEN/);
    expect(gateSentryGradle(gated)).toBe(gated);
  });

  it("refuses a Gradle file Sentry's plugin did not touch, rather than gating nothing", () => {
    expect(() => gateSentryGradle('android {\n}\n')).toThrow(/sentry\.gradle/);
  });

  it('turns the Xcode upload off when the build has no token, once', () => {
    const script = sentryIos.addSentryWithBundledScriptsToBundleShellScript(
      '`"$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'"`\n',
    );
    const gated = gateSentryXcodeScript(script);

    expect(gated.split('\n')[0]).toBe(
      'if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then export SENTRY_DISABLE_AUTO_UPLOAD=true; fi',
    );
    expect(gated.endsWith(script)).toBe(true);
    expect(gateSentryXcodeScript(gated)).toBe(gated);
  });
});
