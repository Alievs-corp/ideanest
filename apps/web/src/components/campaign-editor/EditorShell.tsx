'use client';

import { Link } from '../../i18n/navigation';
import type { ReactNode } from 'react';
import { Tag, cn } from '@ideanest/ui';
import type { EditorChromeCopy } from '../../lib/i18n/campaign-editor-copy';
import type { ProjectState } from '../../lib/projects/api';
import { EDITOR_TABS, editorTabHref, type EditorTabKey } from './tabs';

/**
 * The frame every editor tab renders inside: who the project is, what state it
 * is in, whether the work is saved, and how to get to the other sections.
 *
 * IT IS NAVIGATION, NOT A TAB WIDGET. Each section is a route, so the controls
 * are links in a `<nav>` with `aria-current="page"`, not `role="tablist"`.
 * ARIA tabs promise same-document panels and take over the arrow keys; used over
 * routing they break the browser's own controls — the back button, "open in a
 * new tab", and a copyable address for the section somebody is looking at. Tab
 * and Enter already work, and they work the way the rest of the web does.
 *
 * The links are not `Chip` either, even though they wear its clothes: `Chip` is
 * a button carrying `aria-pressed`, which describes a toggle rather than the
 * page you are on.
 *
 * MOTION: none. `docs/motion-system.md` §5 gives the campaign editor "none —
 * autosave indicator only", so the only animation on this surface is the one
 * inside `SaveStatus`. Colour changes take the 150ms the rest of the system
 * uses; nothing enters, nothing fades up.
 */


const TAB_BASE = [
  'inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap',
  'rounded-full border px-4 text-[13px] font-medium',
  'transition-[background-color,color,border-color] duration-150 ease-in-out',
];

export interface EditorShellProps {
  projectId: string;
  /** The frame's words, resolved on the server by the tab's own page. */
  copy: EditorChromeCopy;
  /** Which tab the surrounding route is. */
  active: EditorTabKey;
  /** The project's title, once it has loaded. */
  title?: string | null;
  state?: ProjectState | null;
  /**
   * The save indicator, supplied by the tab.
   *
   * The shell does not own it: each tab saves its own fields through its own
   * `useAutosave`, and a shell that held the state would have to know about
   * every form inside it.
   */
  status?: ReactNode;
  children: ReactNode;
}

export function EditorShell({
  projectId,
  copy,
  active,
  title,
  state,
  status,
  children,
}: EditorShellProps) {
  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-10 sm:px-6 sm:py-14">
      {/*
        A `<div>` and not a `<header>` since #347, when this frame moved inside `SiteShell`.
        HTML-AAM gives `<header>` the `banner` role unless it descends from `article`,
        `aside`, `main`, `nav` or `section`; this one descends from the shell's `<main>`, so
        by the specification it is already generic and the element was doing no work.

        It is a `<div>` anyway because "already generic by the specification" is a claim about
        every consumer of the tree, and it is not one that holds uniformly — testing-library
        reports two banners for this arrangement, and assistive technology has been
        inconsistent about the scoping rule for longer than that. A page that announces two
        site headers is telling somebody there are two to choose between. Nothing is given up:
        the role was generic in the tree this markup is meant to produce.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-[0.06em] text-white/40 uppercase">
            {copy.eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
            {/* An untitled project is impossible — creation requires a title —
                but a project still loading has no title to show yet. */}
            {title ?? copy.loadingTitle}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {state != null && <Tag>{copy.states[state]}</Tag>}
          {status}
        </div>
      </div>

      <nav aria-label={copy.sectionsLabel} className="mt-7">
        <ul className="scrollbar-none flex gap-2 overflow-x-auto">
          {EDITOR_TABS.map((tab) => {
            const current = tab.key === active;

            if (!tab.available) {
              /*
               * Focusable on purpose. A section that exists but is not finished
               * is worth knowing about, and `disabled` would take it out of the
               * tab order entirely — a keyboard user would simply never learn it
               * was there. `aria-disabled` announces the state and the button
               * does nothing, which is the honest combination.
               */
              return (
                <li key={tab.key}>
                  <button
                    type="button"
                    aria-disabled="true"
                    className={cn(
                      TAB_BASE,
                      'cursor-default border-white/8 bg-surface-2 text-white/64',
                    )}
                  >
                    {copy.tabs[tab.key]}
                    {/*
                      Visible cue and spoken cue, saying the same thing. The
                      hidden half keeps the accessible name honest — it contains
                      the visible label rather than replacing it.

                      The word is what marks the tab as unavailable, not a
                      dimmer grey: --text-disabled is 2.6:1 and prohibited for
                      text (docs/ui-kit.md §9.2), and dimness alone would be
                      colour carrying meaning by itself.
                    */}
                    <span aria-hidden="true" className="text-white/40">
                      {copy.soon}
                    </span>
                    {/* The comma is load-bearing. An accessible name is the
                        concatenation of its parts with each part trimmed and no
                        separator inserted, so a leading space would be dropped
                        and the name would read "Rewardsnot available yet". */}
                    <span className="sr-only">{copy.notAvailable}</span>
                  </button>
                </li>
              );
            }

            return (
              <li key={tab.key}>
                <Link
                  href={editorTabHref(projectId, tab)}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    TAB_BASE,
                    // White for "you are here", never lime: a section is not
                    // urgent (docs/ui-kit.md §7.3).
                    current
                      ? 'border-transparent bg-white text-on-white'
                      : 'border-white/8 bg-surface-2 text-white/64 hover:bg-surface-3 hover:text-white',
                  )}
                >
                  {copy.tabs[tab.key]}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-8">{children}</div>
    </div>
  );
}
