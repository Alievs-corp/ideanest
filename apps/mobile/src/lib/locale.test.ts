import { deviceStore } from './storage';
import { currentLocale, deviceLanguageChanged, resolveLocale, setLocale } from './locale';

const none = { stored: null, account: null, languages: [], region: null } as const;

describe('resolveLocale', () => {
  it('takes the account language over the stored choice', () => {
    expect(resolveLocale({ ...none, account: 'tr', stored: 'ru' })).toBe('tr');
  });

  it('takes the stored choice over the device', () => {
    expect(resolveLocale({ ...none, stored: 'ru', languages: [{ languageCode: 'en' }] })).toBe('ru');
  });

  it('reads the first device language that is one of the four (Georgian then Russian is ru)', () => {
    expect(
      resolveLocale({ ...none, languages: [{ languageCode: 'ka' }, { languageCode: 'ru' }] }),
    ).toBe('ru');
  });

  it('lets language win over region: an AZ region with an English phone is en', () => {
    expect(resolveLocale({ ...none, languages: [{ languageCode: 'en' }], region: 'AZ' })).toBe('en');
  });

  it('falls back to the region table when no language matches', () => {
    expect(resolveLocale({ ...none, languages: [{ languageCode: 'ka' }], region: 'KZ' })).toBe('ru');
  });

  it('is Azerbaijani for an unknown region and no language', () => {
    expect(resolveLocale({ ...none, languages: [{ languageCode: 'de' }], region: 'DE' })).toBe('az');
  });

  it('ignores an unsupported stored or account value', () => {
    expect(resolveLocale({ ...none, stored: 'xx', account: 'yy', region: 'TR' })).toBe('tr');
  });
});

describe('setLocale', () => {
  it('changes the language in use, which is what Accept-Language reads', () => {
    setLocale('ru');
    expect(currentLocale()).toBe('ru');
    setLocale('az');
    expect(currentLocale()).toBe('az');
  });
});

describe('setLocale persistence', () => {
  it('stores the choice even when it equals the language already in use', () => {
    setLocale('az');
    expect(deviceStore.getString('locale')).toBe('az');
  });
});

describe('a change of the phone’s own language', () => {
  it('is a change only when there is a record to compare with', () => {
    expect(deviceLanguageChanged('az', 'tr')).toBe(true);
    expect(deviceLanguageChanged('az', 'az')).toBe(false);
    expect(deviceLanguageChanged(undefined, 'tr')).toBe(false);
    expect(deviceLanguageChanged('az', null)).toBe(false);
  });

  /** A launch: a fresh module registry over a store holding what the last launch left. */
  function launch(saved: Record<string, string>): { locale: string; stored: string | undefined } {
    let result = { locale: '', stored: undefined as string | undefined };
    jest.isolateModules(() => {
      const { deviceStore: store } = require('./storage') as typeof import('./storage');
      for (const [key, value] of Object.entries(saved)) store.set(key, value);
      const fresh = require('./locale') as typeof import('./locale');
      result = { locale: fresh.currentLocale(), stored: store.getString('locale') };
    });
    return result;
  }

  // The phone reads Azerbaijani (jest.setup.ts's expo-localization mock).
  it('outranks a choice stored before it: the per-app setting is heard', () => {
    expect(launch({ 'locale.device': 'ru', locale: 'tr' })).toEqual({ locale: 'az', stored: undefined });
  });

  it('leaves the stored choice alone while the phone’s language stays put', () => {
    expect(launch({ 'locale.device': 'az', locale: 'tr' })).toEqual({ locale: 'tr', stored: 'tr' });
  });

  it('leaves it alone on the first launch that keeps a record', () => {
    expect(launch({ locale: 'tr' })).toEqual({ locale: 'tr', stored: 'tr' });
  });
});
