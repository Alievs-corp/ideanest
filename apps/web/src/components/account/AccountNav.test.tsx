import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import { ACCOUNT_GROUPS, ACCOUNT_LINKS } from '../../lib/account/navigation';
import { AccountNav, type AccountNavGroup } from './AccountNav';

/**
 * §4.2's account navigation, rendered — issues #275 and #324.
 *
 * WHAT THESE COVER, AND WHY THEY STILL READ `messages/*.json`.
 *
 * The component no longer resolves anything: it is a client boundary for `usePathname` and
 * nothing else, and `AccountArea` hands it strings that the server already looked up. So the
 * catalogue is not this file's subject the way it was — `AccountArea.test.tsx` owns the claim
 * that the right key produces the right sentence.
 *
 * It is still read here rather than replaced with invented labels, and that is deliberate.
 * A test built on `{ label: 'Saved' }` proves the component can draw a string somebody typed
 * into the test; it cannot tell that apart from a component that ignores its props and draws
 * English of its own. Building the props out of the real catalogues, in more than one
 * language, and asserting the rendered text in each of them is what keeps a hard-coded label
 * failing: nothing in `messages/ru.json` matches a word left in English.
 *
 * `navigation.test.ts` asserts the shape of `ACCOUNT_GROUPS` and that every key in it resolves
 * in all four catalogues; the assertions below are about **output** — the text a person reads.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => pathname,
}));

let pathname = '/settings/notifications';

/**
 * The `account` namespace of one catalogue, typed for the dynamic reads below.
 *
 * `ACCOUNT_GROUPS` carries keys as plain strings, so building props out of it means indexing
 * the catalogue by a value rather than by a literal. This shape is what makes that a typed
 * read instead of a cast.
 */
interface AccountCatalogue {
  readonly nav: { readonly label: string };
  readonly groups: Readonly<Record<string, string>>;
  readonly links: Readonly<Record<string, { readonly label: string }>>;
}

/** The real catalogues, all four, typed so a fifth language cannot be forgotten here. */
const CATALOGUES: Record<Locale, AccountCatalogue> = {
  az: az.account,
  en: en.account,
  ru: ru.account,
  tr: tr.account,
};

/**
 * The landmark's own name, per language. Read from the catalogues rather than typed out, so
 * that changing the copy in `messages/*.json` cannot leave this file asserting the old word.
 */
const NAV_LABELS: Record<Locale, string> = {
  az: az.account.nav.label,
  en: en.account.nav.label,
  ru: ru.account.nav.label,
  tr: tr.account.nav.label,
};

/**
 * `noUncheckedIndexedAccess` makes every catalogue read optional, and a missing entry must
 * stop the test rather than render `undefined` into the DOM and be asserted against.
 */
function required<T>(value: T | undefined, key: string): T {
  if (value === undefined) throw new Error(`messages/*.json has no ${key}`);
  return value;
}

/** What `AccountArea` builds on the server, built here from the same two sources. */
function groupsFor(locale: Locale): readonly AccountNavGroup[] {
  const catalogue = CATALOGUES[locale];
  return ACCOUNT_GROUPS.map((group) => ({
    heading: required(catalogue.groups[group.headingKey], `account.groups.${group.headingKey}`),
    links: group.links.map((link) => ({
      href: link.href,
      label: required(catalogue.links[link.key], `account.links.${link.key}`).label,
    })),
  }));
}

function renderNav(locale: Locale = 'en') {
  return render(<AccountNav label={NAV_LABELS[locale]} groups={groupsFor(locale)} />);
}

function currentLinks(): readonly HTMLElement[] {
  return screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
}

beforeEach(() => {
  pathname = '/settings/notifications';
});

describe('AccountNav', () => {
  it('draws every entry as a link to its own route, and nothing else', () => {
    renderNav();

    const nav = screen.getByRole('navigation', { name: NAV_LABELS.en });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((anchor) => anchor.getAttribute('href'));

    expect(hrefs).toEqual(ACCOUNT_LINKS.map((link) => `/en${link.href}`));
  });

  /**
   * #177. Below the breakpoint the list is a scroll container, and the ring (four pixels outside
   * the link: `theme.css`'s unlayered `:focus-visible` rule) was clipped on the first link's
   * left and the last link's right. The list pads its sides and gives them back there, and
   * resets above the breakpoint, where the rail's own `lg:-mx-1 lg:px-1` makes the room.
   */
  it('keeps room for the focus ring on the phone row', () => {
    renderNav();

    const nav = screen.getByRole('navigation', { name: NAV_LABELS.en });
    const row = nav.querySelector('ul') as HTMLElement;
    expect(row).toHaveClass('overflow-x-auto');
    expect(row).toHaveClass('px-1');
    expect(row).toHaveClass('-mx-1');
    expect(row).toHaveClass('pb-2');
    expect(row).toHaveClass('lg:px-0');
    expect(row).toHaveClass('lg:mx-0');
    expect(nav.className).toContain('lg:px-1');
    expect(nav.className).toContain('lg:-mx-1');
    for (const link of within(nav).getAllByRole('link')) {
      expect(link).toHaveClass('focus-visible:outline-offset-2');
    }
  });

  it('takes its words from the catalogue, in English', () => {
    renderNav('en');

    expect(screen.getByRole('link', { name: en.account.links.saved.label })).toHaveAttribute('href', '/en/account/saved');
    expect(screen.getByRole('link', { name: en.account.links.language.label })).toHaveAttribute('href', '/en/settings/language');
    expect(
      screen.getByRole('heading', { name: en.account.groups.yourAccount }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.account.groups.settings })).toBeInTheDocument();
  });

  it('draws the same routes in another language, so no label is hard-coded', () => {
    renderNav('ru');

    // The assertion is only meaningful while the two differ; a catalogue that had not been
    // translated yet would make this test pass for the wrong reason.
    expect(ru.account.links.saved.label).not.toBe(en.account.links.saved.label);

    const nav = screen.getByRole('navigation', { name: NAV_LABELS.ru });
    expect(within(nav).getByRole('link', { name: ru.account.links.saved.label })).toHaveAttribute('href', '/en/account/saved');
    expect(
      within(nav).getByRole('heading', { name: ru.account.groups.yourAccount }),
    ).toBeInTheDocument();
  });

  it('draws every word it is handed, in each of the four languages', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const groups = groupsFor(locale);
      const { unmount } = renderNav(locale);

      /*
       * The landmark is found by its translated name, not by the English one. That is the
       * assertion as much as the loop body is: `aria-label` is read aloud and never seen, so
       * a name left in English is a defect only a screen-reader user would ever meet.
       */
      const nav = screen.getByRole('navigation', { name: NAV_LABELS[locale] });

      for (const group of groups) {
        expect(
          within(nav).getByRole('heading', { name: group.heading }),
          `${locale} draws ${group.heading}`,
        ).toBeInTheDocument();

        for (const link of group.links) {
          expect(
            within(nav).getByRole('link', { name: link.label }),
            `${locale} draws ${link.label}`,
          ).toHaveAttribute('href', `/en${link.href}`);
        }
      }

      unmount();
    }
  });

  it('marks the page being read, and only that one', () => {
    pathname = '/settings/security';
    renderNav();

    const current = currentLinks();
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/en/settings/security');
  });

  it('marks nothing on a path that is not one of its entries', () => {
    pathname = '/pledges/abc/address';
    renderNav();

    expect(currentLinks()).toEqual([]);
  });
});
