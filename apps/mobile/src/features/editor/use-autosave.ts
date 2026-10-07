import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  autosaveReducer,
  canStart,
  initialAutosave,
  isPending,
  unsavedPatch,
  type AutosaveEvent,
  type AutosaveMachine,
  type SaveFailure,
  type SaveState,
} from '@ideanest/campaign-editor/autosave';
import type { KeyValueStore } from '../../lib/storage';
import { readUnsent, writeUnsent, type UnsentChange } from '../../lib/unsent-edits';

/**
 * Autosave on a phone — the web's `useAutosave`, plus what a phone adds (#162).
 *
 * <h2>The rules are not here</h2>
 *
 * The pending patch, the merge of what is typed while a request is in the air, the single request
 * and the failed patch kept for a lossless retry are `@ideanest/campaign-editor/autosave`'s state
 * machine, shared with the web. This is the wiring: an 800ms debounce, the send, and the state the
 * indicator renders from. The machine is held in a ref (every transition must see the one before
 * it synchronously) and mirrored into state for the render.
 *
 * <h2>What the phone adds</h2>
 *
 * <ul>
 *   <li><strong>Background.</strong> `AppState` going `background` or `inactive` flushes: the OS
 *       may not bring the app back.</li>
 *   <li><strong>The unsent patch is kept on the phone</strong> (`persist`): after every transition,
 *       whatever the service has not acknowledged is written to MMKV, synchronously. On the next
 *       mount it comes back as {@link Autosave.unsent} — an OFFER. It is never sent on its own,
 *       because the service's copy may have moved on; `sendUnsent()` queues it (under anything
 *       typed since) and `discardUnsent()` forgets it. While an offer stands, it is kept merged
 *       under whatever is being typed now, so a second kill loses neither.</li>
 *   <li><strong>Unmount.</strong> What is queued is sent, unawaited, as on the web — and WITHOUT
 *       dispatching `start`: a `start` in a cleanup leaves the machine in flight for ever if the
 *       effect re-runs. When that send is answered, the stored copy is cleared unless something
 *       wrote it since.</li>
 * </ul>
 *
 * <p>The caller flushes on blur and on a tab switch; the hook cannot see either.
 */

export interface AutosavePersistence {
  readonly store: KeyValueStore;
  /** One per project: `unsentKeyFor(projectId)`. */
  readonly key: string;
  /** Injected for tests. */
  readonly now?: () => Date;
}

export interface AutosaveOptions<P extends object, R> {
  readonly send: (patch: P) => Promise<R>;
  /** The server's answer, which is the authority on what the project now is. */
  readonly onSaved?: (result: R) => void;
  /** A refusal in the creator's words (`describeSaveFailure`). */
  readonly describe: (cause: unknown) => SaveFailure;
  /** How long the creator has to stop typing before a request goes out. 800 by default. */
  readonly delayMs?: number;
  /** Where the unsent patch survives the app being killed. Omit to keep nothing. */
  readonly persist?: AutosavePersistence;
}

export interface Autosave<P> {
  readonly state: SaveState;
  readonly failure: SaveFailure | null;
  /** True while something typed has not yet been acknowledged by the server. */
  readonly pending: boolean;
  /** Queue a partial change. Debounced, and merged with anything still waiting. */
  readonly save: (patch: P) => void;
  /** Send now — on blur, on a tab switch, before leaving. */
  readonly flush: () => void;
  /** Send the same pending patch again, after a failure. */
  readonly retry: () => void;
  /** A change left unsent by an earlier launch, offered and never sent on its own. */
  readonly unsent: UnsentChange<P> | null;
  /** Queue the offered change (under anything typed since) and send it. Returns what was queued. */
  readonly sendUnsent: () => P | null;
  /** Forget the offered change. */
  readonly discardUnsent: () => void;
}

const DEFAULT_DELAY_MS = 800;

export function useAutosave<P extends object, R>({
  send,
  onSaved,
  describe,
  delayMs = DEFAULT_DELAY_MS,
  persist,
}: AutosaveOptions<P, R>): Autosave<P> {
  const [view, setView] = useState<AutosaveMachine<P>>(initialAutosave);
  const machine = useRef(view);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read through refs, so a caller passing inline functions does not reset the debounce.
  const sendRef = useRef(send);
  const onSavedRef = useRef(onSaved);
  const describeRef = useRef(describe);
  const persistRef = useRef(persist);
  useEffect(() => {
    sendRef.current = send;
    onSavedRef.current = onSaved;
    describeRef.current = describe;
    persistRef.current = persist;
  }, [send, onSaved, describe, persist]);

  const [unsent, setUnsent] = useState<UnsentChange<P> | null>(() =>
    persist === undefined ? null : readUnsent<P>(persist.store, persist.key),
  );
  const offered = useRef(unsent);
  /** When the newest change still unsent was typed. */
  const changedAt = useRef<string | null>(null);

  const keep = useCallback((next: AutosaveMachine<P>): void => {
    const target = persistRef.current;
    if (target === undefined) return;
    const current = unsavedPatch(next) as P | null;
    const offer = offered.current;
    let change: UnsentChange<P> | null = null;
    if (current !== null) {
      change = {
        patch: offer === null ? current : { ...offer.patch, ...current },
        at: changedAt.current ?? (target.now ?? (() => new Date()))().toISOString(),
      };
    } else if (offer !== null) {
      change = offer;
    }
    writeUnsent(target.store, target.key, change);
  }, []);

  const apply = useCallback(
    (event: AutosaveEvent<P>): AutosaveMachine<P> => {
      const next = autosaveReducer(machine.current, event);
      if (next === machine.current) return next;
      machine.current = next;
      setView(next);
      if (unsavedPatch(next) === null) changedAt.current = null;
      keep(next);
      return next;
    },
    [keep],
  );

  const run = useCallback((): void => {
    if (!canStart(machine.current)) return;
    const patch = apply({ type: 'start' }).inFlight;
    if (patch === null) return;

    void sendRef.current(patch as P).then(
      (result) => {
        apply({ type: 'succeeded' });
        onSavedRef.current?.(result);
        // Anything typed while that was in the air goes now; nothing happens when nothing is queued.
        run();
      },
      (cause: unknown) => {
        apply({ type: 'failed', failure: describeRef.current(cause) });
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
      const now = persistRef.current?.now ?? (() => new Date());
      changedAt.current = now().toISOString();
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

  const sendUnsent = useCallback((): P | null => {
    const offer = offered.current;
    if (offer === null) return null;
    offered.current = null;
    setUnsent(null);
    changedAt.current = changedAt.current ?? offer.at;
    // Under what is typed now: the newer value of a field wins, as it does everywhere else.
    const patch = { ...offer.patch, ...(unsavedPatch(machine.current) ?? {}) } as P;
    apply({ type: 'queue', patch });
    flush();
    return patch;
  }, [apply, flush]);

  const discardUnsent = useCallback((): void => {
    if (offered.current === null) return;
    offered.current = null;
    setUnsent(null);
    keep(machine.current);
  }, [keep]);

  // The phone going to the background is the last moment the app is sure to be running.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') flushRef.current();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      /*
       * Leaving must not discard the last second of typing. Sent unawaited, and NOT through
       * `start`: the queue is taken by hand, so an effect that runs again finds a machine that is
       * not stuck in flight. A merge patch arriving twice is the same as arriving once.
       */
      const { queued } = machine.current;
      if (queued === null || machine.current.inFlight !== null) return;
      machine.current = { ...machine.current, queued: null };
      const target = persistRef.current;
      const written = target?.store.getString(target.key);
      void sendRef.current(queued as P).then(
        () => {
          // Accepted. Unless a later screen has written since, only an offer is left to keep.
          if (target !== undefined && target.store.getString(target.key) === written) {
            writeUnsent(target.store, target.key, offered.current);
          }
        },
        () => {
          // Nothing is left to report it to; the stored copy stays and is offered next time.
        },
      );
    };
  }, []);

  return useMemo(
    () => ({
      state: view.status,
      failure: view.failure,
      pending: isPending(view),
      save,
      flush,
      retry,
      unsent,
      sendUnsent,
      discardUnsent,
    }),
    [view, save, flush, retry, unsent, sendUnsent, discardUnsent],
  );
}
