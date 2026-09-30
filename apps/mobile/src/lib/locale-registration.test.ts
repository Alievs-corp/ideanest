import { SUPPORTED_LOCALES } from '@ideanest/messages';
import config from '../../app.config';

/**
 * The languages the operating system is told about are the catalogue's — issue #150.
 *
 * `app.config.ts` spells the list out because the Expo CLI cannot import `@ideanest/messages`
 * (see the note there), and a list written twice drifts. A fifth language added to the
 * catalogues and not here would never appear in the phone's per-app language setting.
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
