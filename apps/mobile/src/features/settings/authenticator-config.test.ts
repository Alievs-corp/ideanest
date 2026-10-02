import type { ExpoConfig } from 'expo/config';
import type { AndroidConfig } from 'expo/config-plugins';

/**
 * `otpauth` is declared for `Linking.canOpenURL` on both platforms (#161). Without the
 * declaration both answer "no" whatever is installed, and the scan step would tell everybody
 * they have no authenticator app.
 */

type Manifest = AndroidConfig.Manifest.AndroidManifest;

function loadConfig(): typeof import('../../../app.config') {
  let loaded: typeof import('../../../app.config') | undefined;
  jest.isolateModules(() => {
    loaded = require('../../../app.config') as typeof import('../../../app.config');
  });
  if (loaded === undefined) throw new Error('app.config.ts did not load');
  return loaded;
}

function bareManifest(queries: Manifest['manifest']['queries'] = []): Manifest {
  return {
    manifest: { $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' }, queries },
  };
}

const BROWSER_QUERY = {
  intent: [
    {
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
      data: [{ $: { 'android:scheme': 'https' } }],
    },
  ],
};

describe('the otpauth declarations', () => {
  it('lists otpauth in LSApplicationQueriesSchemes on iOS', () => {
    const config: ExpoConfig = loadConfig().default;
    expect(config.ios?.infoPlist?.LSApplicationQueriesSchemes).toEqual(['otpauth']);
  });

  it('registers an Android manifest mod', () => {
    // `mods` is what a config plugin adds; `ExpoConfig` does not declare it.
    const config = loadConfig().default as ExpoConfig & {
      mods?: { android?: { manifest?: unknown } };
    };
    expect(typeof config.mods?.android?.manifest).toBe('function');
  });

  it('adds a VIEW otpauth: intent to the Android queries, beside what is there', () => {
    const { addAuthenticatorQuery } = loadConfig();
    const result = addAuthenticatorQuery(bareManifest([BROWSER_QUERY]));

    expect(result.manifest.queries).toEqual([
      BROWSER_QUERY,
      {
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            data: [{ $: { 'android:scheme': 'otpauth' } }],
          },
        ],
      },
    ]);
  });

  it('adds it once, however often prebuild runs', () => {
    const { addAuthenticatorQuery } = loadConfig();
    const once = addAuthenticatorQuery(bareManifest());
    expect(addAuthenticatorQuery(once)).toEqual(once);
    expect(once.manifest.queries).toHaveLength(1);
  });
});
