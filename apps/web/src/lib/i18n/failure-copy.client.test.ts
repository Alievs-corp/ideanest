import { describe, expect, it } from 'vitest';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { errorPageCopyOf, failureCopyOf, skipToContentOf } from './failure-copy.client';
import { SUPPORTED_LOCALES, type Locale } from './locale';

/**
 * The one place in this application where a string is written twice, held level with the
 * catalogue by assertion — issue #324.
 *
 * `failure-copy.client.ts` explains why the duplication exists: the two error boundaries are
 * client components Next renders itself, so no server parent can hand them words, and the
 * provider that would let them look words up was measured at +24.7 KiB on **every** route.
 *
 * What follows is the price of that decision being safe. Without it the copy drifts silently:
 * somebody improves a phrase in `messages/ru.json`, the error page keeps the old one, and
 * nobody finds out because the page it appears on is the one nobody visits deliberately.
 */
const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr };

describe('the client-side failure copy', () => {
  it.each(SUPPORTED_LOCALES)('matches the %s catalogue word for word', (locale) => {
    const catalogue = CATALOGUES[locale].shell.failure;

    expect(failureCopyOf(locale)).toEqual({
      elsewhere: catalogue.elsewhere,
      links: {
        browse: catalogue.links.browse,
        categories: catalogue.links.categories,
        search: catalogue.links.search,
      },
    });
  });

  it.each(SUPPORTED_LOCALES)('matches the %s skip link', (locale) => {
    expect(skipToContentOf(locale)).toBe(CATALOGUES[locale].shell.skipToContent);
  });

  it('covers every language, so a fifth cannot be added to one side only', () => {
    /*
     * `Record<Locale, …>` already makes the compiler require all four. This asserts it at
     * runtime as well, because the day a language is added the compiler error is in this file
     * and the tempting fix is a cast.
     */
    for (const locale of SUPPORTED_LOCALES) {
      expect(failureCopyOf(locale).elsewhere).toBeTypeOf('string');
      expect(failureCopyOf(locale).elsewhere).not.toBe('');
      expect(skipToContentOf(locale)).not.toBe('');
    }
  });

  it.each(SUPPORTED_LOCALES)('matches the %s error-page copy word for word', (locale) => {
    /*
     * The heading, the sentence under it, the digest line and the retry button. Asserted for
     * the same reason as the link rail above: the words are spelled twice, once in the
     * catalogue for every other surface and once here for the two Next renders itself, and a
     * reader who meets a Turkish page whose error boundary is in English has met the defect
     * this pair of tests exists to prevent.
     */
    const catalogue = CATALOGUES[locale].shell.failure.pages.error;

    expect(errorPageCopyOf(locale)).toEqual({
      title: catalogue.title,
      description: catalogue.description,
      referenceLabel: catalogue.referenceLabel,
      referenceHint: catalogue.referenceHint,
      retry: catalogue.retry,
    });
  });

  it('carries nothing beyond the two boundaries that need it', () => {
    /*
     * A guard on scope rather than on content. This module is a measured exception, and the
     * way an exception stops being one is by quietly growing: the next person with a client
     * component and no server parent finds a file that already looks like a catalogue and
     * adds to it. Four keys is what the exception covers.
     */
    expect(Object.keys(failureCopyOf('en'))).toEqual(['elsewhere', 'links']);
    expect(Object.keys(failureCopyOf('en').links)).toEqual(['browse', 'categories', 'search']);
  });
});
