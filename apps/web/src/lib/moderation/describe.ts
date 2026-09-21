import type { Locale } from '../i18n/locale';
import type { ModerationCopy } from '../i18n/admin/content-copy';
import { fillPlaceholders } from '../i18n/placeholders';
import { pluralise } from '../i18n/plurals';
import { formatRelativeTime as baseRelativeTime } from '../time';
import type { QueuedReport, ReportState, ReportTargetType } from './api';

/**
 * Turning a queue row into words.
 *
 * Everything here is pure and takes `now` as a parameter rather than reading the
 * clock, so the tests do not have to freeze time and every card on one render
 * measures its age from the same instant.
 */

/*
 * `REASON_LABELS` WAS HERE, AND #85 DELETED IT RATHER THAN TRANSLATING IT.
 *
 * It was the nine reasons in English, kept because the public report dialog was not part of
 * the console and was not translated with it — and `lib/i18n/wording.test.ts` asserted that
 * it said exactly what `admin.moderation.reason` says, so the two could not drift while the
 * duplication lasted. Translating the dialog is what ended it: both surfaces read the
 * catalogue now, there is one table of nine, and the test that held the copy still went with
 * the copy. `lib/i18n/report-copy.ts` carries the reasoning.
 */

/**
 * Enough of an identifier to tell two cards apart, said aloud without pain.
 *
 * The queue carries a target id and nothing else — no title, no slug, no URL —
 * so the identifier is the only name a card has. Eight characters is what git
 * settled on for the same problem.
 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * How long a complaint may sit before the queue calls it urgent.
 *
 * THE SERVICE HAS NO SLA — there is no field on a report that says when it
 * should have been answered, so this threshold is the client's and it is stated
 * here rather than buried in a comparison. Forty-eight hours is deliberate reuse
 * of the one duration the design system already treats as urgent
 * (docs/ui-kit.md §8.1, "closing within 48 hours"), so lime keeps one meaning
 * across the product instead of two.
 */
export const OVERDUE_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * Urgent, in the sense lime is allowed to mean.
 *
 * Only an OPEN report can be overdue. A decision taken last March is not late;
 * it is finished.
 */
export function isOverdue(report: QueuedReport, now: Date): boolean {
  if (report.state !== 'OPEN') return false;

  const created = new Date(report.createdAt).getTime();
  if (Number.isNaN(created)) return false;

  return now.getTime() - created >= OVERDUE_AFTER_MS;
}

/**
 * More than one open complaint about the same target.
 *
 * The service's own words: one report about a campaign and fourteen are
 * different situations, and the second is the one that gets looked at first.
 */
export function isRepeated(report: QueuedReport): boolean {
  return report.openReportsOnTarget > 1;
}

/**
 * "1 open report on this campaign", in the reader's language.
 *
 * <h2>Why this takes a locale where it used to take nothing</h2>
 *
 * It used to pick between "report" and "reports" with a ternary, which is the whole of
 * English plurals and none of Russian's — 1 zhaloba, 2 zhaloby, 5 zhalob. `pluralise` carries
 * the CLDR rules, and `lib/i18n/plurals.ts` records why a count like this one is resolved in
 * the browser rather than as ICU on the server.
 *
 * <p>The target arrives as a whole phrase from the catalogue rather than as a noun this
 * function puts "on this" in front of. Russian agrees the demonstrative with the noun's
 * gender, and one shared "on this" cannot express that. Falls back to the bare noun for a
 * target kind the catalogue has not been taught, which reads awkwardly and still says which
 * kind it is.
 */
export function openReportsLabel(
  report: QueuedReport,
  copy: ModerationCopy,
  locale: Locale,
): string {
  const phrase = copy.targetOnThis[report.target.type] ?? copy.target[report.target.type] ?? '';

  return fillPlaceholders(pluralise(locale, copy.openReports, report.openReportsOnTarget), {
    phrase,
  });
}

/* -------------------------------------------------------------------------
 * Filters
 * ---------------------------------------------------------------------- */

export type TargetFilter = 'ALL' | ReportTargetType;

/**
 * What a triager narrows the queue by.
 *
 * `state` AND `target` ARE SERVER FILTERS; the other two are not. The endpoint takes
 * `state`, `target`, `after` and `limit`, so those two change what is asked for and reset
 * the cursor, and the remaining two narrow what is already loaded — which the screen says
 * out loud rather than letting a count quietly mean something different from what it looks
 * like.
 *
 * <p><strong>`target` moved across that line with #298</strong>, and it had to. It used to
 * be a client-side narrowing like the other two, which was correct for a chip on a queue
 * somebody is skimming and wrong for AD-09's profile screen: a page of twenty-five reports
 * containing two profile reports is not a page of two, and the cursor the client is left
 * holding has already moved past the twenty-three it dropped. Once the service could
 * narrow, keeping a second implementation here would have been two answers to one question.
 */
export interface QueueFilters {
  readonly state: ReportState;
  readonly target: TargetFilter;
  /** Open longer than {@link OVERDUE_AFTER_MS}. */
  readonly overdueOnly: boolean;
  /** More than one open complaint about the same target. */
  readonly repeatedOnly: boolean;
}

export const DEFAULT_FILTERS: QueueFilters = {
  state: 'OPEN',
  target: 'ALL',
  overdueOnly: false,
  repeatedOnly: false,
};

/**
 * Whether anything is being hidden from what was loaded — what the "showing x of y" line is
 * for.
 *
 * <p><strong>`target` is deliberately not counted here any more.</strong> It is a server
 * filter since #298, so a queue narrowed to accounts is not showing three of twenty-five: it
 * asked for accounts and was given accounts, and every page of them is reachable. Counting
 * it would put a "showing 3 of 3" line under a complete list.
 */
export function isRefined(filters: QueueFilters): boolean {
  return filters.overdueOnly || filters.repeatedOnly;
}

/**
 * Applies the two client-side narrowings, in the order they are cheapest.
 *
 * <p>Both are triage rather than selection — "which of these has waited too long", "which of
 * these has been reported by more than one person" — and both are answerable from a report
 * the client already holds. `target` and `state` are not here: they change which reports the
 * service is asked for. See {@link QueueFilters}.
 */
export function refine(
  reports: readonly QueuedReport[],
  filters: QueueFilters,
  now: Date,
): QueuedReport[] {
  return reports.filter((report) => {
    if (filters.repeatedOnly && !isRepeated(report)) return false;
    if (filters.overdueOnly && !isOverdue(report, now)) return false;
    return true;
  });
}

/** The value the endpoint's `target` parameter takes, or null for every kind. */
export function targetParameter(filter: TargetFilter): ReportTargetType | null {
  return filter === 'ALL' ? null : filter;
}

/* -------------------------------------------------------------------------
 * Time
 * ---------------------------------------------------------------------- */

/**
 * "3 hours ago", "yesterday", "just now" — the same two functions `lib/time.ts` exports,
 * re-exported here.
 *
 * <h2>THEY WERE A SECOND COPY, AND #324 IS WHERE THE COPY STOPPED PAYING</h2>
 *
 * This module held its own `Intl.RelativeTimeFormat`, its own division table and its own
 * `en-GB` timestamp formatter, all identical to `lib/time.ts`'s. Two copies of a formatter
 * pinned to one language cost nothing; two copies that each have to be threaded a locale,
 * cached per language and tested in four is a duplication with a price. So this delegates,
 * and the one thing that genuinely differed is kept below.
 */
export { formatExactTime } from '../time';

/**
 * `lib/time.ts`'s relative time, with this module's own answer for an instant that will not
 * parse.
 *
 * "an unknown time ago" rather than "Unknown", because every string this returns is read
 * inside a sentence — "Reported 3 hours ago" — and a moderation queue that read "Reported
 * Unknown" would look like a rendering bug rather than like a report whose timestamp is
 * broken. It is the one difference between the two modules and it is the reason this is a
 * wrapper rather than a re-export.
 */
export function formatRelativeTime(iso: string, now: Date, locale: Locale): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return UNREADABLE_INSTANT[locale];

  return baseRelativeTime(iso, now, locale);
}

/** "an unknown time ago", in each of §21.1's four. */
const UNREADABLE_INSTANT: Readonly<Record<Locale, string>> = {
  az: 'naməlum vaxt öncə',
  en: 'an unknown time ago',
  ru: 'неизвестно когда',
  tr: 'bilinmeyen bir zaman önce',
};

/**
 * A campaign state as a sentence fragment: `CHANGES_REQUESTED` → "changes
 * requested".
 *
 * Derived rather than tabulated, because the sixteen states are the service's
 * and a table here would be a copy to fall out of step with — the same reason
 * `lib/projects/api.ts` keeps no client-side transition table.
 */
export function humaniseState(state: string): string {
  return state.toLowerCase().replace(/_/g, ' ');
}
