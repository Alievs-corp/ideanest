'use client';

import { Link } from '../../i18n/navigation';
import { usePathname } from '../../i18n/navigation';
import { isCurrentConsoleLink, visibleConsoleGroups } from '../../lib/admin/navigation';
import type { AdminShellCopy } from '../../lib/i18n/admin-copy';
import { useConsoleMembership } from './ConsoleMembership';

/**
 * The console's own navigation — §4.11, issue #294.
 *
 * <h2>A client boundary, for the path and now for the reader</h2>
 *
 * Nothing here has state and nothing fetches. What it needs is the current path, to mark one
 * entry `aria-current="page"`, and that is not knowable in a layout on the server without
 * every page threading its own path down — a rule somebody eventually forgets and nothing
 * catches. `AccountNav` draws the same boundary for the same reason.
 *
 * <p>The second thing it needs is who is reading, and that has the same shape: the answer is
 * `GET /v1/admin/me`, the session it needs lives in this process, and the shell already reads
 * it once for the gate and the reader line. `ConsoleMembership` is that one read.
 *
 * <h2>It draws the entries this reader can open — issue #295</h2>
 *
 * <p>`visibleConsoleGroups` is the rule and `lib/admin/navigation.ts` carries the argument,
 * including the earlier decision to show everybody everything and why it was reversed. Two
 * consequences are this component's own.
 *
 * <p><strong>Nothing is drawn until the membership arrives.</strong> Not the full rail, not a
 * skeleton: a rail drawn from a guess is a rail that visibly rearranges itself a beat later,
 * which is movement on a surface docs/motion-system.md §5 gives none — and the guess that
 * reads worst is the generous one, where entries a curator may not open appear and then
 * vanish.
 *
 * <p><strong>A `<nav>` with no entries is not rendered at all.</strong> An empty landmark is
 * one an assistive technology still announces and offers to jump to, and there would be
 * nothing there when it did.
 *
 * <h2>The entries are read from the module list rather than passed in</h2>
 *
 * Unlike `AccountNav`, which takes its words as props because they come out of the message
 * catalogue on the server. There is no catalogue here — `lib/admin/navigation.ts` says why
 * the console is English — so importing the list costs the browser the same handful of
 * strings the props would have, and having one source means the rail and the console index
 * cannot disagree about what exists.
 *
 * <h2>`aria-current` carries it; the treatment is the second signal</h2>
 *
 * docs/ui-kit.md §9.2 forbids colour alone. The current entry is white on `--surface-2` with
 * a lime rule down its leading edge, and it is the `aria-current` a screen reader reads.
 *
 * <h2>It scrolls on its own Y axis, and here it had to</h2>
 *
 * The fix `AccountNav` took in #349, applied to the rail that needed it more. `sticky` pins
 * this below the header and keeps it there while the page moves, which is the point of it;
 * the consequence was that a rail taller than the viewport had a bottom nobody could reach.
 * Scrolling the page moved the screen on the right and left the rail exactly where it was.
 *
 * <p>The account rail has thirteen destinations and could hide its last group on a short
 * laptop. This one has **twenty-six across six groups** — `CONSOLE_GROUPS` is the whole
 * console — so on any ordinary viewport the last group or two were unreachable by
 * construction rather than at a particular zoom level. Support, the staff roster and the
 * health board sat below the fold of a container that does not scroll.
 *
 * <p>`100dvh` and not `100vh`: the dynamic unit tracks a collapsing browser toolbar, and
 * `vh` would size the rail to a viewport the reader does not have. `overscroll-contain` is
 * the half that makes it independent rather than merely scrollable — without it, reaching the
 * end of the rail hands the wheel to the page and scrolls the screen nobody was looking at.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 gives an administrative surface the same budget as account
 * settings — none, beyond 150ms of colour on a control. A console is worked in, and a rail
 * that animated would animate on every screen in it.
 */
export interface AdminNavProps {
  /** The rail's words, resolved by the layout — see `lib/i18n/admin-copy.ts`. */
  readonly copy: AdminShellCopy;
}

export function AdminNav({ copy }: AdminNavProps) {
  const pathname = usePathname();
  const { membership } = useConsoleMembership();

  /*
   * `null` and not `[]` for a reader whose membership has not arrived: the two are different
   * questions — "we do not know yet" and "nothing" — and `visibleConsoleGroups` answers both
   * with an empty rail on purpose. A reader who is not staff has no entries either, and gets
   * `ConsoleGate`'s sentence in the place the screen would have been.
   */
  const groups = visibleConsoleGroups(membership?.capabilities ?? null);

  if (groups.length === 0) return null;

  return (
    <nav
      aria-label={copy.navLabel}
      className={[
        'lg:sticky lg:top-8',
        /*
          The rail is its own scroll container above the breakpoint — see the docblock. The
          offset is the `top-8` above it (2rem) plus 2rem, so the last entry does not sit
          flush against the bottom edge of the viewport.
        */
        'lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:overscroll-contain',
        /*
          Room for the focus ring, which the scroll container would otherwise clip. The links
          take `outline-2 outline-offset-2` — four pixels outside their own box — and
          docs/ui-kit.md §9.3 requires it visible on every interactive element. The negative
          margin gives the padding back, so nothing moves.
        */
        'lg:-mx-1 lg:px-1',
      ].join(' ')}
    >
      <ul className="flex list-none gap-x-6 gap-y-8 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-1">
        {groups.map((group) => (
          <li key={group.heading} className="min-w-max lg:min-w-0">
            <h2 className="px-3 text-xs font-medium tracking-[0.08em] text-white/40 uppercase">
              {copy.groups[group.heading]}
            </h2>
            <ul className="mt-2 flex list-none gap-1 lg:flex-col">
              {group.links.map((link) => {
                const current = isCurrentConsoleLink(link, pathname);
                return (
                  <li key={link}>
                    <Link
                      href={link}
                      aria-current={current ? 'page' : undefined}
                      className={[
                        'block rounded-lg border-l-2 px-3 py-2 text-[15px] transition-colors duration-150 ease-in-out',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
                        current
                          ? 'border-[var(--lime-500)] bg-surface-2 text-white'
                          : 'border-transparent text-white/64 hover:bg-surface-2 hover:text-white',
                      ].join(' ')}
                    >
                      {copy.links[link]}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
