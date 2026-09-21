'use client';

import { useCallback } from 'react';
import { Link } from '../../i18n/navigation';
import { HeartHandshake } from 'lucide-react';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import { useCursorList } from '../account/useCursorList';
import {
  listMyPledges,
  pledgeHref,
  pledgeStateLabel,
  type BackerPledgeSummary,
} from '../../lib/pledges/backer';
import { formatMoney } from '../../lib/money';
import { formatExactTime } from '../../lib/time';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { PledgeListCopy } from '../../lib/i18n/pledges-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { Locale } from '../../lib/i18n/locale';

/**
 * Every pledge this account has made — the way in to §4.5's PL-09 and PL-10. Issue #287.
 *
 * <h2>It reuses the account area's paginator, and the profile grid does not</h2>
 *
 * `useCursorList` reads on mount from a null cursor, which is exactly right here: this list
 * is rendered in the browser with a bearer token and there is no server render to seed it
 * from. `components/profile/ProfileCampaignGrid` refuses the same hook for the opposite
 * reason — it *is* seeded — and says so. Two lists, one hook, one exception, each written
 * down.
 *
 * <h2>A row is a campaign and a total, and nothing else</h2>
 *
 * The summary carries six amounts and this prints one of them: the total. A row that broke
 * out base, add-ons, bonus, shipping and tax would be a receipt per line in a list somebody
 * is scanning to find one pledge — the breakdown belongs on the pledge, which is one press
 * away, and `PledgeSummary` already draws it there.
 *
 * <h2>State is a word, never a colour</h2>
 *
 * `Tag` carries the hue and `pledgeStateLabel` carries the word (docs/ui-kit.md §9.2), and
 * `CHARGE_FAILED` is the only one that takes `--danger` — because it is the only one a backer
 * has to act on. Nothing here is lime: a pledge already made is not urgent, and lime on a list
 * of somebody's own commitments would read as "hurry" against every one of them (§8.1).
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 puts the account area at none and §8 forbids animating a list
 * regardless. The "show more" button changes its label while it waits.
 */

/**
 * The one pledge state that is a `--danger` tag, and the two that are `--warning`.
 *
 * Deliberately sparse. A list where every row is coloured has spent the signal, and the states
 * that are not here are ordinary facts about a pledge rather than things to be alarmed by — a
 * cancelled pledge is not a failure, it is a decision somebody made.
 */
const STATE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'warning',
  CHARGE_PENDING: 'warning',
  CHARGE_FAILED: 'danger',
  COLLECTED: 'success',
  FULFILLED: 'success',
};

function stateVariant(state: string): 'default' | 'success' | 'warning' | 'danger' {
  return STATE_VARIANT[state] ?? 'default';
}

/**
 * The instant that best describes where a pledge is, as a finished sentence.
 *
 * A whole sentence per case rather than a label joined to a time: "Confirmed" followed by a
 * date only reads as English, and two of the four languages put the date first. It returns
 * null when neither instant is set, which is a pledge with nothing to say about when.
 */
function momentOf(pledge: BackerPledgeSummary, copy: PledgeListCopy, locale: Locale): string | null {
  if (pledge.canceledAt != null) {
    return fillPlaceholders(copy.cancelledAt, { time: formatExactTime(pledge.canceledAt, locale) });
  }
  if (pledge.confirmedAt != null) {
    return fillPlaceholders(copy.confirmedAt, { time: formatExactTime(pledge.confirmedAt, locale) });
  }
  return null;
}

export interface PledgeListProps {
  /** Every word this list draws, resolved on the server — #81. */
  readonly copy: PledgeListCopy;
}

export function PledgeList({ copy }: PledgeListProps) {
  const locale = useRouteLocale();
  const { status, items, hasMore, loadingMore, error, loadMore } = useCursorList<BackerPledgeSummary>(
    useCallback((cursor, signal) => listMyPledges(cursor, signal), []),
  );

  if (status === 'signed-out') return null;

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loading} className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height="5.5rem" />
        ))}
      </SkeletonGroup>
    );
  }

  if (status === 'failed') {
    return (
      <InlineAlert variant="danger" title={copy.failedTitle}>
        <p>{error}</p>
      </InlineAlert>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<HeartHandshake aria-hidden="true" className="size-6" />}
        title={copy.emptyTitle}
        description={copy.emptyBody}
        action={
          <Link href="/discover">
            <Pill type="button">{copy.browse}</Pill>
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex list-none flex-col gap-3">
        {items.map((pledge) => {
          const moment = momentOf(pledge, copy, locale);

          return (
            <li
              key={pledge.pledgeId}
              className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-xl border border-white/8 bg-surface-2 px-5 py-4"
            >
              <div className="min-w-0">
                <h3 className="text-[17px] font-medium tracking-[-0.01em] text-white">
                  <Link
                    href={pledgeHref(pledge.pledgeId)}
                    className="rounded-sm hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                  >
                    {pledge.project.title}
                  </Link>
                </h3>

                <p className="mt-1 text-sm text-white/64">
                  {/* PL-02: a pledge with no reward is a first-class choice and is named as
                      one, rather than left as a blank where a title would be. */}
                  {pledge.rewardTitle ?? copy.noReward}
                </p>

                <p className="mt-1 text-sm text-white/40">
                  {fillPlaceholders(copy.byCreator, { creator: pledge.project.creatorSlug })}
                  {moment !== null && (
                    <>
                      {' · '}
                      {moment}
                    </>
                  )}
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  <Tag variant={stateVariant(pledge.state)}>
                    {pledgeStateLabel(pledge.state, copy.states)}
                  </Tag>
                  {pledge.isAnonymous && <Tag>{copy.anonymous}</Tag>}
                  {pledge.latePledge && <Tag>{copy.latePledge}</Tag>}
                </div>
              </div>

              <div className="text-right">
                <p className="text-lg font-medium tabular-nums text-white">
                  {formatMoney(pledge.amounts.total)}
                </p>
                {/*
                  NOT "paid". §9.2 moves no money at confirmation and collection is epic #59's,
                  so a pledge that has not reached COLLECTED is an amount somebody has agreed
                  to rather than one they have been charged. Saying otherwise would have
                  backers budgeting for a debit that has not happened.
                */}
                <p className="mt-1 text-xs text-white/40">
                  {pledge.state === 'COLLECTED' || pledge.state === 'FULFILLED'
                    ? copy.collected
                    : copy.toBeCollected}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div>
          <Pill type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? copy.loadingMore : copy.showMore}
          </Pill>
        </div>
      )}

      {error !== null && (
        <InlineAlert variant="danger" title={copy.nextPageFailed}>
          <p>{error}</p>
        </InlineAlert>
      )}
    </div>
  );
}
