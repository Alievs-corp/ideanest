'use client';

import { useId, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { Check, ChevronDown, ClipboardList, LayoutDashboard, LineChart, Users, Wallet } from 'lucide-react';
import { Link } from '../../i18n/navigation';
import { usePathname } from '../../i18n/navigation';
import { cn } from '@ideanest/ui/server';
import type { DashboardNavCopy } from '../../lib/i18n/dashboard-copy';
import { revealFocusedItem } from '@ideanest/ui/reveal-focused-item';

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
 * entry, and the row scrolls each one fully into view as it takes focus: Chromium leaves a tab
 * that is only partly off the edge where it is, so `revealFocusedItem` from `@ideanest/ui`
 * asks for it (#181) — instantly, like the load-time reveal below.
 *
 * <h2>On a phone, a section picker instead of the row — #597</h2>
 *
 * The owner asked for something other than tabs below `sm`: a sideways-scrolling row hides most
 * of its five entries on a phone, and the one a creator is on is the only label that says where
 * they are. So below `sm` the row gives way to one full-width button naming the current section,
 * which opens the five as a list in place (it pushes the panel down rather than covering it, so
 * there is no overlay to trap focus in). The list closes on a choice, on Escape and on a route
 * change, and returns focus to the button on Escape. The row above is unchanged at `sm` and up.
 * The chevron's turn is the only motion, on `transform`, and none under reduced motion.
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
  readonly icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

function panelsFor(projectId: string, copy: DashboardNavCopy): readonly Panel[] {
  const base = `/projects/${encodeURIComponent(projectId)}/dashboard`;
  return [
    { href: base, label: copy.overview, icon: LayoutDashboard },
    { href: `${base}/charts`, label: copy.charts, icon: LineChart },
    { href: `${base}/backers`, label: copy.backers, icon: Users },
    { href: `${base}/finance`, label: copy.finance, icon: Wallet },
    { href: `${base}/surveys`, label: copy.surveys, icon: ClipboardList },
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

  /*
   * A layout effect, so the row is scrolled before the browser paints it: a passive effect ran
   * a frame later, and the row was drawn at its start and then jumped. React 19 runs neither
   * kind on the server and no longer warns about this one there, which is why the repository
   * has no isomorphic wrapper (`TwoFactorPanel` uses it the same way).
   */
  useLayoutEffect(() => {
    const row = rowRef.current;
    const current = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && current) revealInRow(row, current);
  }, [pathname]);

  return (
    <nav aria-label={copy.label} className="sm:border-b sm:border-fg/8">
      <SectionPicker panels={panels} pathname={pathname} caption={copy.label} />
      {/* `-m-1 p-1`: room for the focus ring inside the scroll container, given back. */}
      <ul
        ref={rowRef}
        className="scrollbar-none -m-1 flex gap-1 overflow-x-auto p-1 max-sm:hidden"
        onFocus={revealFocusedItem}
      >
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
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
                  current
                    ? 'border-b-2 border-fg text-fg'
                    : 'border-b-2 border-transparent text-fg-64 hover:text-fg',
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

/** Below `sm`: the current section as a button, and the five as a list it opens in place. */
function SectionPicker({
  panels,
  pathname,
  caption,
}: {
  readonly panels: readonly Panel[];
  readonly pathname: string;
  readonly caption: string;
}) {
  // Open for the page it was opened on, and so closed again by the navigation a choice makes.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = panels.find((panel) => panel.href === pathname) ?? panels[0];

  if (current === undefined) return null;
  const CurrentIcon = current.icon;

  return (
    <div
      className="sm:hidden"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border border-fg/8 bg-surface-2 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <CurrentIcon className="size-5 shrink-0 text-fg-64" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-fg-64">{caption}</span>
          <span className="truncate text-sm font-medium text-fg">{current.label}</span>
        </span>
        <ChevronDown
          className={cn(
            'size-5 shrink-0 text-fg-64 transition-transform duration-150 ease-out motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {open && (
        <ul id={listId} className="mt-2 flex flex-col gap-1 rounded-[14px] border border-fg/8 bg-surface-2 p-1">
          {panels.map((panel) => {
            const here = panel.href === pathname;
            const Icon = panel.icon;
            return (
              <li key={panel.href}>
                <Link
                  href={panel.href}
                  aria-current={here ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
                    here ? 'bg-surface-3 text-fg' : 'text-fg-64 hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <span className="flex-1">{panel.label}</span>
                  {here ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
