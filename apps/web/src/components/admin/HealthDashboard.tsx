'use client';

import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import { bakuDateTime } from '../../lib/admin/console-dates';
import {
  byKind,
  latenessOf,
  readHealth,
  worstFirst,
  type HealthStatus,
  type JobHealth,
} from '../../lib/admin/health';
import { numberFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralForm } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { HealthDashboardCopy } from '../../lib/i18n/admin/platform-copy';
import { ConsoleRefusal } from './ConsoleRefusal';
import { useConsoleResource } from './useConsoleResource';

/**
 * §4.11's AD-16: queue depth, failed jobs, provider status — §18, issue #316.
 *
 * <h2>It says it is not monitoring, and that is load-bearing</h2>
 *
 * Every number here is a count the service can already take, so the page needs no collector
 * and no exporter. What it does not do is alert — nobody is woken by anything on this screen —
 * and a dashboard presented as though it were monitoring is worse than an honest gap, because
 * the gap then looks filled. The banner comes from the service&apos;s `monitored` field rather
 * than being hard-coded, so the day monitoring exists it disappears without a change here.
 *
 * <h2>Waiting and dead are never added together</h2>
 *
 * A deep queue is a platform under load and will drain. A dead row is a platform that has given
 * up and will not. One number would let a thousand-item backlog hide the one message that will
 * never be sent, so any dead row is critical regardless of depth — and says what to do.
 *
 * <h2>The scheduler is its rows, not a queue</h2>
 *
 * It used to be listed as a queue as well, with a "waiting" count that was every job that had
 * finished a run. The jobs are graded one by one below, and how many need somebody is counted
 * from those grades.
 *
 * <h2>A job that is held is said to be held</h2>
 *
 * The jobs that pause for maintenance and the ones with no schedule on this deployment are
 * healthy, and the row says which in words instead of a lateness that grows for ever. A dead
 * job shows when it last ran and how many attempts it made, which is what somebody fixing it
 * needs, rather than how long ago a run that is never coming was due.
 *
 * <h2>Not configured is not unhealthy</h2>
 *
 * §9.3 asks for at least two payment integrations and a deployment may run one. Painting the
 * others red would put permanent failures on a screen whose whole job is to show the ones that
 * are not permanent.
 *
 * <h2>When it was measured is a time, not an age</h2>
 *
 * "Measured 4 seconds ago" was computed once, when the page drew, and still said four seconds
 * an hour later. The time of the measurement cannot go stale.
 */

/**
 * Below this, a job is not late — the same minute {@code ideanest.platform.health.late-job-after}
 * defaults to.
 *
 * <p>Duplicated rather than sent, deliberately: it decides a sentence here and a severity
 * there, and the two agreeing is what #405 is about. A deployment that widens the service's
 * threshold makes this screen say "on time" for a shorter range than it grades healthy, which
 * is the harmless direction.
 */
const LATE_AFTER_SECONDS = 60;

export interface HealthDashboardProps {
  readonly copy: HealthDashboardCopy;
}

export function HealthDashboard({ copy }: HealthDashboardProps) {
  const locale = useRouteLocale();
  const health = useConsoleResource((signal) => readHealth(signal), copy.subject, copy.refusals, []);

  if (health.status === 'signed-out' || health.status === 'forbidden') {
    return <ConsoleRefusal status={health.status} capability={health.capability} subject={copy.subject} copy={copy.refusals} />;
  }

  if (health.status === 'loading' && health.data === null) {
    return (
      <SkeletonGroup label={copy.loadingList}>
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
              <Skeleton height="1rem" width="35%" />
              <Skeleton height="0.875rem" width="60%" className="mt-3" />
            </div>
          ))}
        </div>
      </SkeletonGroup>
    );
  }

  if (health.status === 'failed' || health.data === null) {
    return (
      <>
        <InlineAlert variant="danger" title={copy.errorTitle}>
          {health.error ?? copy.readFailed}
        </InlineAlert>
        <Pill variant="ghost" size="sm" className="mt-4" onClick={health.reload}>
          {copy.tryAgain}
        </Pill>
      </>
    );
  }

  const snapshot = health.data;
  const count = (value: number) => numberFormat(locale, {}, 'health-count').format(value);
  const jobs = worstFirst(snapshot.jobs);
  const needingAttention = jobs.filter((job) => job.status !== 'HEALTHY').length;

  return (
    <div className="flex flex-col gap-8">
      {!snapshot.monitored && (
        <InlineAlert variant="info" title={copy.notMonitoredTitle}>
          {copy.notMonitoredBody}
        </InlineAlert>
      )}

      <section aria-labelledby="overall-heading">
        <h2 id="overall-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.overall} <StatusTag status={snapshot.status} copy={copy} />
        </h2>
        <p className="mt-2 text-xs text-fg-64">
          {fillPlaceholders(copy.measuredAt, { time: bakuDateTime(snapshot.at, locale) })}{' '}
          <button
            type="button"
            onClick={health.reload}
            disabled={health.status === 'loading'}
            className="rounded text-fg-64 underline transition-colors duration-150 ease-in-out hover:text-fg disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {copy.measureAgain}
          </button>
        </p>
      </section>

      <section aria-labelledby="queues-heading">
        <h2 id="queues-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.queues}
        </h2>
        <ul className="mt-4 flex list-none flex-col gap-2">
          {snapshot.queues.map((queue) => (
            <li key={queue.name} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {/* The identifier is the fallback, so a new queue renders as itself. */}
                <p className="text-sm text-fg" title={queue.name}>
                  {copy.queue[queue.name] ?? queue.name}
                </p>
                <StatusTag status={queue.status} copy={copy} />
              </div>
              <p className="mt-2 text-xs text-fg-64">
                {fillPlaceholders(copy.waiting, { count: count(queue.waiting) })}
                {queue.dead > 0 ? ` · ${fillPlaceholders(copy.givenUp, { count: count(queue.dead) })}` : ''}
              </p>
              {queue.dead > 0 && <p className="mt-2 text-xs text-fg-80">{copy.givenUpHint}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="jobs-heading">
        <h2 id="jobs-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.jobs}
        </h2>
        <p className="mt-2 text-xs text-fg-64">
          {needingAttention > 0
            ? fillPlaceholders(copy.jobsAttention, { count: count(needingAttention) })
            : copy.jobsAllWell}
        </p>
        <ul className="mt-4 flex list-none flex-col gap-2">
          {jobs.map((job) => (
            <JobRow key={job.name} job={job} copy={copy} locale={locale} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="providers-heading">
        <h2 id="providers-heading" className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg">
          {copy.providers}
        </h2>
        {byKind(snapshot.providers).map(([kind, providers]) => (
          <div key={kind} className="mt-4">
            <h3 className="text-sm font-medium text-fg-80" title={kind}>
              {copy.kind[kind] ?? kind}
            </h3>
            <ul className="mt-2 flex list-none flex-col gap-2">
              {providers.map((provider) => (
                <li key={`${provider.kind}:${provider.provider}`} className="rounded-lg border border-fg/8 bg-surface-1 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-fg" title={provider.provider}>
                      {copy.providerName[provider.provider] ?? provider.provider}
                    </p>
                    {provider.configured ? <StatusTag status={provider.status} copy={copy} /> : <Tag>{copy.notConfigured}</Tag>}
                  </div>
                  {provider.reason != null && (
                    <p className="mt-2 text-xs text-fg-64">{copy.reason[provider.reason] ?? provider.reason}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function JobRow({ job, copy, locale }: { readonly job: JobHealth; readonly copy: HealthDashboardCopy; readonly locale: Locale }) {
  const hold = job.hold ?? null;
  const dead = job.state === 'DEAD';
  const lastRunAt = job.lastRunAt ?? null;
  const lastError = job.lastError ?? null;

  /** What the job is doing, in one line: held, dead, late or on time. */
  const detail: string[] = [];
  if (hold !== null) {
    detail.push(copy.hold[hold] ?? hold);
  } else if (dead) {
    detail.push(copy.jobState['DEAD'] ?? job.state);
  } else if (job.overdueBySeconds >= LATE_AFTER_SECONDS) {
    const late = latenessOf(job.overdueBySeconds);
    detail.push(
      fillPlaceholders(pluralForm(locale, copy.overdue[late.unit], late.count), {
        count: numberFormat(locale, {}, 'health-count').format(late.count),
      }),
    );
  } else {
    detail.push(copy.onTime);
  }
  if (dead || job.attempts > 0) {
    detail.push(fillPlaceholders(pluralForm(locale, copy.attempts, job.attempts), { count: String(job.attempts) }));
  }
  if (dead || hold !== null) {
    detail.push(lastRunAt === null ? copy.neverRun : fillPlaceholders(copy.lastRun, { time: bakuDateTime(lastRunAt, locale) }));
  }

  return (
    <li className="rounded-lg border border-fg/8 bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* The identifier is on the `title`, one hover from whoever is about to grep for it. */}
        <p className="text-sm text-fg" title={job.name}>
          {copy.jobName[job.name] ?? job.name}
        </p>
        <StatusTag status={job.status} copy={copy} />
      </div>
      <p className="mt-2 text-xs text-fg-64" title={job.state}>
        {detail.join(' · ')}
      </p>
      {lastError !== null && (
        <details className="mt-2 text-xs text-fg-64">
          <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
            {copy.lastErrorLabel}
          </summary>
          {/* The service's own words, in English: marked as such, so a screen reader reads them as English. */}
          <p lang="en" className="mt-1 break-words font-mono text-fg-64">
            {lastError}
          </p>
        </details>
      )}
    </li>
  );
}

/**
 * The status, as a word rather than only a colour.
 *
 * CLAUDE.md: colour alone must never carry meaning. A dashboard is exactly where that rule
 * is most often broken and most expensive to break, because the whole page is a colour.
 */
function StatusTag({
  status,
  copy,
}: {
  readonly status: HealthStatus;
  readonly copy: HealthDashboardCopy;
}) {
  const Icon = STATUS_ICON[status] ?? CircleAlert;
  return (
    <Tag variant={STATUS_VARIANT[status] ?? 'default'}>
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      {copy.status[status] ?? status}
    </Tag>
  );
}

/**
 * Each state wears its own status colour and shape, with the word beside it, so the one row that
 * needs somebody stands out of a list of twenty healthy ones without being read line by line.
 * The colours are the kit's status tokens, which are reserved for exactly this.
 */
const STATUS_VARIANT: Readonly<Record<string, 'success' | 'warning' | 'danger'>> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  CRITICAL: 'danger',
};

const STATUS_ICON: Readonly<Record<string, typeof CircleAlert>> = {
  HEALTHY: CircleCheck,
  DEGRADED: TriangleAlert,
  CRITICAL: CircleAlert,
};
