'use client';

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
 * `usePathname`, to mark the current panel. That is the whole of it: no fetch, no state,
 * no effect. When the second entry lands this is where "which one am I on" is already
 * answered.
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

export function DashboardNav({ projectId, copy }: DashboardNavProps) {
  const pathname = usePathname();
  const panels = panelsFor(projectId, copy);

  return (
    <nav aria-label={copy.label} className="border-b border-white/8">
      <ul className="flex gap-1">
        {panels.map((panel) => {
          const current = pathname === panel.href;
          return (
            <li key={panel.href}>
              <Link
                href={panel.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  // The focus ring is on every item and is never removed: ui-kit §9.3
                  // makes it a build error, and a keyboard user on a nav with no visible
                  // focus has no way to know where they are.
                  'inline-block rounded-t-[10px] px-4 py-3 text-sm font-medium',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]',
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
