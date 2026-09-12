import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import { FOOTER_GROUPS } from './navigation';
import { SiteFooter } from './SiteFooter';
import { expectNoViolations } from '../../test-axe';

/**
 * The global footer — §4.13 WS-02, and since #324 the first shell surface drawn from the
 * catalogue.
 *
 * WHAT THESE COVER:
 *
 *   - it is a labelled landmark, so it is reachable without scrolling to it.
 *   - every group in `navigation.ts` is rendered **in each of the four languages**, so a link
 *     added there cannot be silently dropped by this component and a key added there cannot
 *     ship with three languages translated.
 *   - the language is a CONTROL, and every language in it is named in itself. It was the
 *     constant `'English'` before #123, then the endonym of the language being read, and it
 *     is four links now that a locale-prefixed URL makes switching a navigation rather than
 *     a cookie read. `LanguageSwitcher.test.tsx` covers the control itself; what is asserted
 *     here is that the footer carries it, in every language.
 *   - currency is STATED and not offered, and that is now a decision of its own rather than
 *     one shared with the language: a display currency has nothing in the URL to carry it.
 *   - there is no legal column, because §22 has not written the pages and #293 is
 *     `status: needs-decision`. A Terms link resolving to a 404 is a promise about a document
 *     that does not exist.
 *   - the copyright line carries no year, because a year built from the clock differs between
 *     the server render and the browser and goes stale on a statically rendered page.
 */

const CATALOGUES: Record<Locale, typeof en> = { az, en, ru, tr };

/** Each language's name in itself. Never "Russian": a reader scanning for their own language
 *  recognises the endonym, and the English name is a word they may not read. */
const NAMES: Record<Locale, string> = {
  az: 'Azərbaycan dili',
  en: 'English',
  ru: 'Русский',
  tr: 'Türkçe',
};

/** Swapped per render, then read by the mocked server helpers below. */
let locale: Locale = 'en';

function messageAt(namespace: string, key: string): string {
  const path = `${namespace}.${key}`;
  let node: unknown = CATALOGUES[locale];

  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) throw new Error(`no message at ${path}`);
    node = (node as Record<string, unknown>)[segment];
  }

  if (typeof node !== 'string') throw new Error(`no message at ${path} in ${locale}`);
  return node;
}

/*
 * The real catalogue, reached the way `i18n/request.ts` would reach it. Asserting against
 * `messages/*.json` rather than against words typed into this file is what makes the suite
 * fail when a translation is edited to something the component no longer renders — a test
 * holding its own copy of the words passes whatever the catalogue says.
 */
vi.mock('next-intl/server', () => ({
  getLocale: async () => locale,
  getTranslations: async (namespace: string) => (key: string) => messageAt(namespace, key),
}));

/*
 * `useParams` is mocked from the same `locale` the catalogue is read from, because in the
 * running application the two have one source: the route's own `[locale]` segment feeds
 * `getTranslations` on the server and `Link` in the browser. Mocking only one of them would
 * assert a state the application cannot be in — Turkish words on English hrefs — and would
 * pass while the footer linked every reader out of their language.
 */
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale }),
}));

afterEach(cleanup);

async function renderFooter(at: Locale = 'en') {
  locale = at;
  return render(await SiteFooter());
}

describe('the footer', () => {
  it('is a labelled landmark with a named navigation inside it', async () => {
    await renderFooter();

    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: en.shell.footer.label }),
    ).toBeInTheDocument();
  });

  it.each(SUPPORTED_LOCALES)(
    'renders every group and every link the navigation model declares, in %s',
    async (at) => {
      const { unmount } = await renderFooter(at);
      const catalogue = CATALOGUES[at];
      const nav = screen.getByRole('navigation', { name: catalogue.shell.footer.label });

      for (const group of FOOTER_GROUPS) {
        const groups = catalogue.shell.footer.groups;
        const heading = groups[group.headingKey as keyof typeof groups];

        expect(
          within(nav).getByRole('heading', { name: heading }),
          `${at} draws ${group.headingKey}`,
        ).toBeInTheDocument();

        for (const link of group.links) {
          const links = catalogue.shell.footer.links;
          const label = links[link.key as keyof typeof links];

          expect(
            within(nav).getByRole('link', { name: label }),
            `${at} draws ${link.key}`,
          ).toHaveAttribute('href', `/${at}${link.href}`);
        }
      }

      unmount();
    },
  );

  it('leaves no key unresolved in any language', async () => {
    /*
     * `getMessageFallback` renders a missing key's own name in production rather than taking
     * the route down, so an untranslated footer link reads `shell.footer.links.press` on the
     * page. That is a defect nobody reports, because the person who would notice it is
     * reading a language nobody on the team reads.
     */
    for (const at of SUPPORTED_LOCALES) {
      const { container, unmount } = await renderFooter(at);

      expect(container.textContent ?? '', `unresolved key in ${at}`).not.toMatch(/shell\./u);

      unmount();
    }
  });

  it('says what the platform is, including the fact people most often assume wrongly', async () => {
    await renderFooter();

    expect(screen.getByText(en.shell.tagline)).toBeInTheDocument();
  });

  it.each(SUPPORTED_LOCALES)('names the language being read, in itself (%s)', async (at) => {
    /*
     * Not "Russian" but "Русский". A reader scanning the bottom of the page for their own
     * language recognises the endonym; the English name is a word they may not read. It also
     * has to follow the route rather than a build-time constant, which is what the line was
     * before #123.
     */
    const { unmount } = await renderFooter(at);

    expect(screen.getByText(NAMES[at])).toBeInTheDocument();

    unmount();
  });

  it.each(SUPPORTED_LOCALES)('carries the language control, in %s', async (at) => {
    /*
     * The footer's own assertion is presence and reach: a signed-out reader must be able to
     * leave the language they landed in without editing the address bar, which before this
     * control meant reaching `/settings/language` behind a sign-in they may not have.
     */
    const { unmount } = await renderFooter(at);
    const catalogue = CATALOGUES[at];

    const group = screen.getByRole('navigation', {
      name: catalogue.shell.footer.languageSwitcherLabel,
    });

    for (const target of SUPPORTED_LOCALES) {
      expect(
        within(group).getByRole('link', { name: NAMES[target] }),
        `${at} offers ${target}`,
      ).toHaveAttribute('href', `/${target}`);
    }

    unmount();
  });

  it('states the currency rather than offering a control', async () => {
    await renderFooter();

    expect(screen.getByText(en.shell.footer.currencyValue)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers no legal links, because the documents do not exist', async () => {
    await renderFooter();

    expect(screen.queryByRole('link', { name: /terms/iu })).toBeNull();
    expect(screen.queryByRole('link', { name: /privacy/iu })).toBeNull();
    expect(screen.queryByRole('link', { name: /cookie/iu })).toBeNull();
  });

  it('claims no year', async () => {
    await renderFooter();

    expect(screen.getByText('© IdeaNest')).toBeInTheDocument();
    expect(screen.queryByText(/©.*20\d\d/u)).toBeNull();
  });
});

describe('accessibility', () => {
  /** #129. Four link groups, each of which needs to be a named list rather than a heap. */
  it('leaves no automatically detectable violation', async () => {
    const { container } = render(await SiteFooter());

    await expectNoViolations(container);
  });
});
