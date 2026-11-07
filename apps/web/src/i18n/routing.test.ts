import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../lib/i18n/locale';
import { routing } from './routing';

/**
 * The routing configuration is four small values, and each of them is a decision that is
 * expensive to get wrong and invisible when it is — issue #123.
 *
 * These assert the settings rather than the behaviour, deliberately. next-intl's own tests
 * cover what a `localePrefix` of `always` does; what this repository has to keep true is that
 * nobody flips one of them to something that still builds, still renders, and quietly turns
 * every cached route dynamic or drops the prefix from a language.
 */
describe('the localised routing configuration', () => {
  it('is the same list of languages the rest of the platform holds', () => {
    /*
     * `lib/i18n/locale.ts` is the list `locale.test.ts` keeps level with the API's
     * `Taxonomy.SUPPORTED_LOCALES` and the `users_locale_supported` check constraint. A
     * fourth spelling in this file would be the one nobody updates.
     */
    expect(routing.locales).toEqual(SUPPORTED_LOCALES);
    expect(routing.defaultLocale).toBe(DEFAULT_LOCALE);
  });

  it('prefixes every language, the default one included', () => {
    /*
     * `as-needed` would leave English at `/discover` — a page with no language in its
     * address, which something at request time would then have to decide the language of.
     * That decision is what makes a render dynamic, and removing it is the whole of #123.
     */
    expect(routing.localePrefix).toBe('always');
  });

  it('never negotiates on Accept-Language', () => {
    /*
     * Detection would make the proxy's response vary by that header, and a
     * `Vary: Accept-Language` on the routes a stranger meets first splits the shared CDN
     * cache per browser configuration — the per-visitor cost this design exists to avoid,
     * arriving through the door instead of the window. `proxy.ts` reads the stored
     * preference on the bare path instead, where the whole response is a redirect.
     */
    expect(routing.localeDetection).toBe(false);
  });

  it('never sets next-intl’s own locale cookie', () => {
    /*
     * `NEXT_LOCALE` would be written on a reader's first page in a language their browser
     * does not prefer, without their asking, and nothing reads it: the proxy's redirect reads
     * `ideanest_locale`. A cookie that is neither chosen nor needed is one the site would have
     * to ask consent for.
     */
    expect(routing.localeCookie).toBe(false);
  });
});
