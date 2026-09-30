import { deviceStore } from './storage';

/*
 * The phone's language, per launch below. `var`, because the factory runs when `./locale` is
 * imported — above this line — and a `let` would still be in its dead zone; unset, the phone
 * reads Azerbaijani as jest.setup.ts's mock does. (A `jest.doMock` inside `isolateModules`
 * would lose to the mock this file's own import already instantiated.)
 */
// eslint-disable-next-line no-var
var mockDevice: string | undefined;
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: mockDevice ?? 'az', languageTag: mockDevice ?? 'az' }],
}));
import {
  currentLocale,
  perAppLanguageChosen,
  reconcileLocale,
  resolveLocale,
  setLocale,
} from './locale';

const none = { stored: null, account: null, languages: [], region: null } as const;

describe('resolveLocale', () => {
  it('takes the device’s explicit choice over the account language (#216)', () => {
    expect(resolveLocale({ ...none, account: 'tr', stored: 'ru' })).toBe('ru');
  });

  it('takes the account language, when it is to be applied, over the device languages', () => {
    expect(resolveLocale({ ...none, account: 'tr', languages: [{ languageCode: 'en' }] })).toBe('tr');
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
  it('counts only a change to another of the four, with a record to compare with', () => {
    expect(perAppLanguageChosen('az', 'tr', 'ru')).toBe(true);
    expect(perAppLanguageChosen('az', 'tr', undefined)).toBe(true);
    expect(perAppLanguageChosen('az', 'az', 'ru')).toBe(false);
    expect(perAppLanguageChosen(undefined, 'tr', 'ru')).toBe(false);
    expect(perAppLanguageChosen('az', null, 'ru')).toBe(false);
    // The whole phone switching to a language the app does not have is not a per-app choice.
    expect(perAppLanguageChosen('en', 'de', 'ru')).toBe(false);
    // Switching to the language already chosen here leaves nothing to forget.
    expect(perAppLanguageChosen('az', 'ru', 'ru')).toBe(false);
  });

  /** A launch: a fresh module registry over a store holding what the last launch left. */
  function launch(
    saved: Record<string, string>,
    device = 'az',
  ): { locale: string; stored: string | undefined; pending: string | undefined } {
    let result = {
      locale: '',
      stored: undefined as string | undefined,
      pending: undefined as string | undefined,
    };
    mockDevice = device;
    jest.isolateModules(() => {
      const { deviceStore: store } = require('./storage') as typeof import('./storage');
      for (const [key, value] of Object.entries(saved)) store.set(key, value);
      const fresh = require('./locale') as typeof import('./locale');
      result = {
        locale: fresh.currentLocale(),
        stored: store.getString('locale'),
        pending: store.getString('locale.pending'),
      };
    });
    mockDevice = undefined;
    return result;
  }

  // The phone reads Azerbaijani unless a launch says otherwise.
  it('outranks a choice stored before it, and is marked for the account (#216)', () => {
    expect(launch({ 'locale.device': 'ru', locale: 'tr' })).toEqual({
      locale: 'az',
      stored: 'az',
      pending: 'az',
    });
  });

  it('leaves the stored choice alone while the phone’s language stays put', () => {
    expect(launch({ 'locale.device': 'az', locale: 'tr' })).toEqual({
      locale: 'tr',
      stored: 'tr',
      pending: undefined,
    });
  });

  it('keeps the stored choice when the whole phone moves to a language the app lacks', () => {
    expect(launch({ 'locale.device': 'en', locale: 'tr' }, 'de')).toEqual({
      locale: 'tr',
      stored: 'tr',
      pending: undefined,
    });
  });

  it('leaves it alone on the first launch that keeps a record', () => {
    expect(launch({ locale: 'tr' })).toEqual({ locale: 'tr', stored: 'tr', pending: undefined });
  });
});

describe('reconcileLocale, the last-synced rule (#216)', () => {
  const rule = { account: 'ru', chosen: undefined, synced: undefined, pending: undefined } as const;

  it('applies the account on a fresh install or a first sign-in', () => {
    expect(reconcileLocale(rule)).toEqual({ kind: 'apply', locale: 'ru' });
    // A choice made before signing in: nothing was synced yet, so the account wins.
    expect(reconcileLocale({ ...rule, chosen: 'en' })).toEqual({ kind: 'apply', locale: 'ru' });
  });

  it('keeps the device’s choice while the account is what this device last synced', () => {
    expect(reconcileLocale({ ...rule, chosen: 'tr', synced: 'ru' })).toEqual({ kind: 'keep' });
  });

  it('applies an account language that changed elsewhere, over the device’s choice', () => {
    expect(reconcileLocale({ ...rule, account: 'en', chosen: 'tr', synced: 'tr' })).toEqual({
      kind: 'apply',
      locale: 'en',
    });
  });

  it('pushes a pending choice rather than letting the account win', () => {
    const pending = { ...rule, account: 'az', chosen: 'ru', synced: 'az', pending: 'ru' } as const;
    expect(reconcileLocale(pending)).toEqual({ kind: 'push', locale: 'ru' });
    // Even when the account changed elsewhere meanwhile: the pending choice is the latest known.
    expect(reconcileLocale({ ...pending, account: 'en' })).toEqual({ kind: 'push', locale: 'ru' });
  });

  it('settles a pending choice the account already carries', () => {
    expect(reconcileLocale({ ...rule, chosen: 'ru', synced: 'az', pending: 'ru' })).toEqual({
      kind: 'apply',
      locale: 'ru',
    });
  });

  it('changes nothing for an account value it cannot draw', () => {
    expect(reconcileLocale({ ...rule, account: 'de', chosen: 'tr', synced: 'tr' })).toEqual({
      kind: 'keep',
    });
    expect(reconcileLocale({ ...rule, account: undefined })).toEqual({ kind: 'keep' });
  });
});
