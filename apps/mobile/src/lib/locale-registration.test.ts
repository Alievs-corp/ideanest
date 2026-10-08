import { SUPPORTED_LOCALES } from '@ideanest/messages';
import config from '../../app.config';

/**
 * The languages the operating system is told about are the catalogue's — issue #150.
 *
 * `app.config.ts` reads the list from `@ideanest/messages/locale` (see the note there). A fifth
 * language that reached the catalogues and not the registration would never appear in the
 * phone's per-app language setting.
 */
describe('the languages registered with the operating system', () => {
  it('are exactly SUPPORTED_LOCALES, through expo-localization', () => {
    const entry = config.plugins?.find(
      (plugin): plugin is [string, { supportedLocales: string[] }] =>
        Array.isArray(plugin) && plugin[0] === 'expo-localization',
    );
    expect(entry?.[1].supportedLocales).toEqual([...SUPPORTED_LOCALES]);
  });
});
