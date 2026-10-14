'use client';

import { useCallback, useState } from 'react';
import { Avatar, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { Link } from '../../i18n/navigation';
import { listBlocked, unblockAccount, type BlockedAccount } from '../../lib/community/blocks';
import { profileHref } from '../../lib/profiles/api';
import { formatRelativeTime } from '../../lib/time';
import type { BlockedListCopy } from '../../lib/i18n/block-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { useCursorList } from '../account/useCursorList';

/**
 * The accounts this reader blocked, with Unblock — §4.9's C-08, issue #324.
 *
 * <h2>On the privacy page, because that is what it is</h2>
 *
 * The page is about who can see you and what is kept about you; a block is the other half of
 * that sentence — whom you no longer see. The panel says what a block does at the top, once,
 * for `FollowingPanel`'s reason: somebody reading this list is deciding whether to keep each
 * row, and cannot decide without knowing what keeping it means.
 *
 * <h2>The same machine as the following list</h2>
 *
 * `useCursorList` reads the first page and extends it a page at a time, and an unblock takes its
 * row out at once and puts it back if the service refuses — `FollowingPanel`'s optimistic
 * removal, with the same "it is still blocked" sentence rather than an apology.
 *
 * <h2>Each name opens the profile</h2>
 *
 * Only the name is the link, because the row also holds the button. A profile its owner has
 * since made private answers 404 there, which is the platform's one answer for a withheld
 * profile.
 */
export interface BlockedAccountsPanelProps {
  /** Every word this panel draws, resolved on the server from `blocking.list`. */
  readonly copy: BlockedListCopy;
}

export function BlockedAccountsPanel({ copy }: BlockedAccountsPanelProps) {
  const locale = useRouteLocale();
  const { status, items, hasMore, loadingMore, error, loadMore, remove } = useCursorList<BlockedAccount>(
    useCallback((cursor, signal) => listBlocked(cursor, signal), []),
    copy,
  );

  const [unblockError, setUnblockError] = useState<string | null>(null);
  const [restored, setRestored] = useState<readonly BlockedAccount[]>([]);
  const [now] = useState(() => new Date());

  async function unblock(account: BlockedAccount): Promise<void> {
    setUnblockError(null);
    setRestored((previous) => previous.filter((row) => row.userId !== account.userId));
    remove((row) => row.userId === account.userId);

    try {
      await unblockAccount(account.userId);
    } catch {
      setRestored((previous) => [account, ...previous]);
      setUnblockError(fillPlaceholders(copy.unblockFailedBody, { name: account.name }));
    }
  }

  // `SessionProvider` guards `/settings`; a signed-out reader is being redirected.
  if (status === 'signed-out') return null;

  const rows = [...restored, ...items];

  return (
    <section className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
      <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{copy.title}</h2>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-white/64">{copy.intro}</p>

      <div className="mt-6 flex flex-col gap-4">
        {status === 'loading' ? (
          <SkeletonGroup label={copy.loading} className="flex flex-col gap-3">
            {[0, 1].map((row) => (
              <Skeleton key={row} height="4rem" />
            ))}
          </SkeletonGroup>
        ) : status === 'failed' ? (
          <InlineAlert variant="danger" title={copy.failedTitle}>
            <p>{error}</p>
          </InlineAlert>
        ) : rows.length === 0 ? (
          <div>
            <p className="text-[15px] font-medium text-white">{copy.emptyTitle}</p>
            <p className="mt-1 text-sm text-white/64">{copy.emptyBody}</p>
          </div>
        ) : (
          <>
            {unblockError !== null && (
              <InlineAlert
                variant="danger"
                title={copy.unblockFailedTitle}
                onDismiss={() => setUnblockError(null)}
              >
                <p>{unblockError}</p>
              </InlineAlert>
            )}

            <ul className="flex list-none flex-col gap-3">
              {rows.map((account) => (
                <li
                  key={account.userId}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/8 bg-surface-3 px-5 py-4"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <Avatar name={account.name} src={account.avatarUrl ?? undefined} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium text-white">
                        <Link
                          href={profileHref(account.slug)}
                          className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                        >
                          {account.name}
                        </Link>
                      </p>
                      {account.blockedAt !== '' && (
                        <p className="mt-1 text-sm text-white/40">
                          {fillPlaceholders(copy.meta, {
                            time: formatRelativeTime(account.blockedAt, now, locale),
                          })}
                        </p>
                      )}
                    </div>
                  </div>

                  <Pill
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={fillPlaceholders(copy.unblockLabel, { name: account.name })}
                    onClick={() => void unblock(account)}
                  >
                    {copy.unblock}
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
          </>
        )}
      </div>
    </section>
  );
}
