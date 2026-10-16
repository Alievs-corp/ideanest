'use client';

import { useState } from 'react';
import { InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import {
  readReconciliation,
  runReconciliation,
  type FindingKind,
  type ReconciliationFinding,
  type ReconciliationReport,
} from '../../lib/admin/reconciliation';
import { accountLabel, creatorIdsIn } from '../../lib/admin/ledger';
import type { DirectoryNames } from '../../lib/admin/directory';
import { formatMoney } from '../../lib/money';
import { consoleMessageFor, statusFor } from '../../lib/admin/refusals';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatExactTime } from '../../lib/time';
import type { Locale } from '../../lib/i18n/locale';
import type { ReconciliationCopy } from '../../lib/i18n/admin/money-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';
import { useDirectoryNames } from './useDirectoryNames';

/**
 * §4.11's AD-05: do the platform's books add up? — issue #106.
 *
 * <h2>Three things this screen must never do</h2>
 *
 * <strong>It must not present "never run" as "balanced".</strong> A reconciliation that
 * silently stopped produces an empty finding list, which is exactly what a healthy platform
 * produces. The service answers `hasRun`, and the panel leads with it: a platform nobody has
 * checked is a finding of its own, and it is the one somebody is least likely to notice.
 *
 * <p><strong>It must not say "balanced" in green and leave it at that.</strong> CLAUDE.md
 * §2 — colour alone never carries meaning, and a screen whose entire content is a status is
 * where that rule is most expensive to break. Every state here is a sentence first.
 *
 * <p><strong>It must not offer to fix anything.</strong> `LedgerReconciliation` reports and
 * never repairs, because the correcting entry depends on which of a dozen things went wrong
 * and a job that guessed would turn a detectable problem into an undetectable one. There is
 * therefore no "resolve" control on this screen, and the absence is the design.
 *
 * <h2>The success colour is `--success`, and it is never lime</h2>
 *
 * CLAUDE.md §2: lime means "act now", not "this went well". Books that balance are the
 * opposite of an outstanding task, and lime here would tell a member of finance the reverse
 * of the truth on the one screen where that matters most. `InlineAlert`'s variants carry the
 * icon that goes with each, so the state reads without the colour at all.
 *
 * <h2>Motion: none</h2>
 *
 * `docs/motion-system.md` §5 gives the console no entry animation. Nothing here fades in,
 * and "Check again" swaps a label rather than animating.
 */
export interface ReconciliationPanelProps {
  readonly copy: ReconciliationCopy;
}

export function ReconciliationPanel({ copy }: ReconciliationPanelProps) {
  const locale = useRouteLocale();
  const report = useConsoleResource<ReconciliationReport>(
    (signal) => readReconciliation(signal),
    copy.subject,
    copy.refusals,
    [],
  );

  /*
   * The run is held apart from `useConsoleResource` on purpose. That hook owns reads and
   * says so — "it does not own mutations… the interesting part of a write is always the
   * part that is specific to it" — and the specific part here is that a failed run must not
   * blank the report already on screen. Somebody looking at three findings and pressing
   * Check again should still be looking at three findings if the network drops.
   */
  const [running, setRunning] = useState(false);
  const [runFailure, setRunFailure] = useState<string | null>(null);

  /*
   * The creators a finding names, so a creator's account reads as the person, the way the
   * ledger names it, rather than as "Creator 0199a777".
   */
  const names = useDirectoryNames(
    creatorIdsIn(
      (report.data?.findings ?? []).flatMap((finding) => (finding.account == null ? [] : [finding.account])),
    ),
    [],
  );

  async function check(): Promise<void> {
    if (running) return;
    setRunning(true);
    setRunFailure(null);
    try {
      report.set(await runReconciliation());
    } catch (cause) {
      // Three different answers. A 401 is a session that expired, fixed by signing in; telling
      // that reader their permission was taken away sends them to an administrator for nothing.
      const status = statusFor(cause);
      setRunFailure(
        status === 'failed'
          ? consoleMessageFor(cause, copy.subject, copy.refusals)
          : status === 'signed-out'
            ? copy.runSignedOut
            : copy.runForbidden,
      );
    } finally {
      setRunning(false);
    }
  }

  if (report.status === 'signed-out' || report.status === 'forbidden') {
    return <ConsoleRefusal status={report.status} capability={report.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  if (report.status === 'loading' && report.data === null) {
    return (
      <SkeletonGroup label={copy.loadingList}>
        <div className="rounded-lg border border-white/8 bg-surface-1 p-4">
          <Skeleton height="1rem" width="40%" />
          <Skeleton height="0.875rem" width="65%" className="mt-3" />
        </div>
      </SkeletonGroup>
    );
  }

  if (report.data === null) {
    return (
      <>
        <InlineAlert variant="danger" title={copy.errorTitle}>
          {report.error ?? copy.readFailed}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={report.reload}>
          {copy.tryAgain}
        </Pill>
      </>
    );
  }

  const found = report.data;

  return (
    <div className="flex flex-col gap-6">
      <Summary report={found} copy={copy} locale={locale} />

      {runFailure !== null && (
        <InlineAlert variant="danger" title={copy.runFailedTitle}>
          {runFailure}
        </InlineAlert>
      )}

      {found.findings.length > 0 && (
        <section aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
            {copy.findingsHeading}
          </h2>
          {groupByKind(found.findings).map(([kind, findings]) => (
            <section key={kind} className="mt-4">
              {/*
                The meaning is printed once above its findings rather than under each of them.
                It is context for the check — "a balance below zero is money the platform paid
                out and never took" — and four findings of one kind printed it four times,
                which is a paragraph the reader learns to skip past the rows that matter.
              */}
              <p className="max-w-[68ch] text-xs text-white/48">{copy.findingMeaning[kind]}</p>
              <ul className="mt-2 flex list-none flex-col gap-3">
                {findings.map((finding, index) => (
                  <FindingCard
                    key={`${finding.code}:${finding.currency}:${index}`}
                    finding={finding}
                    names={names}
                    copy={copy}
                  />
                ))}
              </ul>
            </section>
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Pill variant="ghost" size="sm" onClick={() => void check()} disabled={running}>
          {running ? copy.checking : copy.checkAgain}
        </Pill>
        <p className="text-xs text-white/48">{copy.runNote}</p>
      </div>
    </div>
  );
}

/**
 * The headline, which is one of four states rather than two.
 *
 * <p>"Never run" and "balanced" are the pair that must not be collapsed; "checked but the
 * platform holds nothing" is worth its own sentence because a brand-new deployment reporting
 * zero positions is correct rather than broken.
 */
function Summary({
  report,
  copy,
  locale,
}: {
  readonly report: ReconciliationReport;
  readonly copy: ReconciliationCopy;
  readonly locale: Locale;
}) {
  if (!report.hasRun) {
    return (
      <InlineAlert variant="warning" title={copy.neverRunTitle}>
        {copy.neverRunBody}
      </InlineAlert>
    );
  }

  // #403: this was `new Date(runAt).toISOString()` — `2026-09-02T06:50:26.291Z`, to the
  // millisecond and in UTC, inside a sentence otherwise written for a person.
  const when = formatExactTime(report.runAt as string, locale);
  const positions = pluralise(locale, copy.positionCount, report.accountsChecked);

  if (!report.balanced) {
    return (
      <InlineAlert variant="danger" title={copy.unbalancedTitle}>
        {/*
          The emphasis is a node in a template rather than a `<strong>` inside a message.
          `catalogue.test.ts` checks that rich-text tags match across the four languages
          precisely because a dropped one is silent, and not carrying the tag at all is a
          better answer than checking for it.
        */}
        {fillNodes(copy.unbalancedBody, {
          findings: pluralise(locale, copy.findingCount, report.findings.length),
          positions,
          at: when,
          note: fillNodes(copy.unbalancedNote, {
            emphasis: <strong>{copy.unbalancedEmphasis}</strong>,
          }),
        })}
      </InlineAlert>
    );
  }

  return (
    <InlineAlert variant="success" title={copy.balancedTitle}>
      {fillPlaceholders(copy.balancedBody, { positions, at: when })}
      {report.accountsChecked === 0 && ` ${copy.nothingHeld}`}
    </InlineAlert>
  );
}

/**
 * The findings of one kind, in the order the checks produced them.
 *
 * <p>Grouped rather than sorted, so a kind that produced four findings keeps them together and
 * the sentence explaining what that kind means can be printed once above them.
 */
function groupByKind(
  findings: readonly ReconciliationFinding[],
): ReadonlyArray<readonly [FindingKind, readonly ReconciliationFinding[]]> {
  const grouped = new Map<FindingKind, ReconciliationFinding[]>();
  for (const finding of findings) {
    const held = grouped.get(finding.kind);
    if (held === undefined) grouped.set(finding.kind, [finding]);
    else held.push(finding);
  }
  return [...grouped.entries()];
}

/**
 * What one finding says, in the reader's language — issue #403.
 *
 * <p>The service sends its own sentence in `detail` and this does not render it: it is
 * English prose with `creator:07afbabf-fec4-505f-7a75-69eca0979182` and `1103.59` in it, and
 * it was the only text on this screen that stayed English in all four languages. The parts
 * travel beside it now, so the account is named the way the ledger names it and the money is
 * formatted the way every other figure on the platform is.
 *
 * <p>A code this catalogue has no sentence for falls back to the service's, which is worse to
 * read and better than blank.
 */
function describe(
  finding: ReconciliationFinding,
  names: DirectoryNames,
  copy: ReconciliationCopy,
): string {
  const sentence = copy.finding[finding.code];
  if (sentence === undefined) return finding.detail;

  return fillPlaceholders(sentence, {
    account: finding.account == null ? '' : accountLabel(finding.account, copy.money, names),
    amount: formatMoney({ amount: finding.amount, currency: finding.currency }),
    other:
      finding.otherAmount == null
        ? ''
        : formatMoney({ amount: finding.otherAmount, currency: finding.currency }),
    currency: finding.currency,
  });
}

function FindingCard({
  finding,
  names,
  copy,
}: {
  readonly finding: ReconciliationFinding;
  readonly names: DirectoryNames;
  readonly copy: ReconciliationCopy;
}) {
  return (
    <li className="rounded-lg border border-white/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-white">{copy.findingTitle[finding.kind]}</p>
        {/* The currency as a tag rather than in the sentence: a finding is about exactly
            one, and it is what somebody scans the list by. */}
        <Tag>{finding.currency}</Tag>
      </div>
      <p className="mt-2 break-words text-sm text-white/64">{describe(finding, names, copy)}</p>
    </li>
  );
}
