'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@ideanest/ui';
import { revealFocusedItem } from '@ideanest/ui/reveal-focused-item';

/**
 * The profile's three sections — §4.2 P-04, P-05 and P-06, issue #274.
 *
 * <h2>Why this is a real tab widget when `EditorShell`'s is deliberately not</h2>
 *
 * `components/campaign-editor/EditorShell` argues at length that its sections are links and
 * must not carry `role="tab"`: each one is a route, and ARIA tabs over routing break the back
 * button, "open in a new tab", and a copyable address. That argument is exactly right there
 * and does not apply here, because the opposite is true of this page — **the three panels are
 * one document.** All three are already rendered, by one server request, from one profile;
 * nothing is fetched when a tab is pressed and nothing navigates. A `<nav>` of links to
 * `?tab=backed` would turn a state change into a round trip to Next's router for content that
 * is already on the screen.
 *
 * The cost is that the open tab has no address of its own, so a link cannot point at somebody's
 * backed archive. That is the trade, taken knowingly: a profile is a page about a person and
 * the created list is what a link to it should show. If a shareable tab is ever wanted, the
 * fix is three routes and `EditorShell`'s pattern, not a query parameter bolted onto this one.
 *
 * <h2>The keyboard contract, in full</h2>
 *
 * Exactly the APG tabs pattern, because a widget that takes `role="tab"` has promised it:
 *
 *   - **one tab stop for the whole list.** The selected tab is `tabIndex={0}` and the others
 *     are `-1`, so Tab moves past the tablist into the panel rather than through three
 *     controls. A tablist that costs three tab stops is a tablist that should have been links.
 *   - **Left and Right move the selection, and wrap.** The list is short and bounded, so a
 *     wrap costs one keypress and a hard stop costs the reader the fact that the list ended.
 *   - **Home and End** go to the first and last.
 *   - **selection follows focus.** Automatic activation is correct precisely because every
 *     panel is already in the document: the reason the APG warns against it — arrowing
 *     through tabs firing a request each — cannot happen here. Manual activation would mean
 *     a keyboard reader has to press Enter to see what a pointer reader sees by hovering
 *     nothing at all.
 *
 * The panel itself carries `tabIndex={0}` so that a reader who tabs out of the tablist lands
 * inside the content rather than on the first link in it, and so a panel with no focusable
 * element in it is still reachable.
 *
 * <h2>Colour is never the state</h2>
 *
 * The selected tab is `--white-surface`, not lime: a section you are looking at is where you
 * are, not something urgent — the same rule the filter chip follows (docs/ui-kit.md §7.3).
 * And the fill is not what says which tab is open; `aria-selected` does, and the count beside
 * each label is text (§9.2).
 *
 * <h2>Motion: 150ms colour, and nothing else</h2>
 *
 * No entry animation on the panel. A panel that fades in is a panel that arrives after it was
 * asked for, and docs/motion-system.md §8 rules out animating a list of cards regardless.
 */

export interface ProfileTab {
  /** Stable, and part of the generated element ids. */
  readonly key: string;
  readonly label: string;
  /**
   * The number beside the label — **only ever a total that is actually known**.
   *
   * `GET /v1/users/{slug}` carries no counts, and it carries none for a module-boundary
   * reason rather than an accidental one (`lib/profiles/api.ts` explains). So the only figure
   * this application can put here is the length of a list it has loaded, and that is a total
   * exactly when the list has no next page.
   *
   * The caller therefore passes a count for a single-page list and **omits it otherwise**,
   * rather than printing the size of the first page. "24" beside a creator with two hundred
   * campaigns is not an approximation, it is a wrong number, and a reader has no way to tell
   * it from a right one. Omitted for the About tab as well, where there is nothing to count.
   */
  readonly count?: number;
  readonly panel: ReactNode;
}

export interface ProfileTabsProps {
  readonly tabs: readonly ProfileTab[];
  /** Names the tablist for a reader who arrives at it out of context. */
  readonly label: string;
}

const TAB_CLASSES = [
  'inline-flex h-[34px] shrink-0 items-center gap-2 whitespace-nowrap',
  'rounded-full border px-4 text-[13px] font-medium',
  'transition-[background-color,color,border-color] duration-150 ease-in-out',
];

export function ProfileTabs({ tabs, label }: ProfileTabsProps) {
  const base = useId();
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number): void {
    setSelected(index);
    // Focus follows the selection so the roving tabIndex stays on the element the reader is
    // actually on; without this the next Tab would leave from a control that is now -1.
    buttons.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = tabs.length - 1;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        select(index === last ? 0 : index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        select(index === 0 ? last : index - 1);
        break;
      case 'Home':
        event.preventDefault();
        select(0);
        break;
      case 'End':
        event.preventDefault();
        select(last);
        break;
      default:
        break;
    }
  }

  return (
    <div>
      {/*
        `-m-1 p-1`: room for the focus ring inside the scroll container, given back (#177).
        A scroll container clips whatever overflows it, and the kit's unlayered
        `:focus-visible` rule in `theme.css` draws the ring four pixels outside the tab (2px
        wide, 2px off), so without the padding the row cut the ring off at the top, the bottom
        and both ends. The same fix `DashboardNav` (#136) and `CampaignTabs` (#173) carry.
        Nothing moves: the negative margin cancels the padding, and at 320px the four pixels
        the row reaches past the page stay inside its 20px gutter.

        `onFocus`: a tab that takes focus while it is half off the row's edge, from Tab or
        from an arrow key, is scrolled fully into view (#181, `revealFocusedItem` in
        `@ideanest/ui`).
      */}
      <div
        role="tablist"
        aria-label={label}
        className="scrollbar-none -m-1 flex gap-2 overflow-x-auto p-1"
        onFocus={revealFocusedItem}
      >
        {tabs.map((tab, index) => {
          const current = index === selected;

          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.key}`}
              aria-selected={current}
              aria-controls={`${base}-panel-${tab.key}`}
              tabIndex={current ? 0 : -1}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                TAB_CLASSES,
                current
                  ? 'border-transparent bg-white text-on-white'
                  : 'border-white/8 bg-surface-2 text-white/64 hover:bg-surface-3 hover:text-white',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                /*
                  Part of the accessible name rather than hidden from it: "Backed, 12" is what
                  a reader deciding whether to open the tab needs, and the figure is the only
                  thing on the control that says the list is not empty. `tabular-nums` so the
                  pill does not change width as the count does.
                */
                <span
                  className={cn(
                    'tabular-nums',
                    current ? 'text-on-white/64' : 'text-white/40',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${base}-panel-${tab.key}`}
          aria-labelledby={`${base}-tab-${tab.key}`}
          /* A tab stop of its own, so a keyboard reader lands in the content rather than on
             its first link, and so a panel with nothing focusable in it is still reachable. */
          tabIndex={0}
          hidden={index !== selected}
          className="mt-8 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
