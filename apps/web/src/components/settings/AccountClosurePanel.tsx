'use client';

import { useState, type FormEvent } from 'react';
import { Checkbox, Field, InlineAlert, Pill, TextInput } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { cancelDeletion, requestDeletion } from '../../lib/account/closure';
import { formatExactTime } from '../../lib/time';
import { useSession } from '../session/SessionProvider';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { AccountClosurePanelCopy } from '../../lib/i18n/settings-copy';
import { fillNodes } from '../../lib/i18n/placeholders';

/**
 * §4.1's A-10 — closing an account, with the thirty-day delay made explicit before it is
 * accepted. Issue #279.
 *
 * <h2>The delay is stated as a date, not as an interval</h2>
 *
 * `AccountDeletionController` returns `scheduledFor` for a reason it gives in one sentence:
 * "a confirmation the user cannot check is not a confirmation". So the screen prints the date
 * the account is anonymised rather than the phrase "in thirty days", which is a promise about
 * arithmetic nobody can verify — and which is wrong the moment §17.4's window is configured
 * differently.
 *
 * <h2>The pending state is readable, and it is the one thing `GET /v1/me` does tell us</h2>
 *
 * `Session.deletionScheduledAt` exists precisely so a client cannot leave somebody assuming a
 * deletion silently failed. An account inside the grace period can still sign in, so a panel
 * that showed nothing would show a working account with a closure running underneath it.
 *
 * <h2>Cancelling costs nothing, and the asymmetry is deliberate</h2>
 *
 * Closing takes the password; withdrawing takes only the session. The controller's own note:
 * the person who requested the deletion needed the password to do it, so requiring it again
 * "would only obstruct the victim of a deletion they did not ask for". This panel keeps that
 * shape rather than making both sides symmetrical for tidiness.
 *
 * <h2>The confirmation is a checkbox, not a typed phrase</h2>
 *
 * Typing DELETE is a ritual that measures how well somebody can copy a word. What actually
 * has to be understood here is the consequence, so the checkbox restates it — the campaigns,
 * the pledges, the date — and the control stays inert until it is ticked.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5. The confirmation appears outright; a destructive action that
 * animates is one somebody is still watching when they press it.
 */
export interface AccountClosurePanelProps {
  /** Every word this panel draws, resolved on the server — #80. */
  readonly copy: AccountClosurePanelCopy;
}

export function AccountClosurePanel({ copy }: AccountClosurePanelProps) {
  const locale = useRouteLocale();
  const { session, refresh } = useSession();

  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  const scheduledFor = session?.deletionScheduledAt ?? null;

  function describe(cause: unknown): string {
    if (cause instanceof ApiError) {
      if (cause.status === 429) {
        return cause.problem?.detail ?? copy.rateLimited;
      }
      return cause.problem?.detail ?? cause.problem?.title ?? copy.failures.refusedDetail;
    }
    return copy.failures.unreachableDetail;
  }

  async function close(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !understood || password === '') return;

    setBusy(true);
    setError(null);
    try {
      const outcome = await requestDeletion(password);
      setPassword('');

      if (outcome.kind === 'already-gone') {
        /*
         * A genuine token for an account that is not there. Nothing was closed and nothing
         * can be — saying "done" would be reporting a deletion that did not happen.
         */
        setGone(true);
        return;
      }

      /*
       * The session carries `deletionScheduledAt`, so re-reading it is what moves this panel
       * into its pending state. Holding the schedule in local state instead would leave every
       * other screen — and this one after a reload — believing nothing had happened.
       */
      await refresh();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await cancelDeletion();
      await refresh();
      setUnderstood(false);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border-l-2 border-danger border-y border-r border-y-white/8 border-r-white/8 bg-surface-2 p-6 sm:p-8">
      {/*
        §8.1's "payment failed" treatment, borrowed for the one other place on the platform
        where a destructive state has to be legible at a glance: `--surface-2` with a
        `--danger` left rule. Not a red panel — §9.2 forbids colour as the only carrier, and
        the heading and the button say what this is.
      */}
      <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{copy.heading}</h2>

      {error !== null && (
        <div className="mt-5">
          <InlineAlert variant="danger" title={copy.failures.refusedTitle}>
            <p>{error}</p>
          </InlineAlert>
        </div>
      )}

      {gone && (
        <div className="mt-5">
          <InlineAlert variant="warning" title={copy.goneTitle}>
            <p>{copy.goneBody}</p>
          </InlineAlert>
        </div>
      )}

      {scheduledFor !== null ? (
        <div className="mt-4 flex flex-col gap-6">
          <InlineAlert variant="warning" title={copy.scheduledTitle}>
            <p>
              {/*
                The date is an element rather than a string, so the sentence is filled with
                nodes: where the date falls in it is exactly what a translation may change.
              */}
              {fillNodes(copy.scheduledBody, {
                date: (
                  <strong className="font-medium text-white">
                    {formatExactTime(scheduledFor, locale)}
                  </strong>
                ),
              })}
            </p>
          </InlineAlert>

          <div>
            <Pill type="button" disabled={busy} onClick={() => void withdraw()}>
              {busy ? copy.cancelling : copy.keep}
            </Pill>
          </div>
        </div>
      ) : (
        <form onSubmit={close} noValidate className="mt-4 flex max-w-[34rem] flex-col gap-5">
          <div className="text-[15px] leading-relaxed text-white/64">
            <p>{copy.notImmediate}</p>
            <p className="mt-3">{copy.recordsKept}</p>
          </div>

          <Field label={copy.currentPassword} required>
            <TextInput
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Checkbox
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
            label={copy.understood}
          />

          <div>
            <Pill type="submit" variant="danger" disabled={busy || !understood}>
              {busy ? copy.scheduling : copy.close}
            </Pill>
          </div>
        </form>
      )}
    </section>
  );
}
