'use client';

import { useCallback, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { Bookmark } from 'lucide-react';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import {
  campaignHref,
  listSaved,
  unsaveCampaign,
  type SavedCampaign,
} from '../../lib/community/signals';
import { formatRelativeTime } from '../../lib/time';
import { useCursorList } from './useCursorList';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { SignalListCopy } from '../../lib/i18n/signals-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * §4.9's C-10 — the campaigns this account saved. Issue #288.
 *
 * <h2>Rows, not cards</h2>
 *
 * `GET /v1/me/saved` returns five fields per row: an identifier, a title, two slugs and the
 * instant it was saved. No cover image, no funding total, no deadline. A grid of
 * `ProjectCard`s would therefore be a grid of cards with the picture and the progress bar
 * missing — which is the shape §8.2 uses to say "this campaign is loading", on a screen where
 * nothing is loading.
 *
 * So this is a list of titles, and it is honest about being one. The row links to the
 * campaign, where all of that exists. Enriching it means a service read that returns campaign
 * summaries for a set of identifiers, which does not exist and is not this epic's to add.
 *
 * <h2>Removing is optimistic, and reverts</h2>
 *
 * `DELETE /v1/projects/{id}/save` is idempotent and cheap, and the reader is looking at the
 * row they just pressed. Waiting for the round trip before it disappears makes an instant
 * action feel broken; so the row goes at once and comes back with a message if the service
 * refused. The refusal is the uncommon case, and it is the one that gets the explanation.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 puts the account area at none, and §8 rules out staggering a list
 * regardless.
 */
export interface SavedProjectsPanelProps {
  /** Every word this list draws, resolved on the server — #83. */
  readonly copy: SignalListCopy;
}

export function SavedProjectsPanel({ copy }: SavedProjectsPanelProps) {
  const locale = useRouteLocale();
  const { status, items, hasMore, loadingMore, error, loadMore, remove } =
    useCursorList<SavedCampaign>(useCallback((cursor, signal) => listSaved(cursor, signal), []));

  const [removalError, setRemovalError] = useState<string | null>(null);
  const [restored, setRestored] = useState<readonly SavedCampaign[]>([]);
  const [now] = useState(() => new Date());

  async function drop(campaign: SavedCampaign): Promise<void> {
    setRemovalError(null);
    remove((item) => item.projectId === campaign.projectId);

    try {
      await unsaveCampaign(campaign.projectId);
    } catch {
      /*
       * Put it back rather than leaving a row missing from a list that still contains it on
       * the server. `restored` is rendered above the list, because re-inserting it at its old
       * index means knowing an index the hook does not keep — and a row that silently
       * reappears in the middle of a list is harder to notice than one called out at the top.
       */
      setRestored((previous) => [campaign, ...previous]);
      setRemovalError(fillPlaceholders(copy.removalFailedBody, { name: campaign.title }));
    }
  }

  if (status === 'signed-out') return null;

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loading} className="flex flex-col gap-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height="4.5rem" />
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

  const rows = [...restored, ...items];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Bookmark aria-hidden="true" className="size-6" />}
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
    <div className="flex flex-col gap-6">
      {removalError !== null && (
        <InlineAlert
          variant="danger"
          title={copy.removalFailedTitle}
          onDismiss={() => setRemovalError(null)}
        >
          <p>{removalError}</p>
        </InlineAlert>
      )}

      <ul className="flex list-none flex-col gap-3">
        {rows.map((campaign) => (
          <li
            key={campaign.projectId}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/8 bg-surface-2 px-5 py-4"
          >
            <div className="min-w-0">
              <Link
                href={campaignHref(campaign)}
                className="rounded-sm text-[17px] font-medium tracking-[-0.01em] text-white hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
              >
                {campaign.title}
              </Link>
              <p className="mt-1 text-sm text-white/40">
                {fillPlaceholders(copy.meta, {
                  time: formatRelativeTime(campaign.savedAt, now, locale),
                  creator: campaign.creatorSlug,
                })}
              </p>
            </div>

            {/*
              The accessible name carries the title, because a list of eight buttons all named
              "Remove" is a list a screen reader cannot tell apart (§9.4).
            */}
            <Pill
              type="button"
              variant="ghost"
              size="sm"
              aria-label={fillPlaceholders(copy.removeLabel, { name: campaign.title })}
              onClick={() => void drop(campaign)}
            >
              {copy.remove}
            </Pill>
          </li>
        ))}
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
