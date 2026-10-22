import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ConsoleCountCopy } from '../../lib/i18n/admin/common-copy';

/**
 * How many rows are on screen, said honestly — issue #404.
 *
 * <h2>What the badge used to claim</h2>
 *
 * Five console lists put a number beside their heading, and every one of them printed the
 * length of the loaded page:
 *
 * | Screen | Badge | Actually |
 * |---|---|---|
 * | `/admin/users` | `Accounts 25` | 930 rows |
 * | `/admin/campaigns` | `Campaigns 25` | 33 rows |
 * | `/admin/ledger` | `Postings 20` | more |
 * | `/admin/payments` | `Provider calls 25` | more |
 *
 * `/admin/users` did print "25 accounts shown, and there are more" at the foot of the list,
 * which is honest — but the number beside the heading is where a count gets read, and it
 * reported the page size as though it were the population. An operator who reads
 * "Campaigns 25" has been told the platform has twenty-five campaigns.
 *
 * <h2>Why it says "25+" rather than 33</h2>
 *
 * #404 offers the two repairs — show the real total, or make the badge say it is a page —
 * and this is the second. The first would need a count endpoint on five surfaces, and on the
 * one that matters most it is not available at any price: `AuditTrailPage` refuses to carry
 * a total because counting a table nothing is ever deleted from is a full scan for a number
 * that is stale before it renders. A count that existed on four screens and not the fifth
 * would leave the fifth reading exactly as it does now.
 *
 * <p>So the badge states what the screen actually knows. There are twenty-five rows here,
 * and the cursor says there are more behind them — which is the same fact the "Load more"
 * control below is built on, and the two can no longer disagree.
 *
 * <h2>The plus sign is not the only signal</h2>
 *
 * docs/ui-kit.md §9.2: a mark alone must not carry meaning. The element's accessible name
 * says it in words, so a reader who does not see the glyph — or does not read it as
 * "at least" — is told the same thing.
 */
export interface ConsoleCountProps {
  /** How many rows are loaded right now. */
  readonly loaded: number;
  /**
   * Whether the list has a cursor, meaning there are more rows behind these.
   *
   * <p>Read from the cursor rather than from `loaded === pageSize`: a page that happened to
   * fill exactly is not the end of the list, and the service says which it is.
   */
  readonly more: boolean;
  readonly copy: ConsoleCountCopy;
  readonly className?: string;
}

export function ConsoleCount({ loaded, more, copy, className }: ConsoleCountProps) {
  const template = more ? copy.partial : copy.exact;
  const label = more ? copy.partialLabel : copy.exactLabel;

  return (
    <span
      className={className ?? 'ml-2 text-xs font-normal text-fg-40'}
      aria-label={fillPlaceholders(label, { count: String(loaded) })}
      title={fillPlaceholders(label, { count: String(loaded) })}
    >
      {fillPlaceholders(template, { count: String(loaded) })}
    </span>
  );
}
