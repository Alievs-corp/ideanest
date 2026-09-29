'use client';

import { useEffect, useRef } from 'react';
import { Link } from '../../i18n/navigation';
import { usePathname } from '../../i18n/navigation';
import { cn } from '@ideanest/ui/server';
import type { DashboardNavCopy } from '../../lib/i18n/dashboard-copy';

/**
 * The way between the dashboard's panels.
 *
 * <h2>It lists what exists, and nothing else</h2>
 *
 * §4.7 describes nineteen capabilities and this shell has five panels: the overview
 * (CD-01, #93), the charts (CD-02, CD-07 and CD-08, #96), the backers (CD-10 and CD-11,
 * #97 and #79), the financial summary (CD-16, #99), and §4.8's surveys (PM-01 to PM-04,
 * #73). This paragraph used to record that the fifth was missing, because an entry that was
 * disabled, or pointing at a 404, would tell a creator the dashboard is unfinished — which is
 * the one thing a shell exists to avoid saying. It is built, so it is here.
 *
 * <p>The order is the order a creator reads them in: what the campaign has raised, then
 * how it raised it, then who the people are, then what they were actually paid, then what
 * those people still have to tell them. Not the order the issues landed in — and surveys go
 * last for a reason of their own, since §4.8 begins when funding closes and everything above
 * it does not.
 *
 * <p>The money sits after the people rather than beside "Overview", and that is deliberate:
 * the overview's "raised" is what backers pledged, and this panel's "net" is what reaches a
 * bank account. Two figures about the same campaign that differ by the fees, adjacent in a
 * navigation bar, is an invitation to read one as a correction of the other.
 *
 * <h2>A client component for one reason</h2>
 *
 * `usePathname`, to mark the current panel, and the one effect that follows from it below.
 * No fetch, no state.
 *
 * <h2>One row that scrolls sideways on a phone — #136</h2>
 *
 * Five labels do not fit across a phone: in Russian they are about 470px of tabs against the
 * 280px a 320px screen leaves inside the page gutter, and the row used to neither wrap nor
 * scroll, so the last tabs were pushed off the screen and the page itself scrolled sideways.
 * The row now scrolls on its own axis, which is what the account and admin navigation already
 * do below their breakpoint (`AccountNav`, `AdminNav`) and what the campaign page's tab strip
 * does (`CampaignTabs`) — one pattern, not a select on one screen and a scroller on another.
 * No label wraps (`whitespace-nowrap`), and a second row is not an option either: it would
 * push the panel down on exactly the viewports where height is scarcest.
 *
 * Scrolling hides something, so the current tab is brought into view when the panel loads:
 * "Surveys" is last, and a creator who opened it from an email would otherwise land on a row
 * that shows four other tabs and not the one they are on. Only the row scrolls, never the page
 * — `scrollIntoView` would also move the window vertically to satisfy its own alignment — and
 * it jumps rather than glides, because docs/motion-system.md §5 gives a working surface no
 * motion to spend on it.
 *
 * A scroll container clips whatever overflows it, and the focus ring is drawn outside the tab:
 * two pixels wide, two pixels off (the kit's `:focus-visible` rule in `theme.css`, which is
 * unlayered and so outranks any offset utility put on the link). So the row carries four
 * pixels of padding on every side and gives them back with a negative margin, the way
 * `AccountNav` makes room for the same ring — nothing moves, and ui-kit §9.3's ring is whole
 * rather than cut off at the top, the bottom and the row's edges. Tab still reaches every
 * entry, and the browser scrolls each one into view as it takes focus.
 *
 * <h2>Accessibility</h2>
 *
 * `aria-current="page"` carries the selection, not the colour. docs/ui-kit.md §9.2:
 * colour alone never carries meaning, and "which page am I on" is meaning. The underline
 * is a second, visual signal for the same fact.
 */

interface Panel {
  readonly href: string;
  readonly label: string;
}

function panelsFor(projectId: string, copy: DashboardNavCopy): readonly Panel[] {
  const base = `/projects/${encodeURIComponent(projectId)}/dashboard`;
  return [
    { href: base, label: copy.overview },
    { href: `${base}/charts`, label: copy.charts },
    { href: `${base}/backers`, label: copy.backers },
    { href: `${base}/finance`, label: copy.finance },
    { href: `${base}/surveys`, label: copy.surveys },
  ];
}

export interface DashboardNavProps {
  readonly projectId: string;
  /** Resolved by the layout — `lib/i18n/dashboard-copy.ts` explains why it is a prop. */
  readonly copy: DashboardNavCopy;
}

/**
 * Scroll `row` sideways so `tab` is inside it, centred where the row allows.
 *
 * Nothing happens when the tab is already fully visible, which is every wide viewport: the
 * row does not overflow there, and moving it would be moving something nobody asked to move.
 */
function revealInRow(row: HTMLElement, tab: HTMLElement): void {
  const box = row.getBoundingClientRect();
  const target = tab.getBoundingClientRect();
  if (target.left >= box.left && target.right <= box.right) return;

  const offset = target.left - box.left - (box.width - target.width) / 2;
  row.scrollTo({ left: row.scrollLeft + offset, behavior: 'auto' });
}

export function DashboardNav({ projectId, copy }: DashboardNavProps) {
  const pathname = usePathname();
  const panels = panelsFor(projectId, copy);
  const rowRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const row = rowRef.current;
    const current = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && current) revealInRow(row, current);
  }, [pathname]);

  return (
    <nav aria-label={copy.label} className="border-b border-white/8">
      {/* `-m-1 p-1`: room for the focus ring inside the scroll container, given back. */}
      <ul ref={rowRef} className="-m-1 flex gap-1 overflow-x-auto p-1">
        {panels.map((panel) => {
          const current = pathname === panel.href;
          return (
            <li key={panel.href} className="shrink-0">
              <Link
                href={panel.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  // The focus ring is on every item and is never removed: ui-kit §9.3
                  // makes it a build error, and a keyboard user on a nav with no visible
                  // focus has no way to know where they are.
                  'inline-block whitespace-nowrap rounded-t-[10px] px-4 py-3 text-sm font-medium',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
                  current
                    ? 'border-b-2 border-white text-white'
                    : 'border-b-2 border-transparent text-white/64 hover:text-white',
                )}
              >
                {panel.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
