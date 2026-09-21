'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, InlineAlert, Pill, Skeleton, SkeletonGroup } from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';
import { ApiError } from '../../lib/api/problem';
import { signOut as endThisSession } from '../../lib/api/access-token';
import { listSessions, revokeSession, type SessionSummary } from '../../lib/sessions/api';
import { deviceNameOf } from '../../lib/sessions/describe';
import { SessionRow } from './SessionRow';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { SessionsPanelCopy } from '../../lib/i18n/settings-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';

type Status = 'loading' | 'ready' | 'failed' | 'signed-out';

/**
 * Turns a failure into something a user can act on.
 *
 * A problem detail written for an API consumer is not automatically a sentence
 * worth showing, but the ones this endpoint produces are, and inventing a
 * generic message on top of a specific one loses information the user needs.
 */
function messageFor(cause: unknown, copy: SessionsPanelCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return copy.deletionScheduled;
    return cause.problem?.detail ?? cause.problem?.title ?? copy.failures.refusedDetail;
  }
  return copy.failures.unreachableDetail;
}

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/**
 * The device list, and the two ways out of it.
 *
 * MOTION IS NEAR ZERO. Account settings is not in the budget table
 * (docs/motion-system.md §5), but the rule above it is unambiguous: motion
 * decreases when the user is doing work rather than exploring. This screen sits
 * with the creator dashboard and the campaign editor, so it gets 150ms of
 * colour on hover and nothing else — no fade-up, and no stagger on the list,
 * which §8 rules out for lists regardless.
 */
export interface SessionsPanelProps {
  /** Every word this panel and its rows draw, resolved on the server — #80. */
  readonly copy: SessionsPanelCopy;
}

export function SessionsPanel({ copy }: SessionsPanelProps) {
  const locale = useRouteLocale();

  /*
   * "3 devices", in the reader's language. A plural rather than a ternary on `=== 1`:
   * Russian picks between three forms by the last digit, so a singular/plural split is wrong
   * for most numbers in one of the four languages and nothing on screen would say so.
   */
  const devices = (count: number): string => pluralise(locale, copy.devices, count);
  const [status, setStatus] = useState<Status>('loading');
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [now, setNow] = useState<Date>(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [endingOthers, setEndingOthers] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const others = sessions.filter((session) => !session.current);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const live = await listSessions(signal);
      if (signal?.aborted) return;

      setSessions(live);
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

  function markBusy(id: string, busy: boolean): void {
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * Signing out of the device you are on.
   *
   * `DELETE /v1/auth/sessions/{own id}` succeeds, but it does not clear the
   * refresh cookie — the browser would keep a credential that works until the
   * next refresh fails. `POST /v1/auth/logout` is the endpoint that actually
   * ends it, so that is the one this takes.
   */
  async function endThisDevice(session: SessionSummary): Promise<void> {
    markBusy(session.id, true);
    setError(null);
    try {
      await endThisSession();
      setStatus('signed-out');
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      markBusy(session.id, false);
    }
  }

  async function endOneDevice(session: SessionSummary): Promise<void> {
    if (session.current) return endThisDevice(session);

    const name = deviceNameOf(session, copy.row);
    markBusy(session.id, true);
    setError(null);

    try {
      // A 404 means it was already gone, which is the state the user asked for.
      await revokeSession(session.id);
      setSessions((previous) => previous.filter((row) => row.id !== session.id));
      setNotice(fillPlaceholders(copy.signedOutDevice, { name }));

      /*
       * The button that started this has just been removed from the document.
       * Left alone, focus falls to <body> and a keyboard user is dropped at the
       * top of the page — so it moves to the heading of the list instead, which
       * is the nearest thing that still exists and says where they are.
       */
      headingRef.current?.focus();
    } catch (cause) {
      setError(messageFor(cause, copy));
    } finally {
      markBusy(session.id, false);
    }
  }

  /**
   * There is no batch endpoint, so this is one request per device.
   *
   * `allSettled` rather than `all`: one refusal must not hide the sign-outs that
   * did work, and the list is reloaded afterwards so what is on screen is what
   * the service actually holds rather than what this function hoped for.
   */
  async function endOtherDevices(): Promise<void> {
    const targets = others;
    setEndingOthers(true);
    setError(null);

    const results = await Promise.allSettled(targets.map((row) => revokeSession(row.id)));
    const failures = results.filter((result) => result.status === 'rejected').length;

    setEndingOthers(false);
    setConfirmOpen(false);

    // Reload before reporting, not after. `load` clears the last error on
    // success, so an outcome written first would be wiped by the refresh that
    // was meant to confirm it.
    await load();

    if (failures === 0) {
      setNotice(fillPlaceholders(copy.signedOutDevices, { devices: devices(targets.length) }));
    } else {
      setNotice(null);
      setError(
        fillPlaceholders(copy.signedOutPartly, {
          done: devices(targets.length - failures),
          failed: devices(failures),
        }),
      );
    }

    headingRef.current?.focus();
  }

  if (status === 'signed-out') {
    return (
      <InlineAlert variant="info" title={copy.signedOutTitle}>
        {copy.signedOutBody}
      </InlineAlert>
    );
  }

  return (
    <section aria-labelledby="devices-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="devices-heading"
          ref={headingRef}
          // Focus target for a row that removes its own button. Not in the tab
          // order — `-1` makes it reachable by script only.
          tabIndex={-1}
          className="text-lg font-medium tracking-[-0.02em] text-white"
        >
          {copy.heading}
          {status === 'ready' && (
            <span className="ml-2 text-xs font-normal text-white/40">{sessions.length}</span>
          )}
        </h2>

        {others.length > 0 && (
          <Pill variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
            {copy.signOutEverywhere}
          </Pill>
        )}
      </div>

      {/*
        Present from the first render so the live region is registered before
        anything is put in it — a region created and filled in the same commit is
        not reliably announced. `polite` because nothing here interrupts.
      */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice && (
          <InlineAlert variant="success" className="mt-4">
            {notice}
          </InlineAlert>
        )}
      </div>

      {/* `InlineAlert` carries `role="alert"` for danger — it must interrupt. */}
      {error && (
        <InlineAlert variant="danger" title={copy.errorTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}

      {status === 'loading' && (
        <SkeletonGroup label={copy.loading} className="mt-4">
          <div className="divide-y divide-white/6 overflow-hidden rounded-lg border border-white/8 bg-surface-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-start gap-4 px-5 py-4">
                <Skeleton height="2.25rem" width="2.25rem" className="rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton height="1rem" width="40%" />
                  <Skeleton height="0.875rem" width="65%" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonGroup>
      )}

      {status === 'ready' && sessions.length === 0 && (
        <EmptyState
          className="mt-4"
          title={copy.emptyTitle}
          description={copy.emptyBody}
        />
      )}

      {status === 'ready' && sessions.length > 0 && (
        <ul className="mt-4 divide-y divide-white/6 overflow-hidden rounded-lg border border-white/8 bg-surface-2">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              now={now}
              locale={locale}
              copy={copy.row}
              busy={busyIds.has(session.id)}
              onSignOut={(row) => void endOneDevice(row)}
            />
          ))}
        </ul>
      )}

      {status === 'failed' && (
        <Pill variant="ghost" size="sm" className="mt-4" onClick={() => void load()}>
          {copy.tryAgain}
        </Pill>
      )}

      {/*
        Backdrop dismissal is off because the user has to make a choice here
        (docs/ui-kit.md §7.14). Escape stays on — cancelling IS one of the two
        choices, and taking the key away only costs keyboard users.
      */}
      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        size="sm"
        title={copy.confirmTitle}
        description={fillPlaceholders(copy.confirmDescription, {
          devices: devices(others.length),
        })}
        closeOnBackdropClick={false}
        showClose={false}
        footer={
          <>
            <Pill variant="ghost" disabled={endingOthers} onClick={() => setConfirmOpen(false)}>
              {copy.cancel}
            </Pill>
            <Pill variant="danger" disabled={endingOthers} onClick={() => void endOtherDevices()}>
              {endingOthers
                ? copy.signingOutAll
                : fillPlaceholders(copy.signOutCount, { devices: devices(others.length) })}
            </Pill>
          </>
        }
      >
        {copy.confirmBody}
      </Modal>
    </section>
  );
}
