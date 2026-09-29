'use client';

import { useCallback, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { UserPlus } from 'lucide-react';
import { Avatar, EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import {
  listFollowing,
  unfollowCreator,
  type FollowedCreator,
} from '../../lib/community/signals';
import { profileHref } from '../../lib/profiles/api';
import { formatRelativeTime } from '../../lib/time';
import { useCursorList } from './useCursorList';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { SignalListCopy } from '../../lib/i18n/signals-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * §4.9's C-10 — the creators this account follows. Issue #288.
 *
 * <h2>Each name opens the creator's profile</h2>
 *
 * The rows were plain text while there was no user page to point at. #274 built `/u/{slug}`,
 * and #143 links the name to it. Only the name is the link — the row also holds the Unfollow
 * button, and a whole-row link around a button is two controls in one target. A profile the
 * creator has since made private answers 404 there, which is the platform's one answer for
 * a withheld profile rather than a broken link.
 *
 * <h2>Following exists to be told about a launch</h2>
 *
 * The screen says so, once, at the top of the list rather than on every row. It is the only
 * thing following actually does, and somebody looking at this list is usually deciding whether
 * to keep receiving those messages — which is a decision they cannot make without knowing what
 * they are.
 */
export interface FollowingPanelProps {
  /** Every word this list draws, resolved on the server — #83. */
  readonly copy: SignalListCopy;
}

export function FollowingPanel({ copy }: FollowingPanelProps) {
  const locale = useRouteLocale();
  const { status, items, hasMore, loadingMore, error, loadMore, remove } =
    useCursorList<FollowedCreator>(
      useCallback((cursor, signal) => listFollowing(cursor, signal), []),
    );

  const [removalError, setRemovalError] = useState<string | null>(null);
  const [restored, setRestored] = useState<readonly FollowedCreator[]>([]);
  const [now] = useState(() => new Date());

  async function drop(creator: FollowedCreator): Promise<void> {
    setRemovalError(null);
    remove((item) => item.creatorId === creator.creatorId);

    try {
      await unfollowCreator(creator.slug);
    } catch {
      setRestored((previous) => [creator, ...previous]);
      setRemovalError(fillPlaceholders(copy.removalFailedBody, { name: creator.name }));
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
        icon={<UserPlus aria-hidden="true" className="size-6" />}
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
        {rows.map((creator) => (
          <li
            key={creator.creatorId}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/8 bg-surface-2 px-5 py-4"
          >
            <div className="flex min-w-0 items-center gap-4">
              {/*
                Initials rather than a picture: the endpoint returns a name and a slug and no
                avatar, and an `<img>` pointed at a URL nobody sent would be a broken image on
                every row. `Avatar` draws initials when it has no source.
              */}
              <Avatar name={creator.name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-[17px] font-medium tracking-[-0.01em] text-white">
                  <Link
                    href={profileHref(creator.slug)}
                    className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                  >
                    {creator.name}
                  </Link>
                </p>
                <p className="mt-1 text-sm text-white/40">
                  {fillPlaceholders(copy.meta, {
                    creator: creator.slug,
                    time: formatRelativeTime(creator.followedAt, now, locale),
                  })}
                </p>
              </div>
            </div>

            <Pill
              type="button"
              variant="ghost"
              size="sm"
              aria-label={fillPlaceholders(copy.removeLabel, { name: creator.name })}
              onClick={() => void drop(creator)}
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
