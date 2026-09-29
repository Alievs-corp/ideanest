'use client';

import { Link } from '../../i18n/navigation';
import { usePathname } from '../../i18n/navigation';
import { revealFocusedItem } from '@ideanest/ui';
import { isCurrentAccountLink } from '../../lib/account/navigation';

/**
 * The account area's own navigation — §4.2, issue #275.
 *
 * <h2>A client boundary, and only for `usePathname`</h2>
 *
 * Nothing here has state and nothing fetches. What it needs is the current path, to mark one
 * entry `aria-current="page"`, and that is not knowable in a layout on the server without
 * threading it down from every page. One small boundary beside the content is the cheaper of
 * the two — the alternative is every page in the area passing its own path to its layout,
 * which is a rule somebody eventually forgets and nothing catches.
 *
 * <h2>`aria-current` carries it; the treatment is the second signal</h2>
 *
 * docs/ui-kit.md §9.2 forbids colour alone. The current entry is white on `--surface-2` with
 * a lime rule down its leading edge, and it is the `aria-current` that a screen reader reads.
 * Neither is sufficient on its own and both are present.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 puts "authentication, account settings" at **none — 150ms colour
 * on controls**. A navigation that animated between entries would be animating on every
 * screen in the area, on a surface whose whole job is to be worked in.
 *
 * <h2>It scrolls on its own axis on both, and the reason differs</h2>
 *
 * On a wide viewport the rail is sticky, so a rail taller than the screen used to have a
 * bottom nobody could reach: the page scrolled, the content on the right moved, and the rail
 * stayed pinned with its last group below the fold. It is its own scroll container since
 * #349, with `overscroll-contain` so reaching its end does not hand the wheel to the page.
 * The class list below argues each part, including the padding that keeps the focus ring from
 * being clipped by the container that fixed the first problem.
 *
 * <h2>It scrolls sideways on a phone, rather than collapsing</h2>
 *
 * Below the breakpoint the two groups become one horizontally scrolling row. A drawer would
 * be a second off-canvas panel in an application that already has one (WS-03) and would hide
 * the thirteen destinations behind a control, on the screens where somebody arrived
 * specifically to reach one of them.
 *
 * <h2>The words arrive as props, already translated — §21.1, issue #324</h2>
 *
 * `lib/account/navigation.ts` carries keys, and **the server resolves them.** This component
 * used to call `useTranslations('account')` under a `NextIntlClientProvider` that `AccountArea`
 * put above it, which worked and was expensive in exactly the way `apps/web/performance/README.md`
 * refuses to let pass unnoticed: the provider drags next-intl's client runtime plus the whole
 * serialised `account` namespace into the First Load JS of **every** route in the area. That
 * broke sixteen budgets at once — `/settings/sessions` by 27.4 KiB, `/settings/notifications`
 * by 23.5, `/settings` and `/account` by 11.1 each, `/settings/profile` by 7.7 — and a
 * navigation bar's labels did not buy 27 KiB.
 *
 * So the boundary stays (it is still the only way to know the path) and the catalogue does
 * not cross it. `AccountArea` reads `account.*` through `getTranslations` on the server and
 * hands down the sixteen strings this file draws; the browser downloads those sixteen strings
 * instead of the machinery to look them up. `components/settings/LanguagePanel.tsx` makes the
 * same trade for the same reason and states it from the panel's side.
 *
 * THE LANDMARK'S NAME IS TRANSLATED TOO, and it is the one string in this file a sighted
 * reader would never have noticed was wrong. `aria-label` is read aloud and nothing else, so a
 * Russian navigation announced as "Account" is a defect only a screen-reader user meets —
 * which is exactly the kind of string a catalogue is for. It arrives as `label`, resolved from
 * `account.nav.label` in all four languages, beside the entries it names.
 */

/** One destination, with the words a reader sees already in their own language. */
export interface AccountNavLink {
  readonly href: string;
  readonly label: string;
}

/** One titled group of destinations. */
export interface AccountNavGroup {
  readonly heading: string;
  readonly links: readonly AccountNavLink[];
}

export interface AccountNavProps {
  /** The landmark's accessible name, already in the reader's language. */
  readonly label: string;
  readonly groups: readonly AccountNavGroup[];
}

export function AccountNav({ label, groups }: AccountNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className={[
        'lg:sticky lg:top-24',
        /*
          THE RAIL SCROLLS ON ITS OWN Y AXIS — #349. `sticky` pins it below the header and
          keeps it there while the page moves, which is the point of it; the consequence,
          until this, was that a rail taller than the viewport had a bottom nobody could
          reach. Scrolling the page moved the content on the right and left the rail exactly
          where it was. Thirteen destinations at 150% zoom, or a laptop at 768px of height,
          is enough for the last group to be unreachable.

          `100dvh` and not `100vh`: the dynamic unit is the one that tracks a collapsing
          browser toolbar, and `vh` here would size the rail to a viewport the reader does
          not have. `8rem` is the `top-24` above it (6rem) plus 2rem so the last entry does
          not sit flush against the bottom edge.

          `overscroll-contain` is the half that makes it independent rather than merely
          scrollable: without it, reaching the end of the rail hands the wheel to the page
          and the reader scrolls the article they were not looking at.
        */
        'lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:overscroll-contain',
        /*
          Room for the focus ring, which a scroll container would otherwise clip. The links
          take `outline-2 outline-offset-2` — four pixels outside their own box — and
          docs/ui-kit.md §9.3 requires that ring to be visible on every interactive element.
          The negative margin gives the padding back, so nothing moves.
        */
        'lg:-mx-1 lg:px-1',
      ].join(' ')}
    >
      {/*
        `-mx-1 px-1`, below the breakpoint only: the same room for the ring on the phone row
        (#177). There the list itself is the scroll container, and without it the first
        link's ring was cut off on the left and the last link's on the right. `pb-2` already
        clears the bottom and the group headings sit above the top. Above the breakpoint the
        list stops scrolling and the rail's own `lg:-mx-1 lg:px-1` takes over, so it resets.

        `onFocus`: a link Tab lands on while it is half off the row's edge is scrolled fully
        into view, which Chromium does not do by itself (#181, `revealFocusedItem` in
        `@ideanest/ui`). Above the breakpoint the same call keeps the focused link inside the
        rail's own vertical scroll.
      */}
      <ul
        className="-mx-1 flex list-none gap-x-6 gap-y-8 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-1"
        onFocus={revealFocusedItem}
      >
        {groups.map((group) => (
          <li key={group.heading} className="min-w-max lg:min-w-0">
            <h2 className="px-3 text-xs font-medium tracking-[0.08em] text-white/40 uppercase">
              {group.heading}
            </h2>
            <ul className="mt-2 flex list-none gap-1 lg:flex-col">
              {group.links.map((link) => {
                const current = isCurrentAccountLink(link.href, pathname);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={current ? 'page' : undefined}
                      className={[
                        'block rounded-lg border-l-2 px-3 py-2 text-[15px] transition-colors duration-150 ease-in-out',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
                        current
                          ? 'border-[var(--lime-500)] bg-surface-2 text-white'
                          : 'border-transparent text-white/64 hover:bg-surface-2 hover:text-white',
                      ].join(' ')}
                    >
                      {link.label}
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
