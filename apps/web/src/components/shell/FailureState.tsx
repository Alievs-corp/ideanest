import type { ReactNode } from 'react';
import type { FailureCopy } from '../../lib/i18n/shell-copy';
import { Link } from '../../i18n/navigation';

/**
 * What a not-found, an error and a maintenance page have in common — §4.13 WS-09, issue #263.
 *
 * <h2>Three pages, one shape</h2>
 *
 * A short heading that says what happened, a sentence that says what it means, one action
 * that is the way out, and a small set of links so the page is not a dead end. Writing that
 * three times is writing three pages that drift, and the one that drifts is always the one
 * nobody visits on purpose.
 *
 * <h2>The status code is not carried here</h2>
 *
 * Next decides it: `not-found.tsx` is served with a 404, an uncaught render is a 500, and the
 * maintenance route is an ordinary 200 page somebody links to. Nothing in this component may
 * imply otherwise, because a "404" printed on a page served with a 200 is the thing that
 * makes a crawler index an error.
 *
 * <h2>No lime, and no red</h2>
 *
 * §2.4: lime means urgent and `--danger` means something failed destructively. Neither is
 * true of a mistyped URL. A failure state that shouts is a failure state that makes an
 * ordinary mistake feel like a broken platform, and docs/ui-kit.md §9.2 forbids colour from
 * carrying the meaning in any case — the heading does.
 *
 * <h2>Motion: none</h2>
 *
 * Not because a budget forbids it but because there is nothing to reveal. An error that
 * fades in is an error that arrives after it was needed, which §5's authentication row says
 * about a wrong-password message and which is true here too.
 */

export interface FailureStateProps {
  /** What happened, in a sentence a person would say. Never a status code. */
  readonly title: string;
  readonly description: ReactNode;
  /** The way out. One control, and it is the most likely next step. */
  readonly action: ReactNode;
  /** A short list of places to go instead. Omitted on the maintenance page. */
  readonly showLinks?: boolean;
  /**
   * The three words this component owns, resolved by the page that renders it. A failure page
   * offers a deliberately shorter list than the footer does, which is why the routes are
   * written here rather than taken from `FOOTER_GROUPS`.
   */
  readonly copy: FailureCopy;
}

export function FailureState({
  title,
  description,
  action,
  showLinks = true,
  copy,
}: FailureStateProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col items-center px-5 py-24 text-center sm:px-6 sm:py-32">
      <h1 className="max-w-[20ch] text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-4xl">
        {title}
      </h1>
      <div className="mt-4 max-w-[56ch] text-fg-64">{description}</div>

      <div className="mt-9">{action}</div>

      {showLinks && (
        <nav aria-label={copy.elsewhere} className="mt-12">
          <ul className="flex list-none flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm">
            {[
              { href: '/discover', label: copy.links.browse },
              { href: '/categories', label: copy.links.categories },
              { href: '/search', label: copy.links.search },
            ].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-sm text-fg-64 transition-colors duration-150 ease-in-out hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

/** The white pill every one of these pages uses for its way out. A link, never a button. */
export function FailureAction({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center rounded-full bg-inverse px-6 text-base font-medium text-on-inverse transition-colors duration-150 ease-in-out hover:bg-inverse-muted"
    >
      {children}
    </Link>
  );
}
