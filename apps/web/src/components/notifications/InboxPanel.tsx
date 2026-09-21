'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip, ChipRow, EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  listNotifications,
  markNotificationRead,
  type InboxCursor,
  type InboxNotification,
  type NotificationCategory,
} from '../../lib/notifications/api';
import { CATEGORIES, categoryLabel, dayKeyOf, dayLabelOf } from '../../lib/notifications/describe';
import { NotificationRow } from './NotificationRow';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { InboxCopy } from '../../lib/i18n/notifications-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

type Status = 'loading' | 'ready' | 'failed' | 'signed-out';

/** "All", or one of §4.10's seven groups. */
type Filter = NotificationCategory | 'ALL';

function messageFor(cause: unknown, copy: InboxCopy): string {
  if (cause instanceof ApiError) {
    return (
      cause.problem?.detail ?? cause.problem?.title ?? copy.refused
    );
  }
  return copy.unreachable;
}

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/** The rows, cut to what the two filters allow. */
function visible(
  notifications: readonly InboxNotification[],
  filter: Filter,
  unreadOnly: boolean,
): readonly InboxNotification[] {
  return notifications.filter(
    (row) =>
      (filter === 'ALL' || row.category === filter) &&
      (!unreadOnly || row.readAt === undefined || row.readAt === null),
  );
}

/** The visible rows split into consecutive runs that fall on one calendar day. */
function byDay(
  notifications: readonly InboxNotification[],
): ReadonlyArray<readonly [key: string, rows: readonly InboxNotification[]]> {
  const groups: Array<[string, InboxNotification[]]> = [];

  for (const row of notifications) {
    const key = dayKeyOf(row.occurredAt);
    const last = groups.at(-1);
    if (last !== undefined && last[0] === key) last[1].push(row);
    else groups.push([key, [row]]);
  }
  return groups;
}

/**
 * The in-app inbox — §4.10 and #88.
 *
 * Read state, grouping and filtering, which is what the issue asks for. What it does not
 * have is a way to mark everything read at once: there is no bulk endpoint, and doing it
 * as one request per row would be a button whose cost is however large somebody's backlog
 * is. It is named here rather than half-built.
 *
 * <h2>Filtering is over what has loaded, and the screen says so</h2>
 *
 * `GET /v1/me/notifications` takes a cursor and nothing else — no category, no unread flag.
 * So the two filters below are applied in the browser to the pages already fetched, and
 * "no results" here means "none in what has loaded" rather than "none at all". That
 * distinction is the difference between a filter and a lie, so the empty state says which
 * it is and keeps the button that fetches more.
 *
 * Server-side filtering is a change to the endpoint and its index, and it belongs with
 * whoever adds it rather than being approximated here.
 *
 * <h2>The badge is the service's number, not a count of this list</h2>
 *
 * `unreadCount` is across the whole inbox rather than the loaded page, which is what makes
 * it a badge. It is decremented locally when a row is marked read rather than re-fetched:
 * a request per read to keep a number in step would be a second round trip for one digit.
 *
 * MOTION IS NEAR ZERO, following `SessionsPanel` — this is work rather than discovery, and
 * docs/motion-system.md §8 rules out staggering a list regardless.
 */
export interface InboxPanelProps {
  /** Every word this panel and its rows draw — see `lib/i18n/notifications-copy.ts`. */
  readonly copy: InboxCopy;
}

export function InboxPanel({ copy }: InboxPanelProps) {
  const locale = useRouteLocale();
  const [status, setStatus] = useState<Status>('loading');
  const [notifications, setNotifications] = useState<readonly InboxNotification[]>([]);
  const [cursor, setCursor] = useState<InboxCursor | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());
  const [filter, setFilter] = useState<Filter>('ALL');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const page = await listNotifications(undefined, signal);
      if (signal?.aborted) return;

      setNotifications(page.notifications);
      setCursor(cursorOf(page.nextCursor, page.nextCursorId));
      setUnreadCount(page.unreadCount);
      // Pinned per load, so every row's "ago" is measured from one instant.
      setNow(new Date());
      setError(null);
      setStatus('ready');
    } catch (cause) {
      if (signal?.aborted || wasAborted(cause)) return;

      if (cause instanceof ApiError && cause.status === 401) {
        setStatus('signed-out');
        return;
      }
      setError(messageFor(cause, copy));
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function loadMore(): Promise<void> {
    if (cursor === null) return;

    setLoadingMore(true);
    setError(null);
    try {
      const page = await listNotifications(cursor);
      // Appended rather than merged: the service orders by `(occurredAt, id)` descending
      // and the cursor is the last row of this page, so the next page starts strictly
      // after it. There is nothing to deduplicate.
      setNotifications((previous) => [...previous, ...page.notifications]);
      setCursor(cursorOf(page.nextCursor, page.nextCursorId));
      setUnreadCount(page.unreadCount);
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      setLoadingMore(false);
    }
  }

  function markBusy(id: string, busy: boolean): void {
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * Opening a notification, which is what marks it read.
   *
   * The request is not awaited before the reader navigates — the link has already taken
   * them to the campaign by the time it lands. A failure therefore cannot be reported on a
   * screen that is no longer there, which is why it is silent: the row stays unread and the
   * next visit shows it as such, which is the correct outcome and the honest one.
   */
  async function open(notification: InboxNotification): Promise<void> {
    if (notification.readAt !== undefined && notification.readAt !== null) return;

    markBusy(notification.id, true);
    try {
      const updated = await markNotificationRead(notification.id);
      setNotifications((previous) =>
        previous.map((row) => (row.id === updated.id ? updated : row)),
      );
      setUnreadCount((previous) => Math.max(0, previous - 1));
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      markBusy(notification.id, false);
    }
  }

  if (status === 'signed-out') {
    return (
      <InlineAlert variant="info" title={copy.signedOut}>
        Sign in again to read your notifications.
      </InlineAlert>
    );
  }

  const shown = visible(notifications, filter, unreadOnly);
  const groups = byDay(shown);

  return (
    <section aria-labelledby="inbox-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="inbox-heading"
          // Focus target for the filter controls below, which can empty the list under
          // somebody's cursor. Not in the tab order.
          tabIndex={-1}
          ref={headingRef}
          className="text-lg font-medium tracking-[-0.02em] text-white"
        >
          {copy.heading}
          {status === 'ready' && unreadCount > 0 && (
            <span className="ml-2 text-xs font-normal text-white/56">
              {fillPlaceholders(copy.unread, { count: String(unreadCount) })}
            </span>
          )}
        </h2>

        <Pill
          // White when on, never lime: docs/ui-kit.md §7.3 -- a filter is not urgent.
          variant={unreadOnly ? 'primary' : 'ghost'}
          size="sm"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly((previous) => !previous)}
        >
          {copy.unreadOnly}
        </Pill>
      </div>

      {/*
        Filters are white when selected, never lime — docs/ui-kit.md §7.3: a filter is not
        urgent. `Chip` carries `aria-pressed` for the same reason the toggle above does.
      */}
      <ChipRow className="mt-4" aria-label={copy.filterLabel}>
        <Chip active={filter === 'ALL'} onClick={() => setFilter('ALL')}>
          {copy.all}
        </Chip>
        {CATEGORIES.map((category) => (
          <Chip
            key={category}
            active={filter === category}
            onClick={() => setFilter(category)}
          >
            {categoryLabel(category, copy)}
          </Chip>
        ))}
      </ChipRow>

      {error && (
        <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {status === 'loading' && (
        <SkeletonGroup label={copy.loadingList} className="mt-4">
          <div className="divide-y divide-white/6 overflow-hidden rounded-lg border border-white/8 bg-surface-2">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-start gap-3 px-5 py-4">
                <Skeleton height="0.5rem" width="0.5rem" className="mt-2 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton height="1rem" width="70%" />
                  <Skeleton height="0.75rem" width="35%" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && shown.length === 0 && (
        <EmptyState
          className="mt-4"
          title={notifications.length === 0 ? copy.emptyTitle : copy.filteredTitle}
          description={
            notifications.length === 0
              ? copy.emptyBody
              : copy.filteredBody
          }
        />
      )}

      {status === 'ready' && shown.length > 0 && (
        <div className="mt-4 space-y-6">
          {groups.map(([key, rows]) => (
            <section key={key} aria-labelledby={`day-${key}`}>
              <h3
                id={`day-${key}`}
                className="mb-2 text-xs font-medium tracking-[0.04em] text-white/56 uppercase"
              >
                {dayLabelOf(rows[0]?.occurredAt ?? '', now, locale)}
              </h3>
              <ul className="divide-y divide-white/6 overflow-hidden rounded-lg border border-white/8 bg-surface-2">
                {rows.map((row) => (
                  <NotificationRow
                    key={row.id}
                    notification={row}
                    now={now}
                    locale={locale}
                    copy={copy}
                    busy={busyIds.has(row.id)}
                    onOpen={(target) => void open(target)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {status === 'ready' && cursor !== null && (
        <Pill variant="ghost" size="sm" className="mt-4" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? copy.loading : copy.loadMore}
        </Pill>
      )}

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => void load()}>
          Try again
        </Pill>
      )}
    </section>
  );
}

/** The two halves of a position, or null. Whole or absent — never half of one. */
function cursorOf(before: string | undefined, beforeId: string | undefined): InboxCursor | null {
  return before !== undefined && beforeId !== undefined ? { before, beforeId } : null;
}
