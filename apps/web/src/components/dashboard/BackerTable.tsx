'use client';

import { EyeOff } from 'lucide-react';
import { formatExactTime } from '../../lib/time';
import { formatMoney } from '../../lib/money';
import type { Backer } from '../../lib/dashboard/backers';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { BackerTableCopy } from '../../lib/i18n/dashboard-copy';

/**
 * §4.7's CD-10 as a table: who backed the campaign, and what each of them took.
 *
 * <h2>The rules this table follows are docs/ui-kit.md §7.15's, and each costs something</h2>
 *
 * <ul>
 *   <li><strong>No zebra striping.</strong> Surface colour encodes state in this system,
 *       not rhythm. Alternating fills would spend the only signal there is on decoration,
 *       and a row that genuinely needed highlighting would look like every other odd row.
 *       Rows are separated by a divider and hover to `--surface-3`.
 *   <li><strong>Money is a pre-formatted string</strong>, right-aligned and
 *       `tabular-nums`. `formatMoney` works from the decimal string the API sent; a cell
 *       that formatted a number would be a cell that rounded somebody's pledge.
 *   <li><strong>The table scrolls inside a named, focusable region.</strong>
 *       `overflow-x: auto` alone is a pointer-only affordance — on a narrow screen the
 *       right-hand columns become unreachable by keyboard. The container takes
 *       `tabindex={0}` and a name, and the name is what makes the extra tab stop
 *       explicable.
 * </ul>
 *
 * <h2>Anonymity is shown, not obeyed</h2>
 *
 * §4.5's PL-12 keeps an anonymous backer off the public page. It was never a promise that
 * the creator would have to address a parcel to a number, so the name is here and the flag
 * beside it says what it means. The icon carries it as well as the words, because colour
 * and italics alone are not a signal (ui-kit §9.2).
 */

export interface BackerTableProps {
  readonly backers: readonly Backer[];
  /** Names the scroll region, so the tab stop it introduces is explained. */
  readonly label: string;
  /** The six column headings, the anonymity note and the five pledge states — #79. */
  readonly copy: BackerTableCopy;
}

export function BackerTable({ backers, label, copy }: BackerTableProps) {
  const locale = useRouteLocale();
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="mt-6 overflow-x-auto rounded-[14px] border border-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--lime-500]"
    >
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-white/8 text-left text-white/64">
            <th scope="col" className="px-4 py-3 font-medium">
              {copy.backer}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {copy.reward}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {copy.pledged}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {copy.state}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {copy.destination}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {copy.backed}
            </th>
          </tr>
        </thead>
        <tbody>
          {backers.map((backer) => (
            <tr key={backer.pledgeId} className="border-b border-white/6 last:border-0 hover:bg-[--surface-3]">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <span className="block text-white">{backer.name}</span>
                <span className="block text-white/64">{backer.email}</span>
                {backer.anonymous ? (
                  <span className="mt-1 inline-flex items-center gap-1 text-white/64">
                    <EyeOff className="size-3.5" aria-hidden />
                    {copy.anonymous}
                  </span>
                ) : null}
              </th>
              <td className="px-4 py-3 text-white/64">
                {/* A pledge that took no reward is §4.5's PL-02 — support, which is a
                    thing a backer chose and not a blank cell. */}
                {backer.rewardTitle ??
                  (backer.rewardTierId === undefined ? copy.noReward : copy.removedTier)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-white">{formatMoney(backer.amount)}</td>
              <td className="px-4 py-3 text-white/64">{copy.states[backer.state]}</td>
              <td className="px-4 py-3 text-white/64">{backer.country ?? '—'}</td>
              <td className="px-4 py-3 text-white/64">
                <time dateTime={backer.backedAt}>{formatExactTime(backer.backedAt, locale)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/*
 * A pledge state in words a creator uses used to be a `switch` here, in English — #79.
 *
 * It is `dashboard.states` in the catalogue now, and the report's filter chips read the same
 * five words: the wire constant is `CHARGE_FAILED`, what a creator needs to read is "Payment
 * failed", and a second spelling of that beside the first is how a filter stops looking like
 * it selects what this column says. Not prettified generically, then or now — "collected" and
 * "fulfilled" are different facts about money, and upper-casing a first letter would make
 * them look like the same kind of thing.
 */
