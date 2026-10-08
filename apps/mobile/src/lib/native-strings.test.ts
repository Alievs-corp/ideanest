import { SUPPORTED_LOCALES } from '@ideanest/messages';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import config, { nativeLocales } from '../../app.config';

/**
 * The words the operating system shows for the application — its name under the icon and the
 * reason in each permission prompt — come from the catalogue's `mobile.native`, in each of the
 * four languages (#165). Before, they were English literals written twice.
 */

const CATALOGUES = { az, en, ru, tr };

type PluginEntry = [string, Record<string, unknown>];

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = config.plugins?.find(
    (plugin): plugin is PluginEntry => Array.isArray(plugin) && plugin[0] === name,
  );
  return entry?.[1];
}

describe('the native strings', () => {
  it('are localized for exactly the four languages', () => {
    expect(Object.keys(config.locales ?? {}).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it.each(SUPPORTED_LOCALES)('in %s are the catalogue’s mobile.native copy', (locale) => {
    const strings = CATALOGUES[locale].mobile.native;
    expect(nativeLocales()[locale]).toEqual({
      ios: {
        CFBundleDisplayName: strings.displayName,
        NSFaceIDUsageDescription: strings.faceIdUsage,
        NSCameraUsageDescription: strings.cameraUsage,
        NSPhotoLibraryUsageDescription: strings.photoLibraryUsage,
      },
      android: { app_name: strings.displayName },
    });
    expect(config.locales?.[locale]).toEqual(nativeLocales()[locale]);
  });

  it.each(SUPPORTED_LOCALES)('in %s are all written', (locale) => {
    for (const value of Object.values(CATALOGUES[locale].mobile.native)) {
      expect(value.trim()).not.toBe('');
    }
  });

  it.each(SUPPORTED_LOCALES)(
    'in %s survive the quoting Expo writes them into Android strings.xml with',
    (locale) => {
      // Expo writes `<string name="app_name">"VALUE"</string>`: a double quote or a backslash in
      // the value would end the string early or escape what follows.
      expect(CATALOGUES[locale].mobile.native.displayName).not.toMatch(/["\\]/);
    },
  );

  it('give the base Info.plist and the Android label the English copy', () => {
    expect(config.name).toBe(en.mobile.native.displayName);
    expect(pluginOptions('expo-image-picker')).toMatchObject({
      cameraPermission: en.mobile.native.cameraUsage,
      photosPermission: en.mobile.native.photoLibraryUsage,
    });
  });

  it('say the same Face ID sentence in both plugins that write it', () => {
    // Both write NSFaceIDUsageDescription and the last one wins, so they must agree.
    expect(pluginOptions('expo-secure-store')?.faceIDPermission).toBe(en.mobile.native.faceIdUsage);
    expect(pluginOptions('expo-local-authentication')?.faceIDPermission).toBe(
      en.mobile.native.faceIdUsage,
    );
  });
});
