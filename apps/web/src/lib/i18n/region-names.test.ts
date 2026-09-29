import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * `regionNames` caches per language, so each case imports a fresh module rather than
 * inheriting the answer the previous case built.
 */
async function fresh() {
  vi.resetModules();
  return import('./formats');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('regionNames (#133)', () => {
  it("names a country in the route's language", async () => {
    const { regionNames } = await fresh();

    expect(regionNames('az')?.of('DE')).toBe('Almaniya');
    expect(regionNames('ru')?.of('DE')).toBe('Германия');
    expect(regionNames('tr')?.of('DE')).toBe('Almanya');
    expect(regionNames('en')?.of('DE')).toBe('Germany');
  });

  it('falls back to English when the runtime accepts a language it has no names for', async () => {
    const Real = Intl.DisplayNames;
    // What an engine with stub data does: accepts the locale and answers codes with codes.
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(function (
      locales?: Intl.LocalesArgument,
      options?: Intl.DisplayNamesOptions,
    ) {
      const tag = Array.isArray(locales) ? String(locales[0]) : String(locales);
      if (tag === 'az') return { of: (code: string) => code } as unknown as Intl.DisplayNames;
      return new Real(locales, options ?? { type: 'region' });
    } as unknown as typeof Intl.DisplayNames);
    const { regionNames } = await fresh();

    expect(regionNames('az')?.of('DE')).toBe('Germany');
  });
});
