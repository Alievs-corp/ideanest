'use client';

import { useCallback, useEffect, useState } from 'react';
import { Chip, ChipRow, EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  QUEUE_PAGE_SIZE,
  SUBMISSION_STATES,
  decideCampaign,
  listSubmissions,
  type CampaignOutcome,
  type QueuedSubmission,
  type SubmissionState,
} from '../../lib/moderation/api';
import { humaniseState, shortId } from '../../lib/moderation/describe';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { formatMoney } from '../../lib/money';
import type { SubmissionQueueCopy } from '../../lib/i18n/admin/content-copy';
import { DecisionDialog, type Decision } from './DecisionDialog';
import { localeHref } from '../../i18n/navigation';
import type { Locale } from '../../lib/i18n/locale';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

type Status = 'loading' | 'ready' | 'failed' | 'signed-out' | 'forbidden';

interface Pending {
  readonly submission: QueuedSubmission;
  readonly outcome: CampaignOutcome;
}

/** The three verbs, in the order a moderator reaches for them. Reject is last and is destructive. */
const OUTCOMES: readonly CampaignOutcome[] = ['approve', 'request-changes', 'reject'];

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

function messageFor(cause: unknown, copy: SubmissionQueueCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return copy.notStaff;

    if (cause.problem?.code === 'PROJECT_TRANSITION_NOT_ALLOWED') {
      const state = cause.problem?.meta?.state;
      /*
       * Somebody else decided it while this page was open, which on a shared queue is
       * the ordinary case rather than the exception. The refusal carries where the
       * campaign actually is, and saying so is more use than "that did not work".
       */
      return typeof state === 'string'
        ? fillPlaceholders(copy.transitionNotAllowedFrom, { state: humaniseState(state) })
        : copy.transitionNotAllowed;
    }
    return cause.problem?.detail ?? cause.problem?.title ?? copy.refused;
  }
  return copy.unreachable;
}

/** How long a campaign has been waiting, in whole days, floored at zero. */
function daysWaiting(waitingSince: string, now: Date): number {
  const entered = new Date(waitingSince).getTime();
  if (Number.isNaN(entered)) return 0;
  return Math.max(0, Math.floor((now.getTime() - entered) / 86_400_000));
}

export interface SubmissionQueueProps {
  /** Every word this screen draws, resolved by the route on the server. */
  readonly copy: SubmissionQueueCopy;
}

/**
 * AD-01's campaign review queue — what the three moderation outcomes apply to.
 *
 * <h2>Why this screen exists</h2>
 *
 * `approve`, `reject` and `request-changes` have been reachable since #101 and nothing
 * listed their subjects. The console's only route to a campaign was a <em>report</em>
 * about it, so a campaign nobody complained about could sit in `SUBMITTED` indefinitely,
 * invisible here, while its creator was told it was under review. Three privileged
 * actions whose subject cannot be found are three actions nobody takes.
 *
 * <h2>The decisions are not optimistic</h2>
 *
 * The same rule `ModerationQueue` states, for the same reason: each outcome is
 * privileged, audited and hard to reverse, so the row goes busy until the service
 * answers and a refusal leaves it exactly as it was. What comes back is the campaign's
 * own new state, and a campaign that has left this state leaves the list rather than
 * sitting under a filter that says it is not there.
 *
 * <h2>Motion</h2>
 *
 * The dialog's 200ms entry and 150ms of colour on hover. Nothing else —
 * docs/motion-system.md §8 forbids animation in long lists, and this is one.
 */
export function SubmissionQueue({ copy }: SubmissionQueueProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<Status>('loading');
  const [state, setState] = useState<SubmissionState>('SUBMITTED');
  const [loaded, setLoaded] = useState<readonly QueuedSubmission[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus('loading');
      try {
        const page = await listSubmissions({
          state,
          limit: QUEUE_PAGE_SIZE,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setLoaded(page.submissions);
        setCursor(page.nextCursor ?? null);
        setNow(new Date());
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        if (cause instanceof ApiError && cause.status === 401) {
          setStatus('signed-out');
          return;
        }
        if (cause instanceof ApiError && cause.status === 403) {
          setStatus('forbidden');
          return;
        }
        setError(messageFor(cause, copy));
        setStatus('failed');
      }
    }

    void load();
    return () => controller.abort();
    // `copy` is one object per server render and changes only with the language, which is
    // a path segment and remounts this tree rather than re-running this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, attempt]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || loadingMore) return;

    setLoadingMore(true);
    setError(null);
    try {
      const page = await listSubmissions({ state, after: cursor, limit: QUEUE_PAGE_SIZE });
      setLoaded((previous) => [...previous, ...page.submissions]);
      setCursor(page.nextCursor ?? null);
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, state, copy]);

  function markBusy(id: string, busy: boolean): void {
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function commit(note: string | null): Promise<void> {
    if (pending === null) return;

    const { submission, outcome } = pending;
    setDialogBusy(true);
    setDialogError(null);
    setError(null);
    markBusy(submission.projectId, true);

    try {
      const decided = await decideCampaign(submission.projectId, outcome, note);
      // It has left this state, so it leaves this list. Keeping it under a filter that
      // says CHANGES_REQUESTED while the row reads APPROVED is the interface lying about
      // the one thing this screen is for.
      setLoaded((previous) => previous.filter((row) => row.projectId !== submission.projectId));
      setNotice(
        fillPlaceholders(copy.notice, {
          title: submission.title,
          state: humaniseState(decided.state),
        }),
      );
      setPending(null);
    } catch (cause) {
      setDialogError(messageFor(cause, copy));
    } finally {
      setDialogBusy(false);
      markBusy(submission.projectId, false);
    }
  }

  if (status === 'signed-out') {
    return (
      <InlineAlert variant="info" title={copy.signedOutTitle}>
        {copy.signedOutBody}
      </InlineAlert>
    );
  }

  if (status === 'forbidden') {
    return (
      <InlineAlert variant="info" title={copy.forbiddenTitle}>
        {copy.forbiddenBody}
      </InlineAlert>
    );
  }

  return (
    <section aria-labelledby="submission-queue-heading">
      <h2
        id="submission-queue-heading"
        className="text-lg font-medium tracking-[-0.02em] text-white"
      >
        {copy.heading[state]}
        {status === 'ready' && (
          <span className="ml-2 text-xs font-normal text-white/40">{loaded.length}</span>
        )}
      </h2>

      <ChipRow aria-label={copy.statusLabel} className="mt-4">
        {SUBMISSION_STATES.map((option) => (
          <Chip key={option} active={state === option} onClick={() => setState(option)}>
            {copy.state[option]}
          </Chip>
        ))}
      </ChipRow>

      <div role="status" aria-live="polite" className="empty:hidden">
        {notice && (
          <InlineAlert variant="success" className="mt-4">
            {notice}
          </InlineAlert>
        )}
      </div>

      {error && (
        <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="space-y-4">
            {[0, 1, 2].map((row) => (
              <div key={row} className="rounded-lg border border-white/8 bg-surface-2 p-5">
                <Skeleton height="1.125rem" width="40%" />
                <Skeleton height="0.875rem" width="60%" className="mt-3" />
                <Skeleton height="0.875rem" width="30%" className="mt-2" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && loaded.length === 0 && (
        <EmptyState className="mt-4" title={copy.emptyTitle[state]} description={copy.emptyBody[state]} />
      )}

      {status === 'ready' && loaded.length > 0 && (
        <ul className="mt-4 space-y-4">
          {loaded.map((submission) => (
            <SubmissionRow
              key={submission.projectId}
              submission={submission}
              days={daysWaiting(submission.waitingSince, now)}
              locale={locale}
              busy={busyIds.has(submission.projectId)}
              decidable={state === 'SUBMITTED'}
              copy={copy}
              onDecide={(outcome) => {
                setDialogError(null);
                setPending({ submission, outcome });
              }}
            />
          ))}
        </ul>
      )}

      {status === 'ready' && cursor !== null && (
        <Pill
          variant="ghost"
          size="sm"
          className="mt-4"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? copy.loading : copy.loadMore}
        </Pill>
      )}

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
          {copy.tryAgain}
        </Pill>
      )}

      <DecisionDialog
        decision={
          pending === null ? null : ({ kind: 'campaign', outcome: pending.outcome } as Decision)
        }
        subject={
          pending === null
            ? null
            : {
                key: pending.submission.projectId,
                // A campaign outcome always concerns a campaign; the dialog reads this
                // only on the report branch.
                targetType: 'PROJECT',
                targetId: pending.submission.projectId,
              }
        }
        busy={dialogBusy}
        error={dialogError}
        onCancel={() => {
          setPending(null);
          setDialogError(null);
        }}
        onConfirm={(note) => void commit(note)}
        copy={copy.moderation}
      />
    </section>
  );
}

interface SubmissionRowProps {
  readonly submission: QueuedSubmission;
  readonly days: number;
  /**
   * Narrowed from `string` with #399: it now decides a URL through `localeHref`, which
   * refuses anything that is not one of §21.1's four. `useRouteLocale` already produces one.
   */
  readonly locale: Locale;
  readonly busy: boolean;
  /** The three verbs are offered only where they are reachable: from `SUBMITTED`. */
  readonly decidable: boolean;
  readonly copy: SubmissionQueueCopy;
  readonly onDecide: (outcome: CampaignOutcome) => void;
}

/**
 * One campaign in the queue.
 *
 * <p>The heading links to the campaign itself, because every question a moderator has
 * that this row cannot answer — the story, the rewards, the risks — is on that page, and
 * a review that could be done from a summary would not need a person.
 */
function SubmissionRow({
  submission,
  days,
  locale,
  busy,
  decidable,
  copy,
  onDecide,
}: SubmissionRowProps) {
  /*
   * The staff preview, not the public page — issue #399.
   *
   * This link used to be `/projects/{creatorSlug}/{slug}`, which is a 404 for every campaign
   * this queue lists: a campaign awaiting review is not public, and that is what awaiting
   * review means. So the one route from "decide about this campaign" to "read this campaign"
   * was broken by construction, and approval happened on a title, a creator's name and a goal
   * figure. `/admin/campaigns/{id}` renders the same page a backer would see, in any state.
   *
   * A new tab, so the queue and its filters survive the trip. A moderator who works twenty
   * submissions should not have to rebuild the queue's state twenty times.
   */
  const href = localeHref(`/admin/campaigns/${encodeURIComponent(submission.projectId)}`, locale);

  return (
    <li className="rounded-lg border border-white/8 bg-surface-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium text-white">
            <a
              className="underline-offset-4 hover:underline"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              {submission.title}
            </a>
          </h3>
          <p className="mt-1 text-sm text-white/64">
            {/*
              A campaign whose creator has been anonymised keeps its row and loses its
              name — §17.4 removes the person, not the campaign, and a placeholder here
              would tell a moderator there is somebody to write to.
            */}
            {submission.creatorName == null ? (
              copy.creatorGone
            ) : (
              /* The creator's account in a new tab, for the reason the title's link opens
                 one: the queue and its filters survive the trip. That screen is where the
                 creator's VÖEN and business card are read before deciding. */
              <a
                className="underline-offset-4 hover:underline"
                href={localeHref(`/admin/users/${encodeURIComponent(submission.creatorId)}`, locale)}
                target="_blank"
                rel="noreferrer"
              >
                {submission.creatorName}
              </a>
            )}
            <span className="text-white/32"> · {shortId(submission.projectId)}</span>
          </p>
        </div>
        <span className="shrink-0 text-sm text-white/64">
          {fillPlaceholders(copy.waiting, { days: String(days) })}
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-white/40">{copy.goalLabel}</dt>
          <dd className="text-white/80">
            {submission.goal == null ? copy.noGoal : formatMoney(submission.goal)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-white/40">{copy.stateLabel}</dt>
          <dd className="text-white/80">{copy.state[submission.state as SubmissionState] ?? humaniseState(submission.state)}</dd>
        </div>
      </dl>

      {submission.note && (
        <blockquote className="mt-4 border-l-2 border-white/16 pl-3 text-sm text-white/64">
          {submission.note}
        </blockquote>
      )}

      {decidable && (
        <div className="mt-4" role="group" aria-label={fillPlaceholders(copy.decideGroup, { title: submission.title })}>
          <p className="text-sm text-white/40">{copy.decideHeading}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {OUTCOMES.map((outcome) => (
              <Pill
                key={outcome}
                size="sm"
                variant={outcome === 'reject' ? 'danger' : 'ghost'}
                disabled={busy}
                onClick={() => onDecide(outcome)}
              >
                {copy.moderation.campaignOutcome[outcome]}
              </Pill>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
