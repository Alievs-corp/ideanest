import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpoConfig } from 'expo/config';
import type { AndroidConfig, IOSConfig } from 'expo/config-plugins';

/**
 * The build-time half of #165: over-the-air updates, the development-only network exceptions,
 * the generated images, and the `eas.json` profiles the release workflow relies on.
 */

type AppConfigModule = typeof import('../../app.config');
type Manifest = AndroidConfig.Manifest.AndroidManifest;
type Mod<T> = (config: Record<string, unknown>) => Promise<{ modResults: T }>;
type WithMods = ExpoConfig & {
  mods?: { ios?: { infoPlist?: Mod<IOSConfig.InfoPlist> }; android?: { manifest?: Mod<Manifest> } };
};

const MOBILE_ROOT = join(__dirname, '..', '..');

/** `app.config.ts` evaluated afresh with `env` laid over the test process's environment. */
function loadConfig(env: Record<string, string | undefined>): AppConfigModule {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    let loaded: AppConfigModule | undefined;
    jest.isolateModules(() => {
      loaded = require('../../app.config') as AppConfigModule;
    });
    if (loaded === undefined) throw new Error('app.config.ts did not load');
    return loaded;
  } finally {
    process.env = saved;
  }
}

/** Expo's own iOS template: ATS on, with local networking allowed for every configuration. */
function templatePlist(): IOSConfig.InfoPlist {
  return {
    CFBundleDisplayName: 'HelloWorld',
    NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true },
  };
}

function bareManifest(): Manifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      application: [{ $: { 'android:name': '.MainApplication' } }],
    },
  };
}

/** Runs the configuration's registered mods the way prebuild would, on the given native files. */
async function nativeFilesFor(profile: string | undefined, optIn?: string) {
  const config = loadConfig({ EAS_BUILD_PROFILE: profile, IDEANEST_ALLOW_LOCAL_NETWORK: optIn })
    .default as WithMods;
  const request = (platform: string, modName: string) => ({
    platform,
    modName,
    projectRoot: MOBILE_ROOT,
    platformProjectRoot: MOBILE_ROOT,
    introspect: false,
  });
  const infoPlist = config.mods?.ios?.infoPlist;
  const manifest = config.mods?.android?.manifest;
  if (infoPlist === undefined || manifest === undefined) throw new Error('no native mods registered');
  const plist = await infoPlist({
    ...config,
    modResults: templatePlist(),
    modRequest: request('ios', 'infoPlist'),
  });
  const android = await manifest({
    ...config,
    modResults: bareManifest(),
    modRequest: request('android', 'manifest'),
  });
  return {
    ats: plist.modResults.NSAppTransportSecurity as Record<string, unknown> | undefined,
    cleartext: android.modResults.manifest.application?.[0]?.$['android:usesCleartextTraffic'],
  };
}

describe('plain HTTP to a local machine', () => {
  const { allowsLocalNetwork, setLocalNetworking, setCleartextTraffic } = loadConfig({});

  it.each([
    [undefined, undefined, false],
    ['', undefined, false],
    ['development', undefined, true],
    [' development ', undefined, true],
    ['preview', undefined, false],
    ['production', undefined, false],
    ['anything-else', undefined, false],
    [undefined, 'true', true],
    [undefined, 'false', false],
    [undefined, '1', false],
    [undefined, '', false],
    ['production', 'true', true],
  ])('is allowed for EAS_BUILD_PROFILE=%p, IDEANEST_ALLOW_LOCAL_NETWORK=%p: %p', (profile, optIn, expected) => {
    expect(allowsLocalNetwork(profile, optIn)).toBe(expected);
  });

  it('takes the template’s NSAllowsLocalNetworking out and keeps the rest of ATS', () => {
    expect(setLocalNetworking(templatePlist(), false).NSAppTransportSecurity).toEqual({
      NSAllowsArbitraryLoads: false,
    });
  });

  it('adds NSAllowsLocalNetworking where there was no ATS dictionary', () => {
    expect(setLocalNetworking({}, true).NSAppTransportSecurity).toEqual({ NSAllowsLocalNetworking: true });
    expect(setLocalNetworking({}, false)).toEqual({});
  });

  it('says usesCleartextTraffic outright on the Android application', () => {
    expect(setCleartextTraffic(bareManifest(), true).manifest.application?.[0]?.$).toMatchObject({
      'android:usesCleartextTraffic': 'true',
    });
    expect(setCleartextTraffic(bareManifest(), false).manifest.application?.[0]?.$).toMatchObject({
      'android:usesCleartextTraffic': 'false',
    });
  });

  it.each(['production', 'preview', undefined])('is not in a %s build on either platform', async (profile) => {
    const files = await nativeFilesFor(profile);
    expect(files.ats).toEqual({ NSAllowsArbitraryLoads: false });
    expect(files.ats).not.toHaveProperty('NSAllowsLocalNetworking');
    expect(files.cleartext).toBe('false');
  });

  it('is in a development build on both platforms', async () => {
    const files = await nativeFilesFor('development');
    expect(files.ats).toMatchObject({ NSAllowsLocalNetworking: true });
    expect(files.cleartext).toBe('true');
  });

  it('is in a local build only when the developer opts in', async () => {
    const files = await nativeFilesFor(undefined, 'true');
    expect(files.ats).toMatchObject({ NSAllowsLocalNetworking: true });
    expect(files.cleartext).toBe('true');
  });
});

describe('over-the-air updates', () => {
  const PROJECT = '0f3c1a52-6d2e-4b7a-9c1d-2e8f4a6b7c90';

  it('hash the native inputs into the runtime version', () => {
    expect(loadConfig({}).default.runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('come from the EAS project the build names, which push registration reads too', () => {
    const config = loadConfig({ IDEANEST_EAS_PROJECT_ID: PROJECT }).default;
    expect(config.updates).toMatchObject({ enabled: true, url: `https://u.expo.dev/${PROJECT}` });
    expect(config.extra?.eas).toEqual({ projectId: PROJECT });
  });

  it('are switched off when no project is named, rather than pointed nowhere', () => {
    const config = loadConfig({ IDEANEST_EAS_PROJECT_ID: undefined }).default;
    expect(config.updates).toEqual({ enabled: false });
    expect(config.extra).not.toHaveProperty('eas');
  });

  it('refuse a project id that is not one', () => {
    expect(() => loadConfig({ IDEANEST_EAS_PROJECT_ID: 'ideanest' })).toThrow(/IDEANEST_EAS_PROJECT_ID/);
  });
});

describe('the generated images', () => {
  const config = loadConfig({}).default;
  type SplashOptions = {
    image: string;
    backgroundColor: string;
    dark?: { image: string; backgroundColor: string };
  };
  const splash = config.plugins?.find(
    (plugin): plugin is [string, SplashOptions] =>
      Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
  )?.[1];
  const notifications = config.plugins?.find(
    (plugin): plugin is [string, { icon: string }] =>
      Array.isArray(plugin) && plugin[0] === 'expo-notifications',
  )?.[1];
  const iosIcon = config.ios?.icon;

  it('give iOS a light, a dark and a tinted icon', () => {
    expect(iosIcon).toEqual({
      light: './assets/icon.png',
      dark: './assets/icon-dark.png',
      tinted: './assets/icon-tinted.png',
    });
  });

  it('give the dark splash the same picture, because the UI is dark only', () => {
    expect(splash?.dark).toEqual({ image: splash?.image, backgroundColor: splash?.backgroundColor });
  });

  it('are all committed', () => {
    const paths = [
      config.icon,
      ...(typeof iosIcon === 'object' ? [iosIcon.light, iosIcon.dark, iosIcon.tinted] : [iosIcon]),
      config.android?.adaptiveIcon?.foregroundImage,
      config.android?.adaptiveIcon?.monochromeImage,
      splash?.image,
      notifications?.icon,
      './store/feature-graphic.png',
    ];
    for (const path of paths) {
      expect(path).toBeDefined();
      expect(existsSync(join(MOBILE_ROOT, path as string))).toBe(true);
    }
  });
});

describe('eas.json', () => {
  type Profile = {
    extends?: string;
    channel?: string;
    distribution?: string;
    env?: Record<string, string>;
    ios?: { simulator?: boolean };
    android?: { env?: Record<string, string> };
  };
  const eas = JSON.parse(readFileSync(join(MOBILE_ROOT, 'eas.json'), 'utf8')) as {
    build: Record<string, Profile>;
    submit: { production: { ios?: Record<string, unknown>; android?: Record<string, unknown> } };
  };

  it('names each channel after its profile, which the release workflow’s update relies on', () => {
    for (const name of ['development', 'preview', 'production']) {
      expect(eas.build[name]?.channel).toBe(name);
    }
  });

  it('points an Android emulator at the host machine, where localhost is the emulator itself', () => {
    expect(eas.build.development?.android?.env?.IDEANEST_API_ORIGIN).toBe('http://10.0.2.2:8080');
    expect(eas.build.development?.env?.IDEANEST_API_ORIGIN).toBe('http://localhost:8080');
  });

  it('builds preview for testers’ devices on both platforms (ad hoc on iOS)', () => {
    expect(eas.build.preview?.distribution).toBe('internal');
    expect(eas.build.preview?.ios?.simulator).toBe(false);
  });

  it('submits iOS too, without the account ids in the repository', () => {
    expect(eas.submit.production.ios).toBeDefined();
    expect(eas.submit.production.ios).not.toHaveProperty('ascAppId');
    expect(eas.submit.production.ios).not.toHaveProperty('appleTeamId');
  });
});
