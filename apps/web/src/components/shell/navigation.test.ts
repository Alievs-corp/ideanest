import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { describe, expect, it } from 'vitest';
import { FOOTER_GROUPS, PRIMARY_NAVIGATION, isCurrent } from './navigation';

const CATALOGUES = { az, en, ru, tr };
const LOCALES = ['az', 'en', 'ru', 'tr'] as const;

describe('isCurrent', () => {
  it('marks a section current from anywhere inside it', () => {
    // A reader on a subcategory is inside Categories, and a navigation that says otherwise is
    // a navigation that has lost them.
    expect(isCurrent('/categories', '/categories')).toBe(true);
    expect(isCurrent('/categories', '/categories/games')).toBe(true);
    expect(isCurrent('/categories', '/categories/games/tabletop')).toBe(true);
  });

  it('is exact for the home page, which would otherwise be current everywhere', () => {
    expect(isCurrent('/', '/')).toBe(true);
    expect(isCurrent('/', '/discover')).toBe(false);
  });

  it('matches a whole segment rather than a prefix of one', () => {
    expect(isCurrent('/discover', '/discovery-guide')).toBe(false);
  });
});

/**
 * The rule `DashboardNav` states and that matters more in the shell, because this is on every
 * page: an entry pointing at a 404 tells a visitor the site is broken.
 *
 * The list below is every route this application serves that the shell is allowed to point at.
 * A new navigation entry has to be added here as well, which is the point — the test is a
 * second pair of eyes on "does that page exist".
 */
const ROUTES_THAT_EXIST = new Set([
  '/',
  '/discover',
  '/categories',
  '/pricing',
  '/collections',
  '/search',
  '/notifications',
  '/projects/new',
  '/about',
  '/how-it-works',
  '/trust-safety',
  '/legal',
  '/account/saved',
  '/account/following',
  '/account/surveys',
  '/account/deliveries',
  '/settings/notifications',
  '/settings/sessions',
  '/settings/security',
  '/settings/privacy',
  '/sign-in',
  '/register',
]);

describe('the navigation lists', () => {
  it('point only at routes that exist', () => {
    const targets = [
      ...PRIMARY_NAVIGATION.map((link) => link.href),
      ...FOOTER_GROUPS.flatMap((group) => group.links.map((link) => link.href)),
    ];

    for (const href of targets) {
      expect(ROUTES_THAT_EXIST, `${href} is in the shell's navigation`).toContain(href);
    }
  });

  it('keep the header to the three entries §8.6’s collapsed pill has room for', () => {
    expect(PRIMARY_NAVIGATION).toHaveLength(3);
  });

  it('carry pricing in the header, where a creator asks what the platform takes', () => {
    // The one destination outside discovery that decides whether a campaign is started, so
    // the footer is the wrong place for it — see `PRIMARY_NAVIGATION`.
    expect(PRIMARY_NAVIGATION.map((link) => link.href)).toContain('/pricing');
  });

  it('carry the static content pages #292 built', () => {
    // WS-07. They were absent while there was nothing behind them; a footer that lists them
    // and a build that does not serve them is the failure this file exists to catch.
    const targets = FOOTER_GROUPS.flatMap((group) => group.links.map((link) => link.href));
    expect(targets).toContain('/about');
    expect(targets).toContain('/how-it-works');
    expect(targets).toContain('/trust-safety');
  });

  it('carry the collections index #266 built, and only in the footer', () => {
    // D-08's pages are public and indexable, so reachable from the sitemap alone would be a
    // set of pages a crawler finds and a reader never does. The header stays at three entries —
    // the assertion above — because that is what §8.6's collapsed pill has room for.
    const targets = FOOTER_GROUPS.flatMap((group) => group.links.map((link) => link.href));
    expect(targets).toContain('/collections');
    expect(PRIMARY_NAVIGATION.map((link) => link.href)).not.toContain('/collections');
  });

  it('carry §22.2’s documents behind one address, and only one', () => {
    /*
     * This assertion used to be its inverse: no legal link at all, because "a Terms link
     * resolving to nothing is a promise about a document that does not exist". #439 built the
     * pages, so the promise is now keepable — and `/legal` in particular is the one link that
     * is honest whether or not the words exist yet, because it lists all eight required
     * documents and says which have been published.
     *
     * Still one entry. Eight legal links in a footer column is a column nobody reads, and the
     * index is what a regulator actually wants.
     */
    const targets = FOOTER_GROUPS.flatMap((group) => group.links.map((link) => link.href));
    expect(targets).toContain('/legal');
    expect(targets.filter((href) => href.startsWith('/legal'))).toHaveLength(1);
  });

  it('key every entry, and hold no English in the route table at all', () => {
    /*
     * The labels used to live here as literals, which made this module the copy as well as
     * the structure. Since #324 it holds keys, and the assertion is on the shape rather than
     * on the words: a key that is empty resolves to nothing, and a key with a space in it is
     * a label somebody pasted back in.
     */
    for (const group of FOOTER_GROUPS) {
      expect(group.headingKey.trim()).not.toBe('');
      expect(group.headingKey).not.toMatch(/\s/u);

      for (const link of group.links) {
        expect(link.key.trim()).not.toBe('');
        expect(link.key).not.toMatch(/\s/u);
      }
    }

    for (const link of PRIMARY_NAVIGATION) {
      expect(link.key.trim()).not.toBe('');
      expect(link.key).not.toMatch(/\s/u);
    }
  });

  it.each(LOCALES)('has a %s word for every key it declares', (locale) => {
    /*
     * The failure this catches is a route added with a key nobody translated. In production
     * `getMessageFallback` renders the key's own name, so the footer would draw
     * `shell.footer.links.press` — a defect that ships silently because English still reads
     * correctly and nobody on the team reads all four languages.
     */
    const catalogue = CATALOGUES[locale];

    for (const link of PRIMARY_NAVIGATION) {
      expect(catalogue.shell.nav[link.key as keyof typeof catalogue.shell.nav]).toBeTypeOf(
        'string',
      );
    }

    for (const group of FOOTER_GROUPS) {
      const groups = catalogue.shell.footer.groups;
      expect(groups[group.headingKey as keyof typeof groups]).toBeTypeOf('string');

      for (const link of group.links) {
        const links = catalogue.shell.footer.links;
        expect(links[link.key as keyof typeof links]).toBeTypeOf('string');
      }
    }
  });
});
