'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Chip,
  ChipRow,
  EmptyState,
  Field,
  InlineAlert,
  Pill,
  Skeleton,
  SkeletonGroup,
  Tag,
  TextInput,
} from '@ideanest/ui';
import { Link } from '../../i18n/navigation';
import { ApiError } from '../../lib/api/problem';
import { listUsers, reinstateUser, type AdminUser } from '../../lib/admin/api';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import { formatDate } from '../../lib/time';
import type { Locale } from '../../lib/i18n/locale';
import type { UserDirectoryCopy } from '../../lib/i18n/admin/people-copy';
import { requiredCapabilityFrom } from '../../lib/admin/refusals';
import { suspensionMessageFor } from '../../lib/admin/suspension';
import { SuspendDialog } from './AccountSuspension';
import { ConsoleCount } from './ConsoleCount';
import { useConsoleMembership } from './ConsoleMembership';
import { ConsoleRefusal } from './ConsoleRefusal';
import { CopyIdentifier } from './ConsoleIdentity';

type Status = 'loading' | 'ready' | 'failed' | 'signed-out' | 'forbidden';

/**
 * Turns a refusal into something a moderator can act on.
 *
 * The list keeps its own not-staff sentence, which names the directory and what searching it
 * costs; everything else is the suspension dialog's table, so a refused reinstatement and a
 * refused suspension read the same.
 */
function messageFor(cause: unknown, copy: UserDirectoryCopy): string {
  if (cause instanceof ApiError && cause.status === 403 && requiredCapabilityFrom(cause) === null) {
    return copy.notStaff;
  }
  return suspensionMessageFor(cause, copy.subject, copy);
}

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/**
 * The day, in the reader's language. An instant to the second says more than anybody needs.
 *
 * <p>`toLocaleDateString()` with no argument until #401, which is the *browser's* language
 * rather than the route's — so an Azerbaijani console on an American laptop rendered
 * `7/27/2026` under a heading in Azerbaijani.
 */
function day(instant: string | null, locale: Locale): string | null {
  return instant === null ? null : formatDate(instant, locale);
}

/**
 * §4.11's AD-04: the account directory.
 *
 * <p>THE BAN IS NOT OPTIMISTIC, deliberately — `SuspendDialog` has why. What comes back is the
 * service's own projection and it replaces the row wholesale.
 *
 * <p>THE SEARCH IS A FORM, not a keystroke handler. Every read of this list is
 * audited — it hands out other people's email addresses — so a request per
 * character would fill the one table with no retention rule with a row per
 * keystroke, and would do it while somebody typed an address.
 *
 * <p><strong>A row's control is quiet.</strong> Every row drew a solid red "Suspend", twenty-five
 * of them down the page, including on the reader's own account — which the service refuses. The
 * control is an outline now, the dialog it opens is where the danger is stated, and the reader's
 * own row says "You" instead of offering what cannot be done.
 *
 * <p>MOTION is the modal's entry and colour on hover. Nothing else:
 * docs/motion-system.md §8 forbids animation in long lists, and this is a list of
 * people's accounts.
 */
export interface UserDirectoryProps {
  readonly copy: UserDirectoryCopy;
}

export function UserDirectory({ copy }: UserDirectoryProps) {
  const locale = useRouteLocale();
  const { membership } = useConsoleMembership();
  const [status, setStatus] = useState<Status>('loading');
  // #400: which of the two 403s this is. Only read while `status` is `forbidden`.
  const [capability, setCapability] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [loaded, setLoaded] = useState<readonly AdminUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Set when "load more" is what reached the end, so the reader who asked is told there was
  // nothing further rather than watching the button vanish. A list that fits on its first
  // page never offered the button and needs no sentence.
  const [reachedEnd, setReachedEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<AdminUser | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus('loading');
      try {
        const page = await listUsers({
          query: submitted,
          suspendedOnly,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setLoaded(page.users);
        setCursor(page.nextCursor);
        setReachedEnd(false);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        if (cause instanceof ApiError && cause.status === 401) {
          setStatus('signed-out');
          return;
        }
        if (cause instanceof ApiError && cause.status === 403) {
          setCapability(requiredCapabilityFrom(cause));
          setStatus('forbidden');
          return;
        }
        setError(messageFor(cause, copy));
        setStatus('failed');
      }
    }

    void load();
    return () => controller.abort();
    // The copy is one object per server render — see `useConsoleResource` for the argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, suspendedOnly, attempt]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || loadingMore) return;

    setLoadingMore(true);
    setError(null);
    try {
      const page = await listUsers({ query: submitted, suspendedOnly, after: cursor });
      // Keyed by identifier, so a row the reader already has is never drawn twice — not even
      // if an account suspended or reinstated meanwhile moves across the page boundary.
      setLoaded((previous) => {
        const shown = new Set(previous.map((user) => user.id));
        return [...previous, ...page.users.filter((user) => !shown.has(user.id))];
      });
      setCursor(page.nextCursor);
      setReachedEnd(page.nextCursor === null);
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, submitted, suspendedOnly, copy]);

  function markBusy(id: string, busy: boolean): void {
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** The service's own version of an account, back into the list it came from. */
  function applyUser(updated: AdminUser): void {
    setLoaded((previous) =>
      // A reinstated account has left the "suspended only" list, so it is removed
      // rather than left behind contradicting the filter above it.
      suspendedOnly && !updated.suspended
        ? previous.filter((row) => row.id !== updated.id)
        : previous.map((row) => (row.id === updated.id ? updated : row)),
    );
  }

  async function commitReinstatement(user: AdminUser): Promise<void> {
    markBusy(user.id, true);
    setError(null);
    setNotice(null);

    try {
      const updated = await reinstateUser(user.id);
      applyUser(updated);
      setNotice(fillPlaceholders(copy.reinstatedNotice, { name: updated.name }));
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      markBusy(user.id, false);
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
    // Two 403s, and only the first is this screen's — #400. A colleague short of a
    // capability gets the console's sentence, which names the one the service asked for;
    // the screen's own words are for somebody who does not work here at all.
    if (capability != null && capability !== '') {
      return (
        <ConsoleRefusal
          status={status}
          capability={capability}
          subject={copy.subject}
          copy={copy.refusals}
        />
      );
    }

    return (
      <InlineAlert variant="info" title={copy.forbiddenTitle}>
        {copy.forbiddenBody}
      </InlineAlert>
    );
  }

  return (
    <section aria-labelledby="admin-users-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="admin-users-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-medium tracking-[-0.02em] text-fg sm:text-lg"
        >
          {copy.heading}
          {status === 'ready' && (
            <ConsoleCount loaded={loaded.length} more={cursor !== null} copy={copy.count} />
          )}
        </h2>
      </div>

      {/*
        A form, so that a search is one request per intention rather than one per
        keystroke — every one of them is audited, and the term is frequently
        somebody's email address.

        The hint sits under the row rather than inside the field: inside, it pushed the
        field's bottom edge down and the button, aligned to the row's end, hung below the
        input it belongs to.
      */}
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(term);
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field label={copy.searchLabel} className="min-w-[260px] flex-1">
            <TextInput
              type="search"
              value={term}
              placeholder="ayan@example.com"
              aria-describedby="admin-users-search-hint"
              onChange={(event) => setTerm(event.target.value)}
            />
          </Field>
          {/* `mb-0.5` centres the 40px pill on the 44px input it sits beside. */}
          <Pill type="submit" variant="outline" className="mb-0.5">
            {copy.search}
          </Pill>
        </div>
        <p id="admin-users-search-hint" className="mt-2 text-xs text-fg-48">
          {copy.searchHint}
        </p>
      </form>

      <ChipRow aria-label={copy.standing} className="mt-3">
        <Chip active={suspendedOnly} onClick={() => setSuspendedOnly((previous) => !previous)}>
          {copy.suspendedOnly}
        </Chip>
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
          <div className="space-y-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="rounded-lg border border-fg/8 bg-surface-2 p-4 sm:p-5">
                <Skeleton height="1.125rem" width="30%" />
                <Skeleton height="0.875rem" width="45%" className="mt-3" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && loaded.length === 0 && (
        <EmptyState
          className="mt-4"
          variant={submitted !== '' || suspendedOnly ? 'filtered' : 'empty'}
          title={submitted !== '' || suspendedOnly ? copy.filteredTitle : copy.emptyTitle}
          description={
            submitted !== '' || suspendedOnly ? copy.filteredBody : copy.emptyBody
          }
        />
      )}

      {status === 'ready' && loaded.length > 0 && (
        <ul className="mt-4 space-y-3">
          {loaded.map((user) => {
            const mine = membership?.accountId === user.id;

            return (
              <li
                key={user.id}
                className="rounded-lg border border-fg/8 bg-surface-2 p-4 sm:p-5"
                aria-busy={busyIds.has(user.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/*
                      #404: the name is the way into the account — its campaigns, its pledges,
                      its standing — and that screen can suspend as well, from the same dialog.
                    */}
                    <Link
                      href={`/admin/users/${encodeURIComponent(user.id)}`}
                      className="block truncate rounded-lg text-sm font-medium text-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      {user.name}
                    </Link>
                    {/* The address is why this screen exists and why every read of it
                        is audited. Nothing else on the platform shows one. */}
                    <p className="truncate text-sm text-fg-64">{user.email}</p>
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-fg-40">
                      <span className="truncate">
                        /{user.slug} ·{' '}
                        {fillPlaceholders(copy.joined, {
                          date: day(user.createdAt, locale) ?? copy.unknownDate,
                        })}
                      </span>
                      {/*
                        #402: the identifier `/admin/staff` once asked for by hand. The
                        fragment is here, the whole value is on the control.
                      */}
                      <span className="font-mono text-fg-32" title={user.id}>
                        {user.id.slice(0, 8)}
                      </span>
                      <CopyIdentifier id={user.id} copy={copy.identity} />
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Never colour alone: each state is a word as well as a tone. */}
                    {mine && <Tag>{copy.you}</Tag>}
                    <Tag variant={user.emailVerified ? 'success' : 'default'}>
                      {user.emailVerified ? copy.emailVerified : copy.emailUnverified}
                    </Tag>
                    {user.suspended && <Tag variant="danger">{copy.suspendedTag}</Tag>}
                    {user.deletionScheduledAt !== null && (
                      <Tag variant="warning">{copy.leaving}</Tag>
                    )}
                  </div>
                </div>

                {user.suspended && (
                  <p className="mt-3 text-sm text-fg-64">
                    {fillPlaceholders(copy.suspendedOn, {
                      date: day(user.suspendedAt, locale) ?? copy.unknownDate,
                    })}
                    {user.suspensionReason !== null && `: ${user.suspensionReason}`}
                  </p>
                )}

                {!mine && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {user.suspended ? (
                      <Pill
                        variant="ghost"
                        size="sm"
                        disabled={busyIds.has(user.id)}
                        onClick={() => void commitReinstatement(user)}
                      >
                        {busyIds.has(user.id) ? copy.reinstating : copy.reinstate}
                      </Pill>
                    ) : (
                      <Pill
                        variant="outline"
                        size="sm"
                        disabled={busyIds.has(user.id)}
                        onClick={() => {
                          setNotice(null);
                          setPending(user);
                        }}
                      >
                        {copy.suspend}
                      </Pill>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/*
        The count is the heading's badge. A second sentence under the list — "25 accounts
        shown, and there are more" — said the same thing, with a comma Azerbaijani does not
        put before "and", beside the control that already means "there are more".
      */}
      {status === 'ready' && cursor !== null && (
        <Pill
          variant="ghost"
          size="sm"
          className="mt-3"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? copy.loading : copy.loadMore}
        </Pill>
      )}

      <div role="status" aria-live="polite" className="empty:hidden">
        {status === 'ready' && reachedEnd && cursor === null && loaded.length > 0 && (
          <p className="mt-3 text-sm text-fg-64">{copy.noMore}</p>
        )}
      </div>

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
          {copy.tryAgain}
        </Pill>
      )}

      {pending !== null && (
        <SuspendDialog
          account={pending}
          copy={copy}
          subject={copy.subject}
          onClose={() => setPending(null)}
          onSuspended={(updated) => {
            applyUser(updated);
            setNotice(fillPlaceholders(copy.suspendedNotice, { name: updated.name }));
            setPending(null);
            // The button that opened the dialog may have gone with its row. Moving
            // focus to the heading puts a keyboard user somewhere that still exists.
            headingRef.current?.focus();
          }}
        />
      )}
    </section>
  );
}
