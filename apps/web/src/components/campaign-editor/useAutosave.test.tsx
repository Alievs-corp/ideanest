import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { saveFailureCopyFrom } from '@ideanest/campaign-editor/copy';
import { ApiError } from '../../lib/api/problem';
import { EDITOR_COPY } from '../../test-editor-copy';
import { translatorFor } from '../../test-copy';
import { describeFailure, useAutosave } from './useAutosave';

/**
 * The autosave contract (epic §6), tested where it lives rather than through a
 * form: debounce, one request in flight, and a failure that keeps what was
 * typed. All three fail silently in a form — the creator sees a field with their
 * text in it either way — so they are worth pinning down here.
 */

interface Patch {
  title?: string;
  blurb?: string;
}

const DELAY = 800;

/* The frame's words, as every panel hands them in. */
const FAILURES = EDITOR_COPY.failures;

/** A send function whose promises this test resolves by hand. */
function controllable() {
  const calls: Patch[] = [];
  const settlers: { resolve: () => void; reject: (cause: unknown) => void }[] = [];

  const send = (patch: Patch): Promise<string> => {
    calls.push(patch);
    return new Promise<string>((resolve, reject) => {
      settlers.push({ resolve: () => resolve('saved'), reject });
    });
  };

  return { calls, settlers, send };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutosave', () => {
  it('waits for the pause before sending anything', async () => {
    const send = vi.fn(async () => 'saved');
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One' }));
    await advance(DELAY - 1);
    expect(send).not.toHaveBeenCalled();

    await advance(1);
    expect(send).toHaveBeenCalledExactlyOnceWith({ title: 'One' });
  });

  it('merges everything typed during the pause into one request', async () => {
    const send = vi.fn(async () => 'saved');
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One' }));
    await advance(100);
    act(() => result.current.save({ title: 'Two' }));
    act(() => result.current.save({ blurb: 'A summary' }));
    await advance(DELAY);

    // One request, latest value per field. The alternative is three requests
    // racing each other over the same two columns.
    expect(send).toHaveBeenCalledExactlyOnceWith({ title: 'Two', blurb: 'A summary' });
  });

  it('says "saving" from the first keystroke, not from the request', async () => {
    const send = vi.fn(async () => 'saved');
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One' }));
    // "Saved" while unsent text is queued is the one lie this indicator must
    // never tell, so the state changes before the request does.
    expect(result.current.state).toBe('saving');
    expect(result.current.pending).toBe(true);

    await advance(DELAY);
    expect(result.current.state).toBe('saved');
    expect(result.current.pending).toBe(false);
  });

  it('sends immediately when asked to flush', async () => {
    const send = vi.fn(async () => 'saved');
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One' }));
    await act(async () => {
      result.current.flush();
    });

    expect(send).toHaveBeenCalledOnce();
  });

  /*
   * Merge patches are applied in the order the server receives them, and two
   * overlapping requests can be answered out of order — which on a title field
   * means a keystroke travelling backwards.
   */
  it('never has two requests in flight, and sends the rest afterwards', async () => {
    const { calls, settlers, send } = controllable();
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One' }));
    await advance(DELAY);
    expect(calls).toHaveLength(1);

    act(() => result.current.save({ title: 'Two' }));
    await advance(DELAY);
    expect(calls).toHaveLength(1);

    await act(async () => {
      settlers[0]?.resolve();
    });

    expect(calls).toEqual([{ title: 'One' }, { title: 'Two' }]);
  });

  it('keeps what it was given when the request fails, and sends it again on retry', async () => {
    const { calls, settlers, send } = controllable();
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One' }));
    await advance(DELAY);
    await act(async () => {
      settlers[0]?.reject(new ApiError(500, null));
    });

    expect(result.current.state).toBe('failed');
    expect(result.current.pending).toBe(true);
    expect(result.current.failure?.message).toBe(FAILURES.generic);

    await act(async () => {
      result.current.retry();
    });

    // The same body, because nothing threw it away.
    expect(calls).toEqual([{ title: 'One' }, { title: 'One' }]);

    await act(async () => {
      settlers[1]?.resolve();
    });
    expect(result.current.state).toBe('saved');
  });

  it('lets a newer value win when a failed patch is merged back', async () => {
    const { calls, settlers, send } = controllable();
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One', blurb: 'First' }));
    await advance(DELAY);

    // Typed while the request that is about to fail is still in the air.
    act(() => result.current.save({ title: 'Two' }));
    await act(async () => {
      settlers[0]?.reject(new ApiError(503, null));
    });
    await advance(DELAY);

    expect(calls[1]).toEqual({ title: 'Two', blurb: 'First' });
  });

  it('does not retry a refusal by itself, because the same body would be refused again', async () => {
    const { calls, settlers, send } = controllable();
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: '' }));
    await advance(DELAY);
    await act(async () => {
      settlers[0]?.reject(
        new ApiError(422, { status: 422, detail: 'A title is required.', errors: { title: 'Required.' } }),
      );
    });

    await advance(DELAY * 5);
    expect(calls).toHaveLength(1);
    expect(result.current.failure?.fieldErrors).toEqual({ title: 'Required.' });
    expect(result.current.failure?.message).toBe('A title is required.');
  });

  /*
   * Moving to another tab must not discard the last few seconds of typing. The
   * request is a merge patch, so arriving twice is the same as arriving once.
   */
  it('sends what is still queued when it goes away', async () => {
    const send = vi.fn(async () => 'saved');
    const { result, unmount } = renderHook(() =>
      useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }),
    );

    act(() => result.current.save({ title: 'Unsent' }));
    expect(send).not.toHaveBeenCalled();

    unmount();
    expect(send).toHaveBeenCalledExactlyOnceWith({ title: 'Unsent' });
  });

  it('reports the server problem detail rather than wording of its own', async () => {
    const { settlers, send } = controllable();
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One' }));
    await advance(DELAY);
    await act(async () => {
      settlers[0]?.reject(
        new ApiError(409, {
          status: 409,
          detail: 'The goal cannot change after launch.',
          code: 'PROJECT_FIELD_LOCKED',
        }),
      );
    });

    expect(result.current.failure).toMatchObject({
      message: 'The goal cannot change after launch.',
      status: 409,
      code: 'PROJECT_FIELD_LOCKED',
    });
  });

  it('says the service could not be reached when there is no response at all', async () => {
    const { settlers, send } = controllable();
    const { result } = renderHook(() => useAutosave<Patch, string>({ send, delayMs: DELAY, failures: FAILURES }));

    act(() => result.current.save({ title: 'One' }));
    await advance(DELAY);
    await act(async () => {
      settlers[0]?.reject(new TypeError('Failed to fetch'));
    });

    expect(result.current.failure?.message).toBe(FAILURES.unreachable);
    expect(result.current.pending).toBe(true);
  });
});

/*
 * #78: these sentences were English literals inside `describeFailure` until the editor's last
 * strings left it. English cannot show that they no longer are, so this asks in Azerbaijani.
 */
describe('describeFailure', () => {
  const az = saveFailureCopyFrom(translatorFor('campaignEditor', 'az'));

  it.each([
    [401, 'signedOut'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [422, 'rejected'],
    [500, 'generic'],
  ] as const)('puts a bare %i in the words it was handed', (status, key) => {
    expect(describeFailure(new ApiError(status, null), az).message).toBe(az[key]);
    expect(az[key]).not.toBe(FAILURES[key]);
  });

  it('puts an unreachable service in the words it was handed', () => {
    expect(describeFailure(new TypeError('Failed to fetch'), az).message).toBe(az.unreachable);
  });
});
