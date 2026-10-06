'use client';

import { useEffect, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { Package } from 'lucide-react';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup, Tag } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { listMyFulfilments, type BackerFulfilment } from '../../lib/fulfilment/api';
import { describeStatus, isFollowableTrackingUrl } from '@ideanest/account/fulfilment';
import { formatExactTime } from '../../lib/time';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { DeliveryListCopy } from '../../lib/i18n/fulfilment-copy';

/**
 * §4.8's PM-09 and PM-10 from the backer's side — where each reward is. Issue #290.
 *
 * <h2>One row per pledge, and the campaign is the heading</h2>
 *
 * `GET /v1/me/fulfilments` returns the parcel and the campaign it belongs to. The campaign
 * fields are nullable — the response is explicit about it — and a campaign that has been
 * removed still owes a parcel, so a row with no title renders as the pledge it is rather than
 * being dropped. Dropping it would leave somebody unable to see a delivery they are waiting
 * for.
 *
 * <h2>The tracking URL is the creator's text, and it is checked before it becomes a link</h2>
 *
 * `isFollowableTrackingUrl` allows `http` and `https` and nothing else. A `javascript:` URL in
 * an anchor is script execution on this origin, which is where the session lives. A tracking
 * reference that is not a followable URL is still shown — as text — because the number is
 * useful on the carrier's own site.
 *
 * <h2>The address link is on every row</h2>
 *
 * PM-08 lets a creator lock addresses before printing labels, and the moment a backer most
 * wants to change theirs is the moment they are looking at a parcel that has not moved. The
 * link goes to the form, which is where the locked state is explained — putting it here would
 * mean this list guessing at a state it has not read.
 */
export interface DeliveryListProps {
  /** Every word this list draws, resolved by the route — see `lib/i18n/fulfilment-copy.ts`. */
  readonly copy: DeliveryListCopy;
}

export function DeliveryList({ copy }: DeliveryListProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'signed-out'>('loading');
  const [rows, setRows] = useState<readonly BackerFulfilment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const mine = await listMyFulfilments(controller.signal);
        if (controller.signal.aborted) return;

        setRows(mine);
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
            ? (cause.problem?.detail ?? cause.problem?.title ?? copy.refused)
            : copy.unreachable,
        );
        setStatus('failed');
      }
    })();

    return () => controller.abort();
  }, [copy.refused, copy.unreachable]);

  if (status === 'signed-out') return null;

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loading} className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height="7rem" />
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

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Package aria-hidden="true" className="size-6" />}
        title={copy.emptyTitle}
        description={copy.emptyBody}
        action={
          <Link href="/discover">
            <Pill type="button">{copy.emptyAction}</Pill>
          </Link>
        }
      />
    );
  }

  return (
    <ul className="flex list-none flex-col gap-3">
      {rows.map((row) => {
        const state = describeStatus(row.fulfilment.status, copy);
        const followable = isFollowableTrackingUrl(row.fulfilment.trackingUrl);
        const addressHref = `/pledges/${encodeURIComponent(row.fulfilment.pledgeId)}/address`;

        return (
          <li
            key={row.fulfilment.pledgeId}
            className="rounded-xl border border-white/8 bg-surface-2 px-5 py-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[17px] font-medium tracking-[-0.01em] text-white">
                  {row.projectTitle ?? copy.unlisted}
                </h2>
                <p className="mt-1 text-sm text-white/64">{state.detail}</p>
              </div>
              <Tag variant={state.tone}>{state.label}</Tag>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {row.fulfilment.carrier !== null && row.fulfilment.carrier !== '' && (
                <div className="flex gap-2">
                  <dt className="text-white/40">{copy.carrier}</dt>
                  <dd className="text-white/64">{row.fulfilment.carrier}</dd>
                </div>
              )}

              {row.fulfilment.trackingNumber !== null && row.fulfilment.trackingNumber !== '' && (
                <div className="flex min-w-0 gap-2">
                  <dt className="text-white/40">{copy.tracking}</dt>
                  <dd className="min-w-0 break-all text-white/64">
                    {followable ? (
                      <a
                        href={row.fulfilment.trackingUrl ?? undefined}
                        /*
                         * `noopener noreferrer` on a link a creator typed: without the first
                         * the opened page can reach back through `window.opener`, and without
                         * the second the carrier is told which campaign this backer is
                         * waiting on.
                         */
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-sm text-white underline underline-offset-4 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                      >
                        {row.fulfilment.trackingNumber}
                      </a>
                    ) : (
                      row.fulfilment.trackingNumber
                    )}
                  </dd>
                </div>
              )}

              {row.fulfilment.shippedAt !== null && row.fulfilment.shippedAt !== '' && (
                <div className="flex gap-2">
                  <dt className="text-white/40">{copy.sent}</dt>
                  <dd className="text-white/64">{formatExactTime(row.fulfilment.shippedAt, locale)}</dd>
                </div>
              )}

              {row.fulfilment.deliveredAt !== null && row.fulfilment.deliveredAt !== '' && (
                <div className="flex gap-2">
                  <dt className="text-white/40">{copy.arrived}</dt>
                  <dd className="text-white/64">{formatExactTime(row.fulfilment.deliveredAt, locale)}</dd>
                </div>
              )}
            </dl>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Link
                href={addressHref}
                className="rounded-sm text-white underline underline-offset-4 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
              >
                {copy.shippingAddress}
              </Link>
              {row.creatorSlug !== null && row.projectSlug !== null && (
                <Link
                  href={`/projects/${encodeURIComponent(row.creatorSlug)}/${encodeURIComponent(row.projectSlug)}`}
                  className="rounded-sm text-white/64 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                >
                  {copy.theCampaign}
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
