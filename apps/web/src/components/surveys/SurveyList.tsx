'use client';

import { useEffect, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { ClipboardList } from 'lucide-react';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { listMySurveys, needsAnAnswer, type BackerSurvey } from '../../lib/surveys/api';
import type { SurveysCopy } from '../../lib/i18n/surveys-copy';
import { pluralise } from '../../lib/i18n/plurals';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { SurveyCard } from './SurveyCard';

/**
 * Every survey this account is being asked — §4.8 PM-05. Issue #289.
 *
 * <h2>All of them on one screen, and the unanswered ones first</h2>
 *
 * `GET /v1/me/surveys` returns the whole survey rather than a summary — questions, the
 * reader's own answers, and whether it is open. So a route per survey would be a second read
 * of data this one already has, a second budget in `performance/budgets.json`, and a click
 * between somebody and the thing a creator is waiting on. They are rendered in place.
 *
 * The ordering is the only editorial decision here: **what is still owed comes first**. A
 * backer with four answered surveys and one outstanding should not have to look for the
 * outstanding one, and a list in whatever order the service returned is a list where they do.
 * Within each group the service's order is kept.
 *
 * <h2>Nothing is polled</h2>
 *
 * A survey arrives when a creator sends one, which is not an event this screen can be told
 * about — §4.10's notifications are. Polling would be a request a minute for a list that
 * changes a few times a year.
 *
 * <h2>The words arrive as a prop</h2>
 *
 * This is a client component and has to be, so it cannot read the catalogue itself — issue
 * #84. The route resolves {@link SurveysCopy} once and hands the list its half; each card
 * below is handed the other. `lib/i18n/surveys-copy.ts` carries the rest of that decision.
 */

export interface SurveyListProps {
  readonly copy: SurveysCopy;
}

export function SurveyList({ copy }: SurveyListProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'signed-out'>('loading');
  const [surveys, setSurveys] = useState<readonly BackerSurvey[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const mine = await listMySurveys(controller.signal);
        if (controller.signal.aborted) return;

        setSurveys(mine);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;

        if (cause instanceof ApiError && cause.status === 401) {
          setStatus('signed-out');
          return;
        }
        setError(
          cause instanceof ApiError
            ? (cause.problem?.detail ?? cause.problem?.title ?? copy.list.refused)
            : copy.list.unreachable,
        );
        setStatus('failed');
      }
    })();

    return () => controller.abort();
  }, []);

  if (status === 'signed-out') return null;

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.list.loading} className="flex flex-col gap-4">
        {[0, 1].map((row) => (
          <Skeleton key={row} height="12rem" />
        ))}
      </SkeletonGroup>
    );
  }

  if (status === 'failed') {
    return (
      <InlineAlert variant="danger" title={copy.list.failedTitle}>
        <p>{error}</p>
      </InlineAlert>
    );
  }

  if (surveys.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList aria-hidden="true" className="size-6" />}
        title={copy.list.emptyTitle}
        description={copy.list.emptyBody}
        action={
          <Link href="/discover">
            <Pill type="button">{copy.list.emptyAction}</Pill>
          </Link>
        }
      />
    );
  }

  const outstanding = surveys.filter(needsAnAnswer);
  const rest = surveys.filter((survey) => !needsAnAnswer(survey));

  return (
    <div className="flex flex-col gap-6">
      {outstanding.length > 0 && (
        <InlineAlert
          variant="warning"
          title={pluralise(locale, copy.list.waitingTitle, outstanding.length)}
        >
          <p>{copy.list.waitingBody}</p>
        </InlineAlert>
      )}

      {[...outstanding, ...rest].map((survey) => (
        <SurveyCard
          key={`${survey.surveyId}:${survey.pledgeId}`}
          survey={survey}
          copy={copy.card}
        />
      ))}
    </div>
  );
}
