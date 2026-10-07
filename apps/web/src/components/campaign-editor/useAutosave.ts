'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  autosaveReducer,
  canStart,
  initialAutosave,
  isPending,
  type AutosaveEvent,
  type AutosaveMachine,
  type SaveFailure,
  type SaveState,
} from '@ideanest/campaign-editor/autosave';
import { ApiError } from '../../lib/api/problem';

/**
 * Autosave, per the epic contract §6: debounced, one request in flight at a
 * time, a visible state, and a retry that never loses what was typed.
 *
 * THE RULES ARE NOT IN THIS FILE. The pending patch, the merge of what is typed
 * while a request is in flight, the single request and the failed patch kept for
 * a lossless retry are `@ideanest/campaign-editor/autosave`'s state machine,
 * shared with the app's editor (#162). What stays here is the wiring only a
 * React client has: the debounce timer, the state the indicator renders from,
 * and the send that fires as the component goes away.
 *
 * The machine is held in a ref rather than in state, because every transition
 * has to see the one before it synchronously — a keystroke that lands between a
 * response and the re-render it causes must merge into the queue that response
 * left, not into a stale copy. Each transition's result is also set as state,
 * which is what the indicator renders from.
 *
 * Written as a hook rather than as part of the basics form because #34, #35 and
 * #39 autosave the same way through the same endpoint. A second implementation
 * of this is a second set of these bugs.
 */

export interface Autosave<P> {
  state: SaveState;
  failure: SaveFailure | null;
  /** True while something typed has not yet been acknowledged by the server. */
  pending: boolean;
  /** Queue a partial change. Debounced, and merged with anything still waiting. */
  save: (patch: P) => void;
  /** Send now — on blur, or when the creator is about to leave. */
  flush: () => void;
  /** Send the same pending patch again, after a failure. */
  retry: () => void;
}

export interface AutosaveOptions<P, R> {
  send: (patch: P) => Promise<R>;
  /** The server's answer, which is the authority on what the project now is. */
  onSaved?: (result: R) => void;
  /** How long the creator has to stop typing before a request goes out. */
  delayMs?: number;
}

/**
 * Turns a failure into something a creator can act on.
 *
 * The service's `detail` is preferred wherever it exists, because a problem
 * detail written by the endpoint knows which of its rules was broken and this
 * function cannot. The wording below is for the cases where there is no body to
 * read, or where the status means something the creator has to be told plainly.
 */
export function describeFailure(cause: unknown): SaveFailure {
  if (cause instanceof ApiError) {
    const detail = cause.problem?.detail ?? cause.problem?.title ?? null;
    const fieldErrors = cause.problem?.errors ?? {};
    const code = cause.problem?.code ?? null;

    const message =
      detail ??
      (cause.status === 401
        ? 'You have been signed out. Sign in again — nothing you typed has been lost.'
        : cause.status === 403
          ? 'You are not allowed to edit this project.'
          : cause.status === 404
            ? 'This project no longer exists.'
            : cause.status === 409
              ? 'The project has changed since this page was opened. Reload it to see the current version.'
              : cause.status === 422 || cause.status === 400
                ? 'The service rejected the change. Check the fields marked below.'
                : 'The change could not be saved. Try again.');

    return { message, fieldErrors, status: cause.status, code, meta: cause.problem?.meta ?? null };
  }

  return {
    message: 'The service could not be reached, so nothing was saved. Try again.',
    fieldErrors: {},
    status: null,
    code: null,
    meta: null,
  };
}

export function useAutosave<P extends object, R>({
  send,
  onSaved,
  delayMs = 800,
}: AutosaveOptions<P, R>): Autosave<P> {
  /*
   * One snapshot of the machine for the render, and the ref every transition reads. A
   * transition that changes nothing returns the same object, so setting it re-renders nothing.
   */
  const [view, setView] = useState<AutosaveMachine<P>>(initialAutosave);
  const machine = useRef(view);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The callbacks are read through refs so that a caller passing an inline
  // arrow function — which is every caller — does not reset the debounce on
  // every render.
  const sendRef = useRef(send);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    sendRef.current = send;
    onSavedRef.current = onSaved;
  }, [send, onSaved]);

  const apply = useCallback((event: AutosaveEvent<P>): AutosaveMachine<P> => {
    const next = autosaveReducer(machine.current, event);
    machine.current = next;
    setView(next);
    return next;
  }, []);

  const run = useCallback((): void => {
    if (!canStart(machine.current)) return;

    const patch = apply({ type: 'start' }).inFlight;
    if (patch === null) return;

    void sendRef.current(patch as P).then(
      (result) => {
        apply({ type: 'succeeded' });
        onSavedRef.current?.(result);

        // Something arrived while this was in the air. Send it rather than
        // claiming everything is saved; `run` does nothing when nothing is queued.
        run();
      },
      (cause: unknown) => {
        apply({ type: 'failed', failure: describeFailure(cause) });
      },
    );
  }, [apply]);

  const schedule = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      run();
    }, delayMs);
  }, [delayMs, run]);

  const save = useCallback(
    (patch: P): void => {
      apply({ type: 'queue', patch });
      schedule();
    },
    [apply, schedule],
  );

  const flush = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    run();
  }, [run]);

  const retry = useCallback((): void => {
    if (machine.current.queued === null) return;
    apply({ type: 'retry' });
    flush();
  }, [apply, flush]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);

      /*
       * Leaving the tab must not discard the last few seconds of typing. The
       * request is fired without being awaited — the component is going away and
       * has nowhere to put the answer — and it is a merge patch, so arriving
       * twice is the same as arriving once.
       */
      if (canStart(machine.current)) {
        machine.current = autosaveReducer(machine.current, { type: 'start' });
        const patch = machine.current.inFlight;
        if (patch === null) return;
        void sendRef.current(patch as P).catch(() => {
          // Nothing is left to report it to. The next load reads the server's
          // version, which is the truth either way.
        });
      }
    };
  }, []);

  return { state: view.status, failure: view.failure, pending: isPending(view), save, flush, retry };
}
