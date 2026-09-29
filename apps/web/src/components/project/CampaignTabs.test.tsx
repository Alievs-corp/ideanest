import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CAMPAIGN_TABS } from '../../lib/projects/tabs';
import { CampaignTabs } from './CampaignTabs';
import { resolveServerTree } from '../../test-support/server-tree';
import { translatorFor } from '../../test-copy';

/*
 * The real catalogue, through next-intl's own formatter.
 *
 * `createTranslator` rather than a hand-rolled substitution, because these messages carry ICU
 * plurals — `{days, plural, one {# day left} other {# days left}}` — and a regex that swapped
 * `{days}` for a number would produce a sentence no language actually renders. Asserting
 * against `messages/en.json` formatted the way the application formats it is what makes this
 * suite fail when a translation is edited to something the component no longer draws.
 */
/*
 * The route's language, switchable per test. #132 is a defect that English passing could never
 * show — the labels it replaced were English too — so one test renders the strip in Azerbaijani.
 */
const route = vi.hoisted(() => ({ locale: 'en' as 'en' | 'az' }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const CATALOGUES = {
    en: (await import('../../../messages/en.json')).default,
    az: (await import('../../../messages/az.json')).default,
  };

  return {
    getLocale: async () => route.locale,
    /*
     * `namespace` is a plain string here and a union of every valid path in next-intl's own
     * types. The cast is at the mock's edge rather than at each call: what a component asks
     * for is whatever it asks for, and a namespace that does not exist fails as a missing
     * message — which is the failure worth seeing.
     */
    getTranslations: async (namespace: string) =>
      createTranslator({
        locale: route.locale,
        messages: CATALOGUES[route.locale],
        namespace: namespace as never,
      }),
  };
});



/**
 * §4.4's tab strip — #282, #283, #284, #285.
 *
 * WHAT THESE COVER:
 *
 *   - **the FAQ tab is in the strip and it is a link to `?tab=faq`.** #283's tab is only
 *     reachable if it is an address: a crawler follows a link, a reader can send one, and
 *     somebody whose JavaScript never arrives can still open it.
 *   - **this is a list of links and NOT an ARIA tab widget** (docs/architecture.md §4.4).
 *     `role="tab"` promises arrow-key movement and a panel that changes without navigating,
 *     and both would be lies here. A widget whose roles promise behaviour it does not have is
 *     worse than no roles at all, so the test asserts the roles are absent rather than
 *     present.
 *   - **the current tab is marked in more than a colour.** `aria-current="page"` carries it to
 *     a screen reader and a weight change carries it to somebody who cannot separate two greys
 *     (docs/ui-kit.md §9.2).
 *   - **the default tab is the bare path.** `?tab=campaign` and the bare path are the same
 *     page, and the moment the strip produces both, one campaign has two addresses.
 *   - **the row cannot wrap.** Five labels do not fit across a phone, and a wrapped second row
 *     would push the campaign's content down by a line on exactly the narrow viewports where
 *     vertical space is scarcest — so the row scrolls instead.
 */

const PATH = '/projects/ayan/coffee-table-book';

/** The words the strip must draw, from the catalogue rather than retyped (#132). */
const TABS = translatorFor('campaign.tabs');

afterEach(() => {
  cleanup();
  route.locale = 'en';
});

describe('the campaign tab strip', () => {
  it('offers the FAQ tab as a link to ?tab=faq', async () => {
    render(await resolveServerTree(<CampaignTabs active="campaign" path={PATH} />));

    expect(screen.getByRole('link', { name: TABS('faq') })).toHaveAttribute(
      'href',
      `/en${PATH}?tab=faq`,
    );
  });

  it('publishes every tab the module declares, in that order', async () => {
    render(await resolveServerTree(<CampaignTabs active="campaign" path={PATH} />));

    const names = within(screen.getByRole('navigation', { name: TABS('label') }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(CAMPAIGN_TABS.map((tab) => TABS(tab.id)));
    expect(names).toContain(TABS('faq'));
  });

  /**
   * #132. The labels used to be English literals in `lib/projects/tabs.ts`, so every language
   * drew "Campaign · Creator · FAQ · Updates · Comments" — and, because the label is the link's
   * accessible name, a screen reader read English words in an Azerbaijani voice.
   */
  it('names every tab in the route’s language, not in English', async () => {
    route.locale = 'az';
    const AZ = translatorFor('campaign.tabs', 'az');
    render(await resolveServerTree(<CampaignTabs active="campaign" path={PATH} />));

    const names = within(screen.getByRole('navigation', { name: AZ('label') }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(CAMPAIGN_TABS.map((tab) => AZ(tab.id)));
    for (const english of CAMPAIGN_TABS.map((tab) => TABS(tab.id))) {
      expect(names).not.toContain(english);
    }
  });

  it('gives the default tab the bare path, so one campaign has one address', async () => {
    render(await resolveServerTree(<CampaignTabs active="faq" path={PATH} />));

    expect(screen.getByRole('link', { name: TABS('campaign') })).toHaveAttribute('href', `/en${PATH}`);
  });

  it('marks the tab being read in words rather than in colour alone', async () => {
    render(await resolveServerTree(<CampaignTabs active="faq" path={PATH} />));

    expect(screen.getByRole('link', { name: TABS('faq') })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: TABS('updates') })).not.toHaveAttribute('aria-current');
  });

  /**
   * docs/architecture.md §4.4 states this outright: the strip is a list of links and
   * deliberately not an ARIA tab widget, because activating one navigates.
   */
  it('is navigation, not a tab widget', async () => {
    render(await resolveServerTree(<CampaignTabs active="campaign" path={PATH} />));

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('navigation', { name: TABS('label') })).toBeInTheDocument();
  });

  /**
   * Five tabs no longer fit across a phone. The row must therefore scroll — a second row
   * would move the campaign's own content down by a line on the narrowest viewports.
   */
  it('keeps the five tabs on one scrollable row rather than wrapping', async () => {
    const { container } = render(await resolveServerTree(<CampaignTabs active="campaign" path={PATH} />));

    const row = container.querySelector('ul');
    expect(row).toHaveClass('overflow-x-auto');
    expect(row?.className).not.toContain('flex-wrap');

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('whitespace-nowrap');
    }
  });

  /**
   * #173. A scroll container clips whatever overflows it, and the ring is drawn four pixels
   * outside the tab (2px wide, 2px off — `theme.css`'s unlayered `:focus-visible` rule, which
   * no offset utility on the link can override, so the old `outline-offset-[-2px]` inset ring
   * was never drawn). The row pads itself by exactly that on every side and gives it back with
   * a negative margin, as `DashboardNav` and `AccountNav` do; the bottom gives back one pixel
   * more, so the current tab's rule still lies over the nav's hairline.
   */
  it('draws a focus ring on every tab that the scrolling row leaves room for', async () => {
    const { container } = render(await resolveServerTree(<CampaignTabs active="campaign" path={PATH} />));

    const row = container.querySelector('ul') as HTMLElement;
    expect(row).toHaveClass('p-1');
    expect(row).toHaveClass('-mx-1');
    expect(row).toHaveClass('-mt-1');
    expect(row).toHaveClass('-mb-[5px]');
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('focus-visible:outline-2');
      expect(link).toHaveClass('focus-visible:outline-offset-2');
      expect(link).toHaveClass('focus-visible:outline-[var(--lime-500)]');
      expect(link.className).not.toContain('outline-offset-[-');
    }
  });
});
