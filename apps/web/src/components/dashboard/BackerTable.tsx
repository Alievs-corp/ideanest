'use client';

import { EyeOff } from 'lucide-react';
import { formatExactTime } from '../../lib/time';
import { formatMoney } from '../../lib/money';
import type { Backer } from '@ideanest/dashboard/backers';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { regionNames } from '../../lib/i18n/formats';
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
  /** The six column headings, the anonymity note and the two pledge states — #79. */
  readonly copy: BackerTableCopy;
}

export function BackerTable({ backers, label, copy }: BackerTableProps) {
  const locale = useRouteLocale();
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="mt-6 overflow-x-auto rounded-[14px] border border-fg/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
    >
      {/*
        Below `sm` each row lays out as a card: a 720px table on a phone is a table read through
        a keyhole. The explicit roles keep it a table for a screen reader whichever display the
        rows have, since a table whose rows are not `display: table-row` loses them in Chrome.
      */}
      <table role="table" className="w-full border-collapse text-sm max-sm:block sm:min-w-[720px]">
        <caption className="sr-only">{label}</caption>
        <thead role="rowgroup" className="max-sm:sr-only">
          <tr role="row" className="border-b border-fg/8 text-left text-fg-64">
            <th scope="col" role="columnheader" className="px-4 py-3 font-medium">
              {copy.backer}
            </th>
            <th scope="col" role="columnheader" className="px-4 py-3 font-medium">
              {copy.reward}
            </th>
            <th scope="col" role="columnheader" className="px-4 py-3 text-right font-medium">
              {copy.pledged}
            </th>
            <th scope="col" role="columnheader" className="px-4 py-3 font-medium">
              {copy.state}
            </th>
            <th scope="col" role="columnheader" className="px-4 py-3 font-medium">
              {copy.destination}
            </th>
            <th scope="col" role="columnheader" className="px-4 py-3 font-medium">
              {copy.backed}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-sm:block">
          {backers.map((backer) => (
            <tr
              key={backer.pledgeId}
              role="row"
              className="border-b border-fg/6 last:border-0 hover:bg-surface-3 max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-1.5 max-sm:p-4"
            >
              <th scope="row" role="rowheader" className="px-4 py-3 text-left font-normal max-sm:col-span-2 max-sm:p-0">
                <span className="block text-fg">{backer.name}</span>
                <span className="block text-fg-64">{backer.email}</span>
                {backer.anonymous ? (
                  <span className="mt-1 inline-flex items-center gap-1 text-fg-64">
                    <EyeOff className="size-3.5" aria-hidden />
                    {copy.anonymous}
                  </span>
                ) : null}
              </th>
              <td role="cell" className="px-4 py-3 text-fg-64 max-sm:col-span-2 max-sm:p-0">
                {/* A pledge that took no reward is §4.5's PL-02 — support, which is a
                    thing a backer chose and not a blank cell. */}
                {backer.rewardTitle ??
                  (backer.rewardTierId === undefined ? copy.noReward : copy.removedTier)}
              </td>
              <td role="cell" className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-fg max-sm:p-0 max-sm:text-left max-sm:font-medium">
                {formatMoney(backer.amount)}
              </td>
              <td role="cell" className="px-4 py-3 text-fg-64 max-sm:p-0 max-sm:text-right">
                {copy.states[backer.state]}
              </td>
              <td role="cell" className="px-4 py-3 text-fg-64 max-sm:p-0">
                {backer.country == null ? '—' : (regionNames(locale)?.of(backer.country) ?? backer.country)}
              </td>
              <td role="cell" className="px-4 py-3 text-fg-64 max-sm:p-0 max-sm:text-right">
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
 * two words: the wire constant is `COLLECTED`, what a creator needs to read is "Collected" in
 * their own language, and a second spelling of that beside the first is how a filter stops
 * looking like it selects what this column says. Not prettified generically, then or now — "collected" and
 * "fulfilled" are different facts about money, and upper-casing a first letter would make
 * them look like the same kind of thing.
 */
