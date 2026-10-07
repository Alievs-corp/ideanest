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
 *   <li><strong>The unsent patch is kept on the phone</strong> (`persist`): whatever the service has
 *       not acknowledged is written to MMKV. A keystroke's write waits {@link PERSIST_DELAY_MS}
 *       (Story pushes whole documents through here, and serialising one per keystroke is work the
 *       typing pays for); every other transition writes at once, and so do the app going to the
 *       background and the hook unmounting, which is when the OS kills an app. On the next mount
 *       it comes back as {@link Autosave.unsent} — an OFFER, never sent on its own, because the
 *       service's copy may have moved on. A field typed again this session drops out of the offer,
 *       so "Send it" can never put an older value over a newer one.</li>
 *   <li><strong>Unmount.</strong> What is queued is sent, unawaited, as on the web — and WITHOUT
 *       dispatching `start`: a `start` in a cleanup leaves the machine in flight for ever if the
 *       effect re-runs. Its answer still reaches `onSaved`, so the cache is current the next time
 *       the editor opens.</li>
 *   <li><strong>`active`.</strong> False once the session has ended: the machine is reset, nothing
 *       queued is sent or written, and an answer still in the air is ignored — one account's words
 *       are never stored again after its sign-out erased them, nor sent with somebody else's
 *       token.</li>
 * </ul>
 *
 * <p>The caller flushes on blur and on a tab switch; the hook cannot see either.
 */

/** How long a keystroke's unsent patch waits before it is written to MMKV. */
export const PERSIST_DELAY_MS = 400;

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
  /** False once the session has ended: reset, and never send or store again. True by default. */
  readonly active?: boolean;
}

export interface Autosave<P> {
  readonly state: SaveState;
  readonly failure: SaveFailure | null;
  /** True while something typed has not yet been acknowledged by the server. */
  readonly pending: boolean;
  /**
   * Everything typed and not yet acknowledged, as one patch (in flight under queued), or null.
   * Overlay it on the server's project to seed a form that is mounted again (`withUnsaved`).
   */
  readonly unsaved: P | null;
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

/** `patch` without the keys in `drop`, or null when nothing is left. */
function without<P extends object>(patch: P, drop: readonly string[]): P | null {
  const rest = Object.fromEntries(Object.entries(patch).filter(([key]) => !drop.includes(key)));
  return Object.keys(rest).length === 0 ? null : (rest as P);
}

export function useAutosave<P extends object, R>({
  send,
  onSaved,
  describe,
  delayMs = DEFAULT_DELAY_MS,
  persist,
  active = true,
}: AutosaveOptions<P, R>): Autosave<P> {
  const [view, setView] = useState<AutosaveMachine<P>>(initialAutosave);
  const machine = useRef(view);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read through refs, so a caller passing inline functions does not reset the debounce.
  const sendRef = useRef(send);
  const onSavedRef = useRef(onSaved);
  const describeRef = useRef(describe);
  const persistRef = useRef(persist);
  const activeRef = useRef(active);
  useEffect(() => {
    sendRef.current = send;
    onSavedRef.current = onSaved;
    describeRef.current = describe;
    persistRef.current = persist;
  }, [send, onSaved, describe, persist]);

  /** Bumped when the session ends: an answer from an earlier epoch is ignored. */
  const epoch = useRef(0);

  const [unsent, setUnsent] = useState<UnsentChange<P> | null>(() =>
    persist === undefined || !active ? null : readUnsent<P>(persist.store, persist.key),
  );
  const offered = useRef(unsent);
  /** When the newest change still unsent was typed. */
  const changedAt = useRef<string | null>(null);

  const setOffer = useCallback((next: UnsentChange<P> | null): void => {
    offered.current = next;
    setUnsent(next);
  }, []);

  /** Write what is unsent to the phone now. */
  const writeNow = useCallback((): void => {
    if (writeTimer.current !== null) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    const target = persistRef.current;
    if (target === undefined || !activeRef.current) return;
    const current = unsavedPatch(machine.current) as P | null;
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

  /** Write soon: a keystroke's write waits for the typing to pause. */
  const writeSoon = useCallback((): void => {
    if (persistRef.current === undefined || !activeRef.current) return;
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      writeTimer.current = null;
      writeNow();
    }, PERSIST_DELAY_MS);
  }, [writeNow]);

  const apply = useCallback(
    (event: AutosaveEvent<P>): AutosaveMachine<P> => {
      const next = autosaveReducer(machine.current, event);
      if (next === machine.current) return next;
      machine.current = next;
      setView(next);
      if (unsavedPatch(next) === null) changedAt.current = null;
      if (event.type === 'queue') writeSoon();
      else writeNow();
      return next;
    },
    [writeNow, writeSoon],
  );

  const run = useCallback((): void => {
    if (!activeRef.current || !canStart(machine.current)) return;
    const patch = apply({ type: 'start' }).inFlight;
    if (patch === null) return;
    const sentIn = epoch.current;

    void sendRef.current(patch as P).then(
      (result) => {
        if (epoch.current !== sentIn) return;
        apply({ type: 'succeeded' });
        onSavedRef.current?.(result);
        // Anything typed while that was in the air goes now; nothing happens when nothing is queued.
        run();
      },
      (cause: unknown) => {
        if (epoch.current !== sentIn) return;
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
      if (!activeRef.current) return;
      const now = persistRef.current?.now ?? (() => new Date());
      changedAt.current = now().toISOString();
      // A field typed again this session is newer than anything an earlier launch left unsent.
      const offer = offered.current;
      if (offer !== null) {
        const rest = without(offer.patch, Object.keys(patch));
        setOffer(rest === null ? null : { ...offer, patch: rest });
      }
      apply({ type: 'queue', patch });
      schedule();
    },
    [apply, schedule, setOffer],
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
    if (offer === null || !activeRef.current) return null;
    setOffer(null);
    changedAt.current = changedAt.current ?? offer.at;
    // Under what is typed now: the newer value of a field wins, as it does everywhere else.
    const patch = { ...offer.patch, ...(unsavedPatch(machine.current) ?? {}) } as P;
    apply({ type: 'queue', patch });
    flush();
    return patch;
  }, [apply, flush, setOffer]);

  const discardUnsent = useCallback((): void => {
    if (offered.current === null) return;
    setOffer(null);
    writeNow();
  }, [setOffer, writeNow]);

  // The session ending stops everything: nothing queued is sent, stored, or answered.
  useEffect(() => {
    activeRef.current = active;
    if (active) return;
    epoch.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    timer.current = null;
    writeTimer.current = null;
    changedAt.current = null;
    const reset = initialAutosave<P>();
    machine.current = reset;
    setView(reset);
    setOffer(null);
  }, [active, setOffer]);

  // The phone going to the background is the last moment the app is sure to be running.
  const flushRef = useRef(flush);
  const writeNowRef = useRef(writeNow);
  useEffect(() => {
    flushRef.current = flush;
    writeNowRef.current = writeNow;
  }, [flush, writeNow]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        writeNowRef.current();
        flushRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (!activeRef.current) return;
      // A kill after leaving the editor must still find what was not acknowledged.
      writeNowRef.current();
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
      const sentIn = epoch.current;
      void sendRef.current(queued as P).then(
        (result) => {
          if (epoch.current !== sentIn || !activeRef.current) return;
          // The cache takes the answer, so reopening the editor shows what was just saved.
          onSavedRef.current?.(result);
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
      unsaved: unsavedPatch(view) as P | null,
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
