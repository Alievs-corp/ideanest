import { Link } from '../../i18n/navigation';
import type { ReactNode } from 'react';
import { MAIN_CONTENT_ID, SkipLink } from './SkipLink';
import { BrandMark } from '../brand/BrandMark';

/**
 * A wordmark, a `<main>`, and one line at the bottom — the frame for the screens that must not
 * pay for the full site header.
 *
 * <h2>Why this exists, with the measurement</h2>
 *
 * `SiteShell` is the right frame for a page inside `app/(site)`, and it is the wrong one for
 * `app/not-found.tsx` and `app/error.tsx`. Those two files sit at the ROOT of the route tree,
 * because Next serves them for a request that matches nothing and for a throw anywhere — and
 * a root file's client components land in the chunk set of **every route in the application**.
 *
 * That was measured rather than assumed. With `SiteShell` in `app/not-found.tsx`, the chunks
 * shared by all routes went from 464.4 KiB to 547.7 KiB: **+83.3 KiB on the checkout, on every
 * editor tab, on the creator dashboard and on the admin console**, none of which render a site
 * header. The cost is not the header's markup; it is that `SiteHeader` reaches
 * `@ideanest/ui`'s root barrel for `TopBar`, `useDismiss` and `useFocusTrap`, and a barrel in
 * a `transpilePackages` source package lands in one shared chunk — the mechanism
 * `packages/ui/src/motion.ts` describes and which cost this application 116 kB once already.
 *
 * §4.13's WS-09 asks for the failure states "inside the shell rather than replacing it", and
 * the point of that requirement is that somebody who mistypes a URL is not dumped on a dead
 * end. This frame keeps that: a wordmark that goes home, and the failure state itself carries
 * links to the feed, the categories and search. What it drops is the collapsing navigation,
 * the account menu and the mobile drawer — chrome that a 404 does not need, in exchange for a
 * checkout that does not carry them.
 *
 * **The full shell is still used where it is already paid for.** `app/(site)/not-found.tsx`
 * and `app/(site)/error.tsx` render the failure state inside `SiteShell` through the group's
 * own layout, so a `notFound()` from a category page keeps the whole header.
 *
 * <h2>The same frame the authentication screens use</h2>
 *
 * `app/(auth)/layout.tsx` wants exactly this and for a related reason — a sign-in page should
 * not offer eleven other things to do. One component, so the two cannot drift into two
 * different ideas of what minimal chrome is.
 *
 * Nothing here imports from `@ideanest/ui` at all, which is the constraint that makes it
 * cheap; anything added to this file must keep that true.
 */

export interface MinimalShellProps {
  readonly children: ReactNode;
  /** The line at the bottom. Omitted where the page has said enough already. */
  readonly footer?: ReactNode;
  /** Centres the content vertically — right for a form, wrong for a long page. */
  readonly centred?: boolean;
  /**
   * "Skip to content", in the reader's language.
   *
   * A PROP RATHER THAN A LOOKUP because this frame is rendered by `app/[locale]/error.tsx`,
   * which Next requires to be a client component — so this module is in a client bundle and
   * cannot reach the server catalogue. Everything else that renders it is a server component
   * and resolves the word before handing it over.
   */
  readonly skipToContent: string;
}

export function MinimalShell({
  children,
  footer,
  centred = false,
  skipToContent,
}: MinimalShellProps) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <SkipLink label={skipToContent} />

      <header className="px-5 pt-7 sm:px-7">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm text-lg font-semibold tracking-[-0.03em] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          <BrandMark />
          IdeyaNest
        </Link>
      </header>

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className={
          centred
            ? 'flex flex-1 items-center justify-center px-5 py-12 focus:outline-none sm:py-16'
            : 'flex-1 focus:outline-none'
        }
      >
        {children}
      </main>

      {footer !== undefined && (
        <footer className="px-5 pb-8 text-center text-sm text-white/40 sm:px-7">{footer}</footer>
      )}
    </div>
  );
}
