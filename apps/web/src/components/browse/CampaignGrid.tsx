import type { ProjectCard as ProjectCardData } from '../../lib/discovery/api';
import { ProjectCard } from '../discovery/ProjectCard';
import type { ProjectCardCopy } from '../../lib/i18n/card-copy';
import type { Locale } from '../../lib/i18n/locale';

/**
 * A grid of campaigns, server-rendered — the body of the home page, the category landing
 * pages and the search results.
 *
 * <h2>The same card as the feed, and that is the point</h2>
 *
 * `ProjectCard` already decides how a campaign is presented: which badge, when the urgency
 * pill is lime, that the completion figure is text as well as a bar, that money is read with
 * `decimal.js` and never with `Number()`. A second card for the same JSON would be a second
 * place for those to be wrong, and the one that is wrong is always the one nobody is looking
 * at.
 *
 * <h2>Server-rendered, with the campaigns in the HTML</h2>
 *
 * No `'use client'` anywhere beneath this. These pages exist to be indexed — WS-04 and WS-05
 * are the two surfaces §11 and the SEO epic actually have to rank — so a grid the browser
 * assembles would be a grid a crawler never sees. #119 made the same argument for
 * `/discover` and this is the same requirement on the pages that came after it.
 *
 * <h2>No entry animation</h2>
 *
 * docs/motion-system.md §5.1: "project cards — none". It is stated for a filtered feed and
 * the reason travels: a stagger ladder across a grid is a page that never settles, and these
 * grids are read by somebody deciding what to open.
 *
 * The first row loads its covers eagerly and nothing below does. The widest this grid gets
 * is three columns, so "index under three" is the set that can be on screen before a scroll
 * rather than a guess — one of them is the largest contentful paint on the home page.
 */

export interface CampaignGridProps {
  readonly campaigns: readonly ProjectCardData[];
  /**
   * How many covers are fetched eagerly. Zero below the fold — a second grid on the same
   * page must not compete with the first for the largest contentful paint.
   */
  readonly priorityCount?: number;
  /** Announced to a screen reader as the list's name, since the heading is outside it. */
  readonly label: string;
  /** The card's words. Passed through rather than resolved — see `lib/i18n/card-copy.ts`. */
  readonly cardCopy: ProjectCardCopy;
  /** The language, for the card's two counted sentences. */
  readonly locale: Locale;
}

export function CampaignGrid({
  campaigns,
  priorityCount = 0,
  label,
  cardCopy,
  locale,
}: CampaignGridProps) {
  return (
    <ul
      aria-label={label}
      className="grid list-none grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {campaigns.map((card, index) => (
        <li key={card.id}>
          <ProjectCard
            card={card}
            priority={index < priorityCount}
            copy={cardCopy}
            locale={locale}
          />
        </li>
      ))}
    </ul>
  );
}
