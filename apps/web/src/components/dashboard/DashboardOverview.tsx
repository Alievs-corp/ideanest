'use client';

import { useEffect, useState } from 'react';
import { CircleCheck, Users } from 'lucide-react';
import { InlineAlert, ProgressBar, Skeleton, SkeletonGroup, StatBlock, StatRow } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { getDashboard, type CampaignDashboard } from '../../lib/dashboard/api';
import { clockSkewMs } from '../../lib/dashboard/clock';
import { formatMoney } from '../../lib/money';
import { CampaignClock } from './CampaignClock';
import { CampaignControls } from './CampaignControls';
import type { CampaignControlsCopy } from '../../lib/i18n/campaign-controls-copy';
import type { DashboardOverviewCopy } from '../../lib/i18n/dashboard-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';

/**
 * §4.7's CD-01: raised, backers, completion, and time remaining.
 *
 * <h2>Why the numbers are fetched here rather than server-rendered</h2>
 *
 * #119 put the public campaign page's content in the first byte of HTML, and this screen
 * deliberately does not follow it. That page is anonymous, cacheable and written for a
 * crawler; this one is one creator's view of their own money behind a bearer token, and
 * the service answers it `no-store`. `lib/api/server.ts` sends no token by design, so
 * there is nothing to render on the server.
 *
 * <h2>Colour carries two different facts and must not confuse them</h2>
 *
 * `--success` means the goal was reached. Lime means act now. docs/ui-kit.md is explicit
 * that conflating them tells a creator the opposite of the truth, so the progress bar and
 * the funded badge use success, the clock uses lime and only inside 48 hours, and neither
 * borrows the other's token. Both are also stated in words.
 *
 * <h2>No entry animation</h2>
 *
 * `FadeUp` lives behind `@ideanest/ui/motion` and brings 116 kB of animation runtime with
 * it. Spending that on a panel whose numbers change while you watch them is the wrong
 * trade, and docs/motion-system.md §5 puts the smallest motion budget on the surfaces
 * closest to money. This is one of them.
 */

type Status = 'loading' | 'ready' | 'failed';

/**
 * Turns a refusal into something a creator can act on.
 *
 * Branches on the status rather than on prose. The service's wording is free to change;
 * what it means is not.
 */
function messageFor(cause: unknown, copy: DashboardOverviewCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return copy.failures.signedOut;
    if (cause.status === 403) return copy.notGranted;
    if (cause.status === 404) return copy.failures.noCampaign;
  }
  return copy.unavailable;
}

export interface DashboardOverviewProps {
  readonly projectId: string;
  /** Injected by tests. Defaults to the real reader. */
  readonly load?: (projectId: string) => Promise<CampaignDashboard>;
  /** Injected by tests, so the skew measurement can be asserted. */
  readonly nowImpl?: () => number;
  /**
   * IDN-EXT-01 (#44): the creator's Extend and Withdraw controls, with their words and the page's
   * locale. Absent, the panel is the read-only overview it always was.
   */
  readonly controls?: { readonly copy: CampaignControlsCopy; readonly locale: string };
  /** Every word this panel and its clock draw, resolved on the server — #79. */
  readonly copy: DashboardOverviewCopy;
}

export function DashboardOverview({
  projectId,
  load,
  nowImpl,
  controls,
  copy,
}: DashboardOverviewProps) {
  const locale = useRouteLocale();
  const now = nowImpl ?? Date.now;
  const [status, setStatus] = useState<Status>('loading');
  const [dashboard, setDashboard] = useState<CampaignDashboard | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [failure, setFailure] = useState<string>('');
  // Bumped after the creator extends or withdraws, so the figures and the state are read again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const reader = load ?? getDashboard;

    reader(projectId)
      .then((body) => {
        if (cancelled) return;
        // Measured once, from the response that carried serverTime. Re-measuring on every
        // tick would fold whatever the last request took into the countdown.
        setSkewMs(body.serverTime ? clockSkewMs(body.serverTime, now()) : 0);
        setDashboard(body);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setFailure(messageFor(cause, copy));
        setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, attempt]);

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loading}>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </SkeletonGroup>
    );
  }

  if (status === 'failed' || dashboard === null) {
    return <InlineAlert variant="danger">{failure}</InlineAlert>;
  }

  const percent = dashboard.percentFunded;
  const funded = dashboard.goalReached === true;

  return (
    <section aria-labelledby="dashboard-heading">
      <h1
        id="dashboard-heading"
        className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl"
      >
        {dashboard.title}
      </h1>

      <div className="mt-6">
        <CampaignClock
          deadline={dashboard.deadline ?? null}
          skewMs={skewMs}
          nowImpl={nowImpl}
          copy={copy.clock}
        />
      </div>

      <StatRow className="mt-8">
        <StatBlock label={copy.raised} value={formatMoney(dashboard.raised)} />
        <StatBlock
          label={copy.backers}
          value={
            <span className="inline-flex items-center gap-2">
              <Users className="size-5" aria-hidden />
              {dashboard.backersCount}
            </span>
          }
        />
        <StatBlock
          label={copy.goal}
          value={dashboard.goal ? formatMoney(dashboard.goal) : copy.goalUnset}
        />
      </StatRow>

      {percent === undefined || percent === null ? (
        // Not a bar at zero. A campaign with no goal has not raised none of it — it has
        // not asked for anything, and a bar at the far left says the opposite.
        <p className="mt-6 text-sm text-white/64">{copy.noGoal}</p>
      ) : (
        <div className="mt-6">
          <ProgressBar
            value={percent}
            label={fillPlaceholders(copy.progressLabel, { percent: String(percent) })}
          />
          <p className="mt-2 flex items-center gap-2 text-sm text-white">
            {/* Printed as text as well as drawn, because a bar that only changes colour
                has said nothing to a screen reader. ui-kit §9.2. */}
            <span className="tabular-nums">
              {fillPlaceholders(copy.percentFunded, { percent: String(percent) })}
            </span>
            {funded ? (
              <span className="inline-flex items-center gap-1 text-[--success]">
                <CircleCheck className="size-4" aria-hidden />
                {copy.goalReached}
              </span>
            ) : null}
          </p>
        </div>
      )}

      {controls !== undefined && (
        <CampaignControls
          projectId={projectId}
          state={dashboard.state}
          percentFunded={percent}
          deadline={dashboard.deadline}
          copy={controls.copy}
          locale={controls.locale}
          onChanged={() => setAttempt((n) => n + 1)}
        />
      )}

      {dashboard.outcome ? (
        <div className="mt-8 rounded-[16px] border border-white/8 p-5">
          <h2 className="text-sm font-semibold text-white">{copy.outcomeHeading}</h2>
          <p className="mt-2 max-w-[62ch] text-sm text-white/64">
            {fillPlaceholders(copy.outcome, {
              pledged: formatMoney(dashboard.outcome.pledged),
              // The count declines with the sentence rather than being dropped into it as a
              // bare number: Russian has three forms of "backer" and the last digit picks.
              // `?? 0`: springdoc marks the field optional, and "from backers" with the
              // number missing is a worse sentence than "from 0 backers".
              backers: pluralise(locale, copy.outcomeBackers, dashboard.outcome.backersCount ?? 0),
              goal: formatMoney(dashboard.outcome.goal),
            })}
          </p>
        </div>
      ) : null}
    </section>
  );
}
