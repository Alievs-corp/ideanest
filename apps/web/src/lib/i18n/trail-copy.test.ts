import { describe, expect, it } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from './locale';
import { trailCopyFrom } from './trail-copy';
import { breadcrumbNode, categoriesCrumb, homeCrumb } from '../seo/structured-data/breadcrumb';

/**
 * The breadcrumb steps a crawler reads, in each of the four languages — issue #123.
 *
 * WHAT THESE COVER:
 *
 *   - **the markup is in the language of the page it is on.** A `BreadcrumbList` is a claim
 *     about a document as it is presented, and until #123 all four languages emitted English
 *     constants — `Home → Categories` above a page whose own navigation read
 *     `Главная → Категории`. Structured data contradicting the visible page is the one kind a
 *     search engine has grounds to discount wholesale.
 *   - **the words come from the catalogue rather than from this test.** Every assertion below
 *     resolves through `messages/*.json`, so a translation changed there is a translation
 *     changed here, and one deleted there fails rather than being silently re-invented.
 *   - **the trail agrees with the navigation.** The footer already links "Categories" in four
 *     languages; a crumb that called it something else would be two names for one page.
 */

const CATALOGUES: Record<Locale, { common: { trail: Record<string, string> } }> = {
  az,
  en,
  ru,
  tr,
};

function copyFor(locale: Locale) {
  const trail = CATALOGUES[locale].common.trail;
  return trailCopyFrom((key) => {
    const word = trail[key];
    if (word === undefined) throw new Error(`common.trail.${key} is missing from ${locale}`);
    return word;
  });
}

describe('the breadcrumb steps', () => {
  it.each(SUPPORTED_LOCALES)('resolves all four fixed steps in %s', (locale) => {
    const copy = copyFor(locale);

    for (const [step, word] of Object.entries(copy)) {
      expect(word.trim(), `${locale} ${step}`).not.toBe('');
    }
  });

  /**
   * The one assertion that would have failed before #123: four languages, four different
   * words. A regression that reverted the crumbs to constants would put the same English
   * string in all four and be caught here rather than in a search console three weeks later.
   */
  it('names the same step differently in each language', () => {
    const homes = SUPPORTED_LOCALES.map((locale) => copyFor(locale).home);

    expect(new Set(homes).size).toBe(SUPPORTED_LOCALES.length);
  });

  it('calls a step what the footer calls the page it points at', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalogue = CATALOGUES[locale] as unknown as {
        shell: { footer: { links: Record<string, string> } };
      };

      expect(copyFor(locale).categories, locale).toBe(catalogue.shell.footer.links['categories']);
      expect(copyFor(locale).collections, locale).toBe(catalogue.shell.footer.links['collections']);
    }
  });

  it('walks a trail in the reader’s own language, at the reader’s own addresses', () => {
    const env = { IDEANEST_SITE_URL: 'https://ideanest.az' } as const;
    const copy = copyFor('ru');

    const node = breadcrumbNode([homeCrumb(copy), categoriesCrumb(copy)], 'ru', env);
    const items = (node?.['itemListElement'] ?? []) as readonly Record<string, unknown>[];

    expect(items.map((item) => item['name'])).toEqual([copy.home, copy.categories]);
    expect(items.map((item) => item['item'])).toEqual([
      'https://ideanest.az/ru',
      'https://ideanest.az/ru/categories',
    ]);
  });
});
