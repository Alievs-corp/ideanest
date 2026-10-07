import { describe, expect, it } from 'vitest';
import {
  autosaveReducer,
  canStart,
  initialAutosave,
  isPending,
  unsavedPatch,
  type AutosaveEvent,
  type AutosaveMachine,
  type SaveFailure,
} from './autosave';

/**
 * The autosave contract (epic §6) as transitions, without a clock or a framework.
 *
 * The web's `useAutosave.test.tsx` drives the same rules through the hook with fake timers;
 * these pin the machine both clients share, so the app's editor inherits the guarantees
 * rather than re-deriving them: one request in flight, what is typed meanwhile merged into the
 * next, and a failed body kept — under anything newer — for a lossless retry.
 */

interface Patch {
  title?: string;
  blurb?: string;
}

const FAILURE: SaveFailure = {
  message: 'The change could not be saved. Try again.',
  fieldErrors: {},
  status: 500,
  code: null,
  meta: null,
};

function run(...events: AutosaveEvent<Patch>[]): AutosaveMachine<Patch> {
  return events.reduce(autosaveReducer, initialAutosave<Patch>());
}

describe('autosaveReducer', () => {
  it('starts idle, with nothing pending', () => {
    const machine = initialAutosave<Patch>();
    expect(machine).toEqual({ status: 'idle', queued: null, inFlight: null, failure: null });
    expect(isPending(machine)).toBe(false);
    expect(canStart(machine)).toBe(false);
  });

  it('says "saving" from the first change, before anything is sent', () => {
    const machine = run({ type: 'queue', patch: { title: 'One' } });
    // "Saved" while unsent text is queued is the one lie the indicator must never tell.
    expect(machine.status).toBe('saving');
    expect(isPending(machine)).toBe(true);
    expect(machine.inFlight).toBeNull();
  });

  it('merges every change into one patch, the latest value per field winning', () => {
    const machine = run(
      { type: 'queue', patch: { title: 'One' } },
      { type: 'queue', patch: { title: 'Two' } },
      { type: 'queue', patch: { blurb: 'A summary' } },
    );
    expect(machine.queued).toEqual({ title: 'Two', blurb: 'A summary' });
  });

  it('moves the queue into flight on start', () => {
    const machine = run({ type: 'queue', patch: { title: 'One' } }, { type: 'start' });
    expect(machine.inFlight).toEqual({ title: 'One' });
    expect(machine.queued).toBeNull();
    expect(machine.status).toBe('saving');
    expect(isPending(machine)).toBe(true);
  });

  it('does nothing on start when nothing is queued', () => {
    const machine = initialAutosave<Patch>();
    expect(autosaveReducer(machine, { type: 'start' })).toBe(machine);
  });

  /*
   * Merge patches are applied in the order the server receives them, and two overlapping
   * requests can be answered out of order — a keystroke travelling backwards.
   */
  it('never puts a second request in flight, and queues what is typed meanwhile', () => {
    const flying = run(
      { type: 'queue', patch: { title: 'One' } },
      { type: 'start' },
      { type: 'queue', patch: { title: 'Two' } },
    );
    expect(canStart(flying)).toBe(false);
    expect(autosaveReducer(flying, { type: 'start' })).toBe(flying);
    expect(flying.inFlight).toEqual({ title: 'One' });
    expect(flying.queued).toEqual({ title: 'Two' });
  });

  it('reports saved once the last request succeeds with nothing behind it', () => {
    const machine = run({ type: 'queue', patch: { title: 'One' } }, { type: 'start' }, { type: 'succeeded' });
    expect(machine.status).toBe('saved');
    expect(isPending(machine)).toBe(false);
    expect(machine.inFlight).toBeNull();
  });

  it('keeps saying "saving" when a success leaves something queued, and sends it next', () => {
    const machine = run(
      { type: 'queue', patch: { title: 'One' } },
      { type: 'start' },
      { type: 'queue', patch: { title: 'Two' } },
      { type: 'succeeded' },
    );
    expect(machine.status).toBe('saving');
    expect(isPending(machine)).toBe(true);
    expect(canStart(machine)).toBe(true);
    expect(autosaveReducer(machine, { type: 'start' }).inFlight).toEqual({ title: 'Two' });
  });

  it('keeps what it was given when the request fails, ready to be sent again', () => {
    const failed = run(
      { type: 'queue', patch: { title: 'One' } },
      { type: 'start' },
      { type: 'failed', failure: FAILURE },
    );
    expect(failed.status).toBe('failed');
    expect(failed.failure).toBe(FAILURE);
    expect(failed.queued).toEqual({ title: 'One' });
    expect(failed.inFlight).toBeNull();
    expect(isPending(failed)).toBe(true);

    const retried = autosaveReducer(autosaveReducer(failed, { type: 'retry' }), { type: 'start' });
    // The same body, because nothing threw it away.
    expect(retried.inFlight).toEqual({ title: 'One' });
    expect(retried.failure).toBeNull();
  });

  it('lets a newer value win when a failed patch is merged back', () => {
    const machine = run(
      { type: 'queue', patch: { title: 'One', blurb: 'First' } },
      { type: 'start' },
      // Typed while the request that is about to fail is still in the air.
      { type: 'queue', patch: { title: 'Two' } },
      { type: 'failed', failure: FAILURE },
    );
    expect(machine.queued).toEqual({ title: 'Two', blurb: 'First' });
  });

  it('keeps the failure on screen while more is typed, until a save succeeds', () => {
    const typing = run(
      { type: 'queue', patch: { title: 'One' } },
      { type: 'start' },
      { type: 'failed', failure: FAILURE },
      { type: 'queue', patch: { title: 'Two' } },
    );
    expect(typing.status).toBe('saving');
    expect(typing.failure).toBe(FAILURE);

    const saved = run(
      { type: 'queue', patch: { title: 'One' } },
      { type: 'start' },
      { type: 'failed', failure: FAILURE },
      { type: 'start' },
      { type: 'succeeded' },
    );
    expect(saved.failure).toBeNull();
    expect(saved.status).toBe('saved');
  });

  it('ignores a retry when nothing is waiting', () => {
    const machine = run({ type: 'queue', patch: { title: 'One' } }, { type: 'start' }, { type: 'succeeded' });
    expect(autosaveReducer(machine, { type: 'retry' })).toBe(machine);
  });

  it('ignores an answer when nothing is in flight', () => {
    const machine = run({ type: 'queue', patch: { title: 'One' } });
    expect(autosaveReducer(machine, { type: 'succeeded' })).toBe(machine);
    expect(autosaveReducer(machine, { type: 'failed', failure: FAILURE })).toBe(machine);
  });

  it('never mutates the machine it is given', () => {
    const before = run({ type: 'queue', patch: { title: 'One' } });
    const snapshot = structuredClone(before);
    autosaveReducer(before, { type: 'queue', patch: { blurb: 'More' } });
    autosaveReducer(before, { type: 'start' });
    expect(before).toEqual(snapshot);
  });
});

describe('unsavedPatch', () => {
  it('is null when everything has been acknowledged', () => {
    expect(unsavedPatch(initialAutosave<Patch>())).toBeNull();
    expect(
      unsavedPatch(run({ type: 'queue', patch: { title: 'One' } }, { type: 'start' }, { type: 'succeeded' })),
    ).toBeNull();
  });

  it('is the body in flight under whatever was queued after it', () => {
    const machine = run(
      { type: 'queue', patch: { title: 'One', blurb: 'First' } },
      { type: 'start' },
      { type: 'queue', patch: { title: 'Two' } },
    );
    expect(unsavedPatch(machine)).toEqual({ title: 'Two', blurb: 'First' });
  });

  it('is the queue when nothing is in flight', () => {
    expect(unsavedPatch(run({ type: 'queue', patch: { blurb: 'Only' } }))).toEqual({ blurb: 'Only' });
  });
});
