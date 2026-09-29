import { Link } from '../../i18n/navigation';
import { CAMPAIGN_TABS, campaignTabHref, type CampaignTabId } from '../../lib/projects/tabs';
import { getTranslations } from 'next-intl/server';
import { ScrollRow } from '../shell/ScrollRow';

/**
 * §4.4's tab list — issues #282, #283, #284 and #285, and the shell all four hang from.
 *
 * <h2>Links in a navigation landmark, and NOT an ARIA tab widget</h2>
 *
 * This looks like a tab strip and is deliberately not marked up as one. `role="tablist"`,
 * `role="tab"` and `aria-selected` are a contract with the reader: arrow keys move between
 * the tabs, one tab stop holds the whole group, focus stays inside the widget, and the panel
 * changes without the page moving. Every one of those requires JavaScript to manage roving
 * `tabindex` — which would make the tab shell a client boundary on the route #119 exists to
 * keep server-rendered — and the last one would be a lie regardless, because activating one
 * of these performs a navigation.
 *
 * <strong>A widget whose roles promise behaviour it does not have is worse than no roles.</strong>
 * A screen reader user told "tab, 2 of 5" presses the right arrow and nothing happens. So
 * these are what they actually are: links, in a `<nav>` with a name, in a list, with
 * `aria-current="page"` on the one being read. That is a pattern every assistive technology
 * already understands, it needs no JavaScript, every browser's own keyboard handling works,
 * and a crawler follows it.
 *
 * `lib/projects/tabs.ts` argues the other half of this — why the tab is a query parameter
 * rather than local state or a route per tab, and which of §4.4's seven tabs exist.
 *
 * <h2>Server-rendered, and the row is the only boundary</h2>
 *
 * No state, no hook. The active tab arrives as a prop because the page read it from the
 * address, so the correct tab is in the HTML rather than chosen after hydration — which is
 * what makes a link to the Comments tab open the comments for somebody whose JavaScript never
 * arrives. The one handler is the row's focus reveal (#181, below), and it lives in
 * `ScrollRow`, a client `<ul>` the server-rendered tabs are passed into as children.
 *
 * <h2>Colour and focus</h2>
 *
 * The current tab is white text over a white rule; the rest are `--text-secondary` (§2.2,
 * 9.2:1). <strong>No lime</strong>: lime is "act now" (§2.4) and a tab is a place, not an
 * urgency. Colour is not the only signal either — `aria-current` carries it to a screen
 * reader and the weight change carries it to somebody who cannot separate the two greys
 * (§9.2). The focus ring is the kit's lime outline on a dark ground, which §9.3 permits and
 * which is the one place lime belongs on this component.
 *
 * <h2>Room for the ring inside the scroll row — #173</h2>
 *
 * The row scrolls (below), and a scroll container clips whatever overflows it. The ring is
 * drawn outside the tab: two pixels wide, two pixels off. The link used to ask for an inset
 * ring with `outline-offset-[-2px]`, but the kit's `:focus-visible` rule in `theme.css` is
 * unlayered and so outranks any offset utility — the ring was drawn outside anyway and the
 * row cut it off at the top, the bottom and both ends. So the row carries four pixels of
 * padding on every side and gives them back with a negative margin, as `DashboardNav` and
 * `AccountNav` do for the same ring. The bottom margin is one pixel more than the padding
 * because the row has always hung one pixel below the nav, so a tab's rule covers the nav's
 * hairline rather than sitting on top of it. At 320px the four pixels the row reaches past
 * the nav on each side stay inside the page's own 20px gutter, so the page does not scroll.
 */

export interface CampaignTabsProps {
  readonly active: CampaignTabId;
  /** §10.2's canonical path for this campaign. Every tab is that path plus a parameter. */
  readonly path: string;
}

export async function CampaignTabs({ active, path }: CampaignTabsProps) {
  const t = await getTranslations('campaign.tabs');

  return (
    <nav aria-label={t('label')} className="mt-10 border-b border-white/8">
      {/*
        THE ROW SCROLLS RATHER THAN WRAPPING, AND #283 IS THE DAY THAT STARTED MATTERING.

        This comment used to say "four tabs fit on a phone; the day a fifth is added…". The
        FAQ tab is the fifth. Five labels — Campaign, Creator, FAQ, Updates, Comments — are
        roughly 450px of pills at this size, against about 320px of content width on a 360px
        phone, so the row genuinely overflows now rather than hypothetically.

        Nothing had to change for it. `flex` without `flex-wrap` cannot wrap, every label
        carries `whitespace-nowrap` so no label breaks mid-word, and `overflow-x-auto` makes
        the surplus a horizontal scroll instead of a second row that would push the campaign's
        own content down by a line on exactly the viewports where vertical space is scarcest.

        The scroll is not a keyboard trap: these are links, so Tab moves through them. The
        browser does not scroll a tab that is only partly off the edge, though (#181), so
        `ScrollRow` brings each one fully into view as it takes focus. Without JavaScript the
        row still scrolls and every tab is still reachable; only that last nudge is missing.
      */}
      {/*
        `-mx-1 -mt-1 p-1`: room for the focus ring inside the scroll container, given back.
        `-mb-[5px]`: the same four pixels, plus the one that lays the tabs' rule over the
        nav's hairline (#173 — see above).
      */}
      <ScrollRow className="-mx-1 -mt-1 -mb-[5px] flex gap-1 overflow-x-auto p-1">
        {CAMPAIGN_TABS.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={campaignTabHref(path, tab.id)}
                /*
                 * `page`, not `true`. `aria-current="page"` is the value for "this link points
                 * at the resource being viewed", and it is accurate here in a way it would not
                 * be in a real tab widget: each tab genuinely is an address, and following one
                 * genuinely navigates.
                 */
                aria-current={current ? 'page' : undefined}
                /*
                 * `scroll={false}` so following a tab keeps the reader where they were rather
                 * than throwing them to the top of the campaign. The header above is unchanged
                 * between tabs, so scrolling to it would be scrolling to something they have
                 * already read.
                 */
                scroll={false}
                className={[
                  'inline-flex h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm',
                  'transition-colors duration-150 ease-in-out',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
                  current
                    ? 'border-white font-medium text-white'
                    : 'border-transparent text-white/64 hover:border-white/16 hover:text-white',
                ].join(' ')}
              >
                {/*
                  #132: the catalogue's word for the tab, in the route's language. It is also
                  the link's accessible name, so an English label here was an English word read
                  in an Azerbaijani voice.
                */}
                {t(tab.id)}
              </Link>
            </li>
          );
        })}
      </ScrollRow>
    </nav>
  );
}
