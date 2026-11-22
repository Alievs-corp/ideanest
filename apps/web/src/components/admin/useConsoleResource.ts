'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import type { ConsoleRefusalsCopy } from '../../lib/i18n/admin/common-copy';

/**
 * The load-and-refuse dance every console screen does, written once — issues #295 to #316.
 *
 * <h2>Why this exists now and did not before</h2>
 *
 * The nine screens of the first half of this epic each wrote out the same effect by hand:
 * open an `AbortController`, set `loading`, await a read, bail if aborted, branch the
 * failure into `signed-out` / `forbidden` / `failed`, and abort on cleanup. That was
 * defensible at nine — `lib/admin/refusals.ts` already argued that nine near-identical
 * `messageFor` functions was the point at which the eighth copy is the one somebody forgets
 * to update.
 *
 * This epic's second half adds twelve more. Twenty-one hand-written copies of an effect
 * whose subtle part is "an abort is not a failure" is twenty-one chances to paint
 * "something went wrong" over a screen that is loading correctly.
 *
 * <h2>What it deliberately does not do</h2>
 *
 * **It does not cache, dedupe, or retry.** Every one of those would be a policy applied to
 * screens that read different things for different reasons — a stale ledger and a stale
 * queue depth are not equally harmless — and this file has no way to tell them apart. It is
 * the effect, not a data layer.
 *
 * **It does not own mutations.** A screen that grants a role or issues a refund calls the
 * client directly and decides for itself what to do with the result, because the interesting
 * part of a write is always the part that is specific to it.
 */
export interface ConsoleResource<T> {
  readonly status: ConsoleStatus;
  /** Null until the first successful read. Kept across a reload, so a refresh does not blank the screen. */
  readonly data: T | null;
  /** Set only when {@link status} is `failed`. The two refusals render through `ConsoleRefusal`. */
  readonly error: string | null;
  /**
   * The capability the 403 named, when it named one — #295's `meta.capability`, and #400.
   *
   * <p>Null for everything else, including the 403 that is about standing. Handed to
   * `ConsoleRefusal` beside the status, because the status alone cannot tell the two
   * refusals apart and rendering the wrong one tells a colleague they do not work here.
   */
  readonly capability: string | null;
  /** Reads again. Also what a "try again" control calls. */
  readonly reload: () => void;
  /**
   * Replaces what is held without a request.
   *
   * For the screens whose writes answer with the new state — granting a role, resolving a
   * dispute — so that the row updates without a second round trip that could disagree with
   * the response the reader just caused.
   *
   * <p>Takes an updater as well as a value, as `setState` does. A screen whose rows are decided
   * one after another must use it: a value computed from the `data` of the render that started
   * the request is the list as it was then, and writing it back resurrects every row decided
   * since. Nothing is held yet, an updater is not called.
   */
  readonly set: (next: T | ((previous: T) => T)) => void;
}

/**
 * Reads something for a console screen.
 *
 * @param read the client call. **Must take the signal and pass it to `fetch`**, or a filter
 *     change will leave the previous request running and racing the new one
 * @param subject what the reader was trying to read, in the screen's own words — "the payout
 *     queue" — and in the reader's language since #324. Interpolated into the failure message
 * @param refusals the console's refusal table, resolved on the server by the route and handed
 *     down. Not in the effect's dependencies: it is one object per render of a server
 *     component, so it changes when the language does and the language changes the route
 * @param dependencies what a change should reload on, exactly as `useEffect` takes them. A
 *     filter, a page number, an identifier
 */
export function useConsoleResource<T>(
  read: (signal: AbortSignal) => Promise<T>,
  subject: string,
  refusals: ConsoleRefusalsCopy,
  dependencies: readonly unknown[],
): ConsoleResource<T> {
  const [status, setStatus] = useState<ConsoleStatus>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capability, setCapability] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus('loading');
      try {
        const result = await read(controller.signal);
        if (controller.signal.aborted) return;

        setData(result);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        // Two checks, not one. The signal covers the abort this effect caused; `wasAborted`
        // covers an `AbortError` that arrived from somewhere else — a navigation, a closed
        // tab — and painting an error over either is painting one over a screen that is
        // behaving correctly.
        if (controller.signal.aborted || wasAborted(cause)) return;

        const next = statusFor(cause);
        setError(next === 'failed' ? consoleMessageFor(cause, subject, refusals) : null);
        setCapability(requiredCapabilityFrom(cause));
        setStatus(next);
      }
    }

    void load();
    return () => controller.abort();
    // `read` is intentionally not a dependency: every caller passes an inline closure, so
    // including it would re-run the effect on every render. The caller states what a change
    // means by naming it in `dependencies`, which is the same contract `useEffect` has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, subject, ...dependencies]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const set = useCallback(
    (next: T | ((previous: T) => T)) =>
      setData((previous) => {
        if (!isUpdater(next)) return next;
        return previous === null ? null : next(previous);
      }),
    [],
  );

  return { status, data, error, capability, reload, set };
}

/** Whether `set` was handed an updater. Data held here is never itself a function. */
function isUpdater<T>(next: T | ((previous: T) => T)): next is (previous: T) => T {
  return typeof next === 'function';
}
