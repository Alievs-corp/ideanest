/**
 * Plural messages on an engine without `Intl.PluralRules` — the Hermes bug behind #155.
 *
 * <p>Jest runs on Node, which has the constructor, so the bug cannot show here unless the engine is
 * made to look like Hermes: each case deletes `Intl.PluralRules` and `Intl.Locale` (Hermes has
 * neither) and loads the app's modules in a fresh registry, so `use-intl`, `intl-messageformat`
 * and the polyfill all meet the engine as it is at that moment.
 *
 * <p>What this proves, and what it does not. It proves the app's own translator and
 * `@ideanest/messages`' `pluralForm` decline correctly once `src/lib/intl-polyfill.ts` has run on
 * an engine missing both constructors — and, as the control, that the same translator prints the
 * raw key without it, which is what the phone showed. It does not prove that `index.ts` runs the
 * polyfill first on a device; that is the import order in one five-line file, and only a release
 * build on Hermes can show it.
 */

type MutableIntl = { PluralRules?: unknown; Locale?: unknown };

const NATIVE_PLURAL_RULES = Intl.PluralRules;
const NATIVE_LOCALE = Intl.Locale;

function restore(name: 'PluralRules' | 'Locale', value: unknown): void {
  Object.defineProperty(Intl, name, { value, writable: true, configurable: true, enumerable: false });
}

/** Intl as Hermes ships it: no plural rules and no locale objects. */
function likeHermes(): void {
  delete (Intl as MutableIntl).PluralRules;
  delete (Intl as MutableIntl).Locale;
}

afterEach(() => {
  restore('PluralRules', NATIVE_PLURAL_RULES);
  restore('Locale', NATIVE_LOCALE);
});

interface Loaded {
  readonly translate: typeof import('./i18n').translate;
  readonly setLocale: typeof import('./locale').setLocale;
  readonly pluralForm: typeof import('@ideanest/messages/plurals').pluralForm;
}

function load(withPolyfill: boolean): Loaded {
  let loaded: Loaded | undefined;
  jest.isolateModules(() => {
    if (withPolyfill) require('./intl-polyfill');
    loaded = {
      translate: (require('./i18n') as typeof import('./i18n')).translate,
      setLocale: (require('./locale') as typeof import('./locale')).setLocale,
      pluralForm: (require('@ideanest/messages/plurals') as typeof import('@ideanest/messages/plurals'))
        .pluralForm,
    };
  });
  if (loaded === undefined) throw new Error('modules did not load');
  return loaded;
}

describe('without the polyfill, as the release build was', () => {
  it('prints the key instead of the sentence — the bug', () => {
    likeHermes();
    const { translate, setLocale } = load(false);
    setLocale('en');

    expect(translate()('campaign.daysLeft', { days: 3 })).toBe('campaign.daysLeft');
  });
});

describe('with the polyfill loaded first', () => {
  it('installs a constructor where the engine had none', () => {
    likeHermes();
    load(true);

    expect(typeof Intl.PluralRules).toBe('function');
    expect(Intl.PluralRules).not.toBe(NATIVE_PLURAL_RULES);
  });

  it.each([
    ['en', 0, 'Last day'],
    ['en', 1, '1 day left'],
    ['en', 3, '3 days left'],
    ['az', 0, 'Son gün'],
    ['az', 1, '1 gün qaldı'],
    ['az', 3, '3 gün qaldı'],
    ['ru', 1, 'остался 1 день'],
    ['ru', 3, 'осталось 3 дня'],
    ['ru', 5, 'осталось 5 дней'],
    ['ru', 21, 'остался 21 день'],
    ['tr', 2, '2 gün kaldı'],
  ] as const)('formats campaign.daysLeft in %s for %i through the app’s translator', (locale, days, expected) => {
    likeHermes();
    const { translate, setLocale } = load(true);
    setLocale(locale);

    expect(translate()('campaign.daysLeft', { days })).toBe(expected);
  });

  /**
   * `pluralForm` asks for `en-GB`, which the polyfill holds no data for under that name. With the
   * default "best fit" matcher it would reach for `Intl.Locale`, which Hermes also lacks.
   */
  it.each([
    ['en', 1, 'one'],
    ['en', 2, 'other'],
    ['ru', 2, 'few'],
    ['ru', 5, 'many'],
    ['ru', 21, 'one'],
    ['az', 1, 'one'],
    ['tr', 7, 'other'],
  ] as const)('lets @ideanest/messages’ pluralForm pick the %s form for %i', (locale, count, category) => {
    likeHermes();
    const { pluralForm } = load(true);
    const forms = { one: 'one', few: 'few', many: 'many', other: 'other' };

    expect(pluralForm(locale, forms, count)).toBe(category);
  });
});

describe('on an engine that has its own', () => {
  it('leaves the native constructor in place', () => {
    load(true);

    expect(Intl.PluralRules).toBe(NATIVE_PLURAL_RULES);
  });
});
