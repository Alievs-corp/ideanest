'use client';

import Decimal from 'decimal.js';
import { formatMoney } from '../../lib/money';
import type { Money } from '../../lib/money';
import type { Locale } from '../../lib/i18n/locale';
import { pluralise, type PluralForms } from '../../lib/i18n/plurals';

/**
 * A magnitude-by-identity chart: one horizontal bar per thing, longest first.
 *
 * <h2>Why bars, and why horizontal</h2>
 *
 * The question both of these answer — which tier sold, where the backers are — is
 * *magnitude compared across a handful of named things*, which is the one job a bar chart
 * does better than anything else. A pie was the obvious alternative and is worse for the
 * same reason it always is: comparing angles is harder than comparing lengths, and the
 * labels have nowhere to go. Horizontal because the labels are words of unpredictable
 * length — "An early copy, signed" does not fit under a vertical bar at any width a
 * dashboard has.
 *
 * <h2>It is a table, and that is not a compromise</h2>
 *
 * Every row carries its own label and its own value as text, so the chart and the data
 * behind it are one thing rather than a picture with a table hidden underneath it. Nothing
 * here is encoded in colour alone (ui-kit §9.2): the bar is redundant with the number
 * beside it, which is what makes the whole thing legible to a screen reader, in forced
 * colours, and in a printout.
 *
 * <h2>One colour</h2>
 *
 * A single series does not need a palette, and this system has no data-visualisation ramp
 * to take one from. White is the accent for a neutral quantity here — lime would say
 * "urgent" and `--success` would say "the goal was reached", and a tier selling well is
 * neither. `--surface-3` is the track behind it.
 *
 * <h2>No entry animation</h2>
 *
 * docs/motion-system.md §5 allows the dashboard a chart draw-in and this spends none of
 * it: the widths come from data that is already on screen, and a bar that grows on mount
 * delays the only thing a creator opened the panel to read.
 */

export interface ShareBar {
  /** What it is. Rendered as text, not as a colour. */
  readonly label: string;
  readonly backerCount: number;
  readonly amount: Money;
}

export interface ShareBarsProps {
  readonly rows: readonly ShareBar[];
  /** Names the list for a screen reader — "Backers by reward tier". */
  readonly label: string;
  /**
   * The counted half of each row, carrying `{count}` — #79.
   *
   * A plural rather than a ternary on `=== 1`: Russian picks between three forms of "backer"
   * by the last digit, so a singular/plural split is wrong for most numbers in one of the
   * four languages and there is nothing on screen to say so.
   */
  readonly backers: PluralForms;
  /** Which language to select that form in. The count arrives with the fetch, not the render. */
  readonly locale: Locale;
}

export function ShareBars({ rows, label, backers, locale }: ShareBarsProps) {
  const largest = widestOf(rows);

  return (
    <ul aria-label={label} className="mt-4 space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="text-white">{row.label}</span>
            <span className="tabular-nums text-white/64">
              {pluralise(locale, backers, row.backerCount)} ·{' '}
              <span className="text-white">{formatMoney(row.amount)}</span>
            </span>
          </div>
          {/*
            aria-hidden, and deliberately: the two numbers above are the accessible
            statement of this row, and a second reading of the same fact as a progress
            bar would make every row announce itself twice.
          */}
          <div aria-hidden className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[--surface-3]">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${share(row.amount, largest)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The widest bar's amount.
 *
 * The bars are scaled against the largest row rather than against the campaign's total,
 * because the question is "which of these is bigger" and scaling to a total makes every bar
 * short on a campaign with many tiers. The share of the whole is available from the numbers,
 * which are all present.
 */
function widestOf(rows: readonly ShareBar[]): Decimal {
  return rows.reduce((widest, row) => Decimal.max(widest, amountOf(row.amount)), new Decimal(0));
}

/**
 * A width, as a whole percentage of the widest bar.
 *
 * <p><strong>The arithmetic is `decimal.js`, and only the finished percentage becomes a
 * number.</strong> CLAUDE.md forbids floating point for money and `lib/money.ts` keeps
 * `Number()` out of the module entirely, because a string that has been through it can
 * never be trusted again. The rule is kept here: the amounts are parsed exactly, the ratio
 * is computed exactly, and what crosses into a float is a length between 2 and 100 that is
 * about to be rounded to a pixel anyway. No figure a creator reads passes through this.
 *
 * <p>The floor of two percent is so that a tier that sold one small reward is a visible
 * mark rather than nothing — a bar of zero width and a missing row look the same.
 */
function share(amount: Money, largest: Decimal): number {
  if (largest.lessThanOrEqualTo(0)) return 0;
  return Math.max(2, Math.round(amountOf(amount).div(largest).times(100).toNumber()));
}

/** The amount as an exact decimal. A malformed one is nothing rather than a broken layout. */
function amountOf(amount: Money): Decimal {
  try {
    return new Decimal(amount.amount);
  } catch {
    return new Decimal(0);
  }
}
