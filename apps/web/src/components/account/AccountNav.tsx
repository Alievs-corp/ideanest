'use client';

import { Link } from '../../i18n/navigation';
import { usePathname } from '../../i18n/navigation';
import { revealFocusedItem } from '@ideanest/ui/reveal-focused-item';
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
 * <h2>The rail scrolls on its own axis</h2>
 *
 * On a wide viewport the rail is sticky, so a rail taller than the screen used to have a
 * bottom nobody could reach: the page scrolled, the content on the right moved, and the rail
 * stayed pinned with its last group below the fold. It is its own scroll container since
 * #349, with `overscroll-contain` so reaching its end does not hand the wheel to the page.
 * The class list below argues each part, including the padding that keeps the focus ring from
 * being clipped by the container that fixed the first problem.
 *
 * <h2>Two layouts, one list — the rail and the drawer</h2>
 *
 * Below `xl` this used to be one horizontally scrolling row above the content. A phone showed
 * the first group and the edge of the second, nothing said there were more, and a tablet kept
 * a row it could not put away. It now matches the admin console: the rail is `hidden` below
 * `xl`, and `AccountNavDrawer` draws the same entries as a vertical list behind a menu button
 * above the content. `layout` is the only difference, so the two cannot disagree about what
 * exists or which entry is current.
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
  /** The landmark's name, from `account.nav.label`. */
  readonly label: string;
  readonly groups: readonly AccountNavGroup[];
  /** `rail` beside the content at `xl` and nothing below it; `drawer` inside `AccountNavDrawer`. */
  readonly layout?: 'rail' | 'drawer';
}

export function AccountNav({ label, groups, layout = 'rail' }: AccountNavProps) {
  const pathname = usePathname();

  if (layout === 'drawer') {
    return (
      <nav aria-label={label}>
        <ul className="flex list-none flex-col gap-6">
          {groups.map((group) => (
            <li key={group.heading}>
              <h2 className="px-3 text-[11px] font-medium tracking-[0.08em] text-fg-40 uppercase">
                {group.heading}
              </h2>
              <ul className="mt-1.5 flex list-none flex-col gap-0.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <NavLink link={link} current={isCurrentAccountLink(link.href, pathname)} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav
      aria-label={label}
      className={[
        /* Nothing below `xl`: the menu button above the content reaches the same entries. */
        'hidden xl:sticky xl:top-24 xl:block',
        /*
          THE RAIL SCROLLS ON ITS OWN Y AXIS — #349. `sticky` pins it below the header and
          keeps it there while the page moves; without its own scroll a rail taller than the
          viewport had a bottom nobody could reach. `100dvh` tracks a collapsing browser
          toolbar, and `8rem` is the `top-24` above it plus 2rem. `overscroll-contain` keeps
          the end of the rail from handing the wheel to the page.
        */
        'xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto xl:overscroll-contain',
        /*
          Room for the focus ring, which the scroll container would otherwise clip
          (docs/ui-kit.md §9.3). The negative margin gives the padding back, so nothing moves.
        */
        'xl:-mx-1 xl:px-1',
      ].join(' ')}
    >
      {/*
        `onFocus`: a link Tab lands on near the rail's bottom edge is scrolled fully into view
        inside the rail's own scroll (#181, `revealFocusedItem` in `@ideanest/ui`).
      */}
      <ul className="flex list-none flex-col gap-8 pb-1" onFocus={revealFocusedItem}>
        {groups.map((group) => (
          <li key={group.heading}>
            <h2 className="px-3 text-xs font-medium tracking-[0.08em] text-fg-40 uppercase">
              {group.heading}
            </h2>
            <ul className="mt-2 flex list-none flex-col gap-1">
              {group.links.map((link) => (
                <li key={link.href}>
                  <NavLink link={link} current={isCurrentAccountLink(link.href, pathname)} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One entry. The current one is white on `--surface-2` with a lime rule down its leading edge. */
function NavLink({ link, current }: { readonly link: AccountNavLink; readonly current: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={current ? 'page' : undefined}
      className={[
        'block rounded-lg border-l-2 px-3 py-2 text-[15px] transition-colors duration-150 ease-in-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        current
          ? 'border-[var(--lime-ink)] bg-surface-2 text-fg'
          : 'border-transparent text-fg-64 hover:bg-surface-2 hover:text-fg',
      ].join(' ')}
    >
      {link.label}
    </Link>
  );
}
