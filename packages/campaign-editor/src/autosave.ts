/**
 * Autosave, per the epic contract §6, as a state machine with no clock and no framework in it.
 *
 * The rules: debounced, one request in flight at a time, a visible state, and a retry that
 * never loses what was typed. Each client owns the wiring — the web's `useAutosave` hook holds
 * the timer and the React state, the app adds its own triggers (the app going to the
 * background, a tab switch) — and both drive the transitions below, so the guarantees are
 * written once (#162).
 *
 * THE PENDING PATCH IS ONLY CLEARED BY A SUCCESSFUL RESPONSE. A failed save that dropped its
 * body would leave the creator looking at a title the service has never heard of, and they
 * would only find out when the campaign went live with the old one.
 *
 * ONE REQUEST AT A TIME, because these are merge patches and the server applies them in the
 * order it receives them. Two overlapping saves can be answered out of order, and the older
 * body wins — which on a title field means a keystroke travelling backwards in time. Anything
 * queued while a request is in flight merges into the next one instead.
 *
 * Every transition is pure: it returns a new machine and never mutates the one it was given,
 * and an event that does not apply returns the same object, so a caller can tell "nothing
 * happened" by identity.
 */

/** What the save indicator shows. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** A failed save, put into words a creator can act on. */
export interface SaveFailure {
  /** A sentence to show the creator. The server's, when the server wrote one. */
  message: string;
  /** Field name to message, from a validation failure's problem details. */
  fieldErrors: Readonly<Record<string, string>>;
  status: number | null;
  /** The machine-readable reason, e.g. `PROJECT_TRANSITION_NOT_ALLOWED`. */
  code: string | null;
  /**
   * Reason-specific context, keyed by `code` (docs/architecture.md §10.4).
   *
   * Carried through rather than dropped because some refusals cannot be placed without it.
   * `STORY_DOCUMENT_INVALID` puts `blocks[7].alt` in `meta.path`, and a story is hundreds of
   * blocks long — a banner saying the document is invalid, without saying which block, is a
   * message a creator cannot act on.
   *
   * `Record<string, unknown>` rather than a union of every shape: each caller knows which
   * `code` it is handling and narrows what it reads.
   */
  meta: Record<string, unknown> | null;
}

/** The whole of an autosave's state. Read it; change it only through {@link autosaveReducer}. */
export interface AutosaveMachine<P> {
  status: SaveState;
  /** Merged, not yet sent. Cleared only by a send starting; restored by its failure. */
  queued: Partial<P> | null;
  /** The body of the one request in the air, or null when none is. */
  inFlight: Partial<P> | null;
  failure: SaveFailure | null;
}

export type AutosaveEvent<P> =
  /** A change was made. Merged over anything still waiting, the newer value winning. */
  | { type: 'queue'; patch: Partial<P> }
  /** Send what is queued — when the debounce elapses, on blur, or on retry. */
  | { type: 'start' }
  /** The request in flight was accepted. */
  | { type: 'succeeded' }
  /** The request in flight was refused or never arrived. */
  | { type: 'failed'; failure: SaveFailure }
  /** The creator asked to try again. Clears the failure; the caller then sends. */
  | { type: 'retry' };

/** Nothing queued, nothing in flight, nothing to report. */
export function initialAutosave<P>(): AutosaveMachine<P> {
  return { status: 'idle', queued: null, inFlight: null, failure: null };
}

/**
 * Whether something typed has not yet been acknowledged by the server.
 *
 * Derived rather than stored, so it cannot disagree with the two fields that decide it.
 */
export function isPending(machine: AutosaveMachine<unknown>): boolean {
  return machine.queued !== null || machine.inFlight !== null;
}

/** Whether a `start` would send anything: something is queued and nothing is in the air. */
export function canStart(machine: AutosaveMachine<unknown>): boolean {
  return machine.inFlight === null && machine.queued !== null;
}

/**
 * Everything not yet acknowledged, as one patch, or null.
 *
 * The body in flight under whatever was queued after it — the shape a failure would put back
 * on the queue. What a client persists when it may be killed before the answer arrives (the
 * app keeps it per project so an unsent change survives the OS closing it).
 */
export function unsavedPatch<P>(machine: AutosaveMachine<P>): Partial<P> | null {
  if (machine.inFlight === null) return machine.queued;
  return { ...machine.inFlight, ...(machine.queued ?? {}) };
}

export function autosaveReducer<P>(
  machine: AutosaveMachine<P>,
  event: AutosaveEvent<P>,
): AutosaveMachine<P> {
  switch (event.type) {
    case 'queue':
      return {
        ...machine,
        queued: { ...(machine.queued ?? {}), ...event.patch },
        /*
         * "Saving" the moment a key is pressed, before the debounce has elapsed. The
         * alternative is to leave "Saved" on screen while unsent text sits in the queue, and
         * that is the one thing an autosave indicator must never say — a creator who reads it
         * and closes the tab loses the difference.
         *
         * The failure, if there is one, stays until a save succeeds or a retry clears it.
         */
        status: 'saving',
      };

    case 'start':
      if (!canStart(machine)) return machine;
      return { ...machine, inFlight: machine.queued, queued: null, status: 'saving' };

    case 'succeeded':
      if (machine.inFlight === null) return machine;
      return {
        ...machine,
        inFlight: null,
        failure: null,
        // Something arrived while this was in the air. It still has to be sent, so this is
        // not the moment to claim everything is saved.
        status: machine.queued === null ? 'saved' : 'saving',
      };

    case 'failed':
      if (machine.inFlight === null) return machine;
      return {
        ...machine,
        /*
         * The body goes back on the queue, with anything newer winning. This is what makes
         * the retry lossless: the creator's text is still here, and it is still here after
         * the second failure too.
         */
        queued: { ...machine.inFlight, ...(machine.queued ?? {}) },
        inFlight: null,
        failure: event.failure,
        status: 'failed',
      };

    case 'retry':
      if (machine.queued === null) return machine;
      return { ...machine, failure: null };
  }
}
