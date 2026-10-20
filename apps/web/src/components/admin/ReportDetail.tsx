'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { actionLabel, readTrail, type AuditEntry } from '../../lib/admin/audit';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import {
  getReport,
  resolveReport,
  type QueuedReport,
  type ReportOutcome,
} from '../../lib/moderation/api';
import {
  formatExactTime,
  formatRelativeTime,
  openReportsLabel,
} from '../../lib/moderation/describe';
import { fillNodes } from '../../lib/i18n/placeholders';
import type { ReportDetailCopy } from '../../lib/i18n/admin/content-copy';
import { DecisionDialog, type Decision } from '../moderation/DecisionDialog';
import { readReportedContent, type ReportedContent } from '../../lib/admin/reported-content';
import { ConsoleRefusal } from './ConsoleRefusal';
import { EntityName } from './ConsoleIdentity';
import { ReportedContentPanel } from './ReportedContentPanel';
import { useDirectoryNames } from './useDirectoryNames';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

export interface ReportDetailProps {
  readonly reportId: string;
  readonly copy: ReportDetailCopy;
}

/**
 * §4.11's AD-01: one complaint, its notes, and the full decision history — issue #296.
 *
 * <h2>What this has that a card in the queue does not</h2>
 *
 * The queue shows what a moderator needs to decide a report and deliberately stops there:
 * twenty cards each carrying a full history is twenty histories nobody read. What is missing
 * from a card, and is the whole of this page, is <strong>the audit trail for the report</strong>
 * — every privileged action recorded against it, including the ones that were refused.
 *
 * <p>That distinction matters more than it sounds. A card's "Decision" block is the current
 * resolution: one decider, one instant, one note. The trail is the sequence, and the sequence
 * is where "somebody tried to uphold this and was refused because they are not staff" lives.
 * A screen that showed only the resolution would answer "what was decided" and could not
 * answer "what happened", and the second question is the one an appeal is about.
 *
 * <h2>Two reads, and neither blocks the other</h2>
 *
 * The report and its history come from two endpoints — `GET /v1/admin/moderation/reports/{id}`
 * and `GET /v1/admin/audit?entityType=report&entityId={id}`, the second of which only became
 * readable with #314. They are requested together and rendered independently: a trail that
 * fails to load leaves the report and its decisions on screen with a line saying the history
 * is missing, rather than replacing a working page with an error.
 *
 * <h2>The decisions are here too, and they are the same two</h2>
 *
 * Upholding and dismissing are reachable from this page as well as from the queue, through the
 * same dialog — one place a decision is committed, and one set of words for what it costs.
 * <strong>The campaign outcomes are not.</strong> Approving or rejecting a campaign is a
 * different privileged action on a different object, it is offered on the queue where the
 * campaign's own state is in view, and putting it on a page titled after a complaint is how a
 * moderator ends up suspending a campaign they meant to write a note about.
 *
 * <h2>Motion</h2>
 *
 * The modal's 200ms entry, and nothing else — docs/motion-system.md §5's budget for a working
 * surface, and the same one the queue keeps.
 */
export function ReportDetail({ reportId, copy }: ReportDetailProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<ConsoleStatus>('loading');
  // #400: which of the two 403s this is. Only read while `status` is `forbidden`.
  const [capability, setCapability] = useState<string | null>(null);
  const [report, setReport] = useState<QueuedReport | null>(null);
  const [history, setHistory] = useState<readonly AuditEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // #399: what the complaint is actually about. A third independent read — see `loadContent`.
  const [content, setContent] = useState<ReportedContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [pending, setPending] = useState<Decision | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  /*
   * Everybody this page mentions — #402.
   *
   * <p>The reporter used to be rendered as an identifier on purpose: "there is no endpoint
   * that turns one into a person", and inventing a name would have been worse than the
   * fragment. #402 built the endpoint. What has not changed is that a report is an
   * accusation and the identifier stays beside the name, because "this account has reported
   * forty campaigns this week" is the question that catches abuse of the feature and it is
   * asked by identifier.
   *
   * <p>The target is named only when it is a thing the directory knows about. A comment or
   * a campaign update has no name to look up, and the fragment is the honest answer there —
   * which is #399's subject rather than this one's.
   */
  const names = useDirectoryNames(
    [
      report?.reporterId ?? null,
      report?.resolution?.moderatorId ?? null,
      report?.target.type === 'USER' ? report.target.id : null,
      // #399: whoever wrote the comment or the update being complained of. The one person
      // on this page a decision is actually about, and the one it never named.
      content?.authorId ?? null,
      ...(history ?? []).map((entry) => entry.actorId ?? null),
    ].filter((id): id is string => id != null),
    report?.target.type === 'PROJECT' ? [report.target.id] : [],
  );

  const loadHistory = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const page = await readTrail({ entityType: 'report', entityId: reportId, signal });
        if (signal?.aborted === true) return;
        setHistory(page.entries);
        setHistoryError(null);
      } catch (cause) {
        if (signal?.aborted === true || wasAborted(cause)) return;
        /*
         * The history failing is not the page failing. The report and its resolution are
         * what a moderator came for; the trail is the second question, and losing it should
         * cost a line of text rather than the screen.
         */
        setHistoryError(consoleMessageFor(cause, copy.historySubject, copy.refusals));
      }
    },
    [reportId, copy],
  );

  /**
   * What the complaint is about — #399.
   *
   * <p>The third independent read on this page, and it degrades the way the second one
   * does: evidence that fails to load costs a line of text, not the screen. A moderator who
   * cannot see the comment must still be able to see the complaint, the reporter and the
   * decision history, because those are what an appeal is answered from.
   */
  const loadContent = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const found = await readReportedContent(reportId, signal);
        if (signal?.aborted === true) return;
        setContent(found);
        setContentError(null);
      } catch (cause) {
        if (signal?.aborted === true || wasAborted(cause)) return;
        setContentError(consoleMessageFor(cause, copy.evidence.subject, copy.refusals));
      }
    },
    [reportId, copy],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus('loading');
      setNotFound(false);
      try {
        const loaded = await getReport(reportId, controller.signal);
        if (controller.signal.aborted) return;

        setReport(loaded);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        if (cause instanceof ApiError && cause.status === 404) {
          setNotFound(true);
          setStatus('ready');
          return;
        }
        const next = statusFor(cause);
        setCapability(requiredCapabilityFrom(cause));
        if (next === 'failed') setError(consoleMessageFor(cause, copy.subject, copy.refusals));
        setStatus(next);
      }
    }

    void load();
    void loadHistory(controller.signal);
    void loadContent(controller.signal);
    return () => controller.abort();
    // `copy` is one object per server render; the language is a path segment, so a change to
    // it remounts this tree rather than re-running the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, attempt, loadHistory, loadContent]);

  async function commit(note: string | null): Promise<void> {
    if (pending === null || report === null || pending.kind !== 'report') return;

    setDialogBusy(true);
    setDialogError(null);
    try {
      const updated = await resolveReport(report.id, pending.outcome, note);
      setReport(updated);
      setPending(null);
      /*
       * The decision that was just taken is a row in the trail, so the trail is re-read
       * rather than appended to from what this screen believes it did. A history assembled
       * from the client's own actions is a history that disagrees with the record the
       * moment two people are working.
       */
      await loadHistory();
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem?.code === 'REPORT_ALREADY_RESOLVED') {
        // Somebody else decided it first. Show what they decided rather than what was tried.
        try {
          setReport(await getReport(reportId));
          await loadHistory();
        } catch {
          // The correction failed too; the message below still says what happened.
        }
        setPending(null);
        setError(consoleMessageFor(cause, copy.subject, copy.refusals));
        return;
      }
      setDialogError(consoleMessageFor(cause, copy.subject, copy.refusals));
    } finally {
      setDialogBusy(false);
    }
  }

  if (status === 'signed-out' || status === 'forbidden') {
    return <ConsoleRefusal status={status} capability={capability} subject={copy.subject} copy={copy.refusals} />;
  }

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loadingList}>
        <div className="rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5">
          <Skeleton height="1.25rem" width="40%" />
          <Skeleton height="0.875rem" width="60%" className="mt-3" />
          <Skeleton height="0.875rem" width="80%" className="mt-2" />
        </div>
      </SkeletonGroup>
    );
  }

  if (notFound) {
    return (
      <EmptyState
        variant="empty"
        title={copy.notFoundTitle}
        description={copy.notFoundBody}
        action={
          <Link
            href="/admin/moderation"
            className="rounded-lg text-sm text-white/64 underline underline-offset-2 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {copy.backToQueue}
          </Link>
        }
      />
    );
  }

  if (report === null) {
    return (
      <>
        {error && (
          <InlineAlert variant="danger" title={copy.errorTitle}>
            {error}
          </InlineAlert>
        )}
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
          {copy.tryAgain}
        </Pill>
      </>
    );
  }

  const now = new Date();
  const kind = copy.moderation.target[report.target.type];
  const open = report.state === 'OPEN';

  return (
    <div>
      {error && (
        <InlineAlert variant="danger" title={copy.errorTitle} className="mb-4">
          {error}
        </InlineAlert>
      )}

      <section
        aria-labelledby="report-heading"
        className="rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="report-heading"
              className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg"
            >
              {copy.moderation.reason[report.reason]}
            </h2>
            <p className="mt-1 text-sm text-white/64">
              {fillNodes(copy.reportedAbout, {
                kind,
                id:
                  report.target.type === 'USER' || report.target.type === 'PROJECT' ? (
                    <EntityName
                      id={report.target.id}
                      names={names}
                      kind={report.target.type === 'USER' ? 'account' : 'project'}
                      copy={copy.identity}
                      copyable
                    />
                  ) : (
                    <span className="font-mono" title={report.target.id}>
                      {report.target.id}
                    </span>
                  ),
              })}
            </p>
          </div>
          <Tag variant={report.state === 'UPHELD' ? 'success' : 'default'}>
            {copy.moderation.state[report.state]}
          </Tag>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-white/40">{copy.reported}</dt>
            <dd className="text-white/64">
              <time dateTime={report.createdAt} title={formatExactTime(report.createdAt, locale)}>
                {formatRelativeTime(report.createdAt, now, locale)}
              </time>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-white/40">{copy.signal}</dt>
            <dd className="text-white/64">
              {openReportsLabel(report, copy.moderation, locale)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-white/40">{copy.reporter}</dt>
            {/*
              Named since #402, with the identifier still beside it. A report is an
              accusation and "this account has reported forty campaigns this week" is the
              question that catches abuse of the feature — which is asked by identifier and
              answered by a person, so the row needs both.
            */}
            <dd className="text-white/64">
              <EntityName
                id={report.reporterId}
                names={names}
                kind="account"
                copy={copy.identity}
                copyable
              />
            </dd>
          </div>
        </dl>

        {/* Untrusted: what one person wrote about another, rendered only ever as text. */}
        {report.detail != null && report.detail !== '' && (
          <blockquote className="mt-4 rounded-md border-l-2 border-white/16 bg-surface-3 py-3 pl-4 pr-3 text-sm text-white/64">
            {report.detail}
          </blockquote>
        )}

        {report.resolution != null && (
          <div className="mt-4 rounded-md bg-surface-3 p-4">
            <h3 className="text-sm font-medium text-white">{copy.moderation.decisionHeading}</h3>
            <p className="mt-1 text-sm text-white/64">
              {fillNodes(copy.moderation.decidedBy[report.state], {
                moderator: (
                  <EntityName
                    id={report.resolution.moderatorId}
                    names={names}
                    kind="account"
                    copy={copy.identity}
                  />
                ),
                at: (
                  <time dateTime={report.resolution.at}>
                    {formatExactTime(report.resolution.at, locale)}
                  </time>
                ),
              })}
            </p>
            {report.resolution.note != null && report.resolution.note !== '' ? (
              <p className="mt-2 text-sm text-white/64">{report.resolution.note}</p>
            ) : (
              <p className="mt-2 text-sm text-white/40">{copy.moderation.noNote}</p>
            )}
          </div>
        )}

      </section>

      {/*
        #399, and its position is the whole of the argument. The complaint is above; the two
        irreversible controls are below. A moderator reaching the decision has passed the
        thing they are deciding about, rather than being offered "Uphold" and "Dismiss"
        beside a UUID and left to go and find the comment by other means.

        The issue's acceptance says it in one line: neither screen presents a decision
        control next to an entity it cannot display.
      */}
      <ReportedContentPanel
        content={content}
        error={contentError}
        names={names}
        locale={locale}
        copy={copy.evidence}
        identity={copy.identity}
      />

      {open && (
        <section
          className="mt-8 rounded-xl border border-white/8 bg-surface-1 p-4 sm:p-5"
          role="group"
          aria-label={copy.decideGroup}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-white/40">
            {copy.decideHeading}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['uphold', 'dismiss'] as const).map((outcome: ReportOutcome) => (
              <Pill
                key={outcome}
                variant="outline"
                size="sm"
                disabled={dialogBusy}
                onClick={() => {
                  setDialogError(null);
                  setPending({ kind: 'report', outcome });
                }}
              >
                {copy.moderation.reportOutcome[outcome]}
              </Pill>
            ))}
          </div>
          <p className="mt-3 max-w-[62ch] text-sm text-white/40">{copy.decideFootnote}</p>
        </section>
      )}

      <section aria-labelledby="report-history-heading" className="mt-8">
        <h2
          id="report-history-heading"
          className="text-base font-medium tracking-[-0.02em] text-white sm:text-lg"
        >
          {copy.historyHeading}
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm text-white/48">{copy.historyIntro}</p>

        {historyError !== null && (
          <InlineAlert variant="info" title={copy.historyFailedTitle} className="mt-4">
            {historyError}
          </InlineAlert>
        )}

        {historyError === null && history === null && (
          <SkeletonGroup label={copy.loadingHistory} className="mt-4">
            <Skeleton height="0.875rem" width="60%" />
            <Skeleton height="0.875rem" width="45%" className="mt-2" />
          </SkeletonGroup>
        )}

        {history !== null && history.length === 0 && (
          <p className="mt-4 text-sm text-white/40">{copy.historyEmpty}</p>
        )}

        {history !== null && history.length > 0 && (
          <ul className="mt-4 flex list-none flex-col gap-2">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-white/8 bg-surface-1 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-sm text-white">
                    {entry.actorId == null
                      ? actionLabel(entry.action, copy.auditAction)
                      : /*
                          One sentence with two holes rather than an action, the word "by" and
                          an identifier concatenated: Azerbaijani and Turkish put the actor
                          before the verb, and three JSX fragments cannot be reordered by a
                          translation.
                        */
                        fillNodes(copy.actionBy, {
                          action: actionLabel(entry.action, copy.auditAction),
                          actor: (
                            <EntityName
                              id={entry.actorId}
                              names={names}
                              kind="account"
                              copy={copy.identity}
                            />
                          ),
                        })}
                  </p>
                  <div className="flex items-center gap-2">
                    {entry.outcome === 'REFUSED' && <Tag variant="warning">{copy.refused}</Tag>}
                    <time
                      dateTime={entry.occurredAt}
                      className="text-xs text-white/40"
                      title={entry.occurredAt}
                    >
                      {formatExactTime(entry.occurredAt, locale)}
                    </time>
                  </div>
                </div>
                {entry.detail != null && entry.detail !== '' && (
                  <p className="mt-2 text-sm text-white/48">{entry.detail}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <DecisionDialog
        decision={pending}
        subject={
          pending === null || report === null
            ? null
            : { key: report.id, targetType: report.target.type, targetId: report.target.id }
        }
        busy={dialogBusy}
        error={dialogError}
        onCancel={() => {
          setPending(null);
          setDialogError(null);
        }}
        onConfirm={(note) => void commit(note)}
        copy={copy.moderation}
        counter={copy.counter}
      />
    </div>
  );
}
