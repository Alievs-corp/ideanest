import { currentLocale, resolveLocale, setLocale } from './locale';

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
