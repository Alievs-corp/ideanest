import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVideoDuration } from './videoDuration';

/**
 * Reading a clip's length before it is uploaded — issue #331.
 *
 * jsdom has no media stack, so the `<video>` element is real and its answer is not: each test
 * sets `duration` the way a browser would and fires the event a browser would fire. What is
 * asserted is the part that fails silently — an object URL that is never released holds the
 * whole file in memory for the life of the page, and an unreadable header must be "unknown",
 * never "too long".
 */

const ADDRESS = 'blob:http://localhost/clip';

let created: HTMLVideoElement | null;

beforeEach(() => {
  created = null;
  URL.createObjectURL = vi.fn(() => ADDRESS);
  URL.revokeObjectURL = vi.fn();

  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const element = original(tag, options);
    if (element instanceof HTMLVideoElement) {
      // jsdom does not implement `load`; the real one resets the element.
      element.load = () => {};
      created = element;
    }
    return element;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function answer(duration: number, event: 'loadedmetadata' | 'error' = 'loadedmetadata'): void {
  if (created === null) throw new Error('No video element was created');
  Object.defineProperty(created, 'duration', { value: duration, configurable: true });
  created.dispatchEvent(new Event(event));
}

const file = new Blob(['bytes'], { type: 'video/mp4' });

describe('readVideoDuration', () => {
  it('reads the length from the header alone, and lets go of the file', async () => {
    const pending = readVideoDuration(file);

    expect(created?.preload).toBe('metadata');
    expect(created?.getAttribute('src')).toBe(ADDRESS);
    // Detached: it is never put on the page.
    expect(created?.isConnected).toBe(false);

    answer(42.37);

    await expect(pending).resolves.toBe(42_370);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(ADDRESS);
  });

  it('answers "unknown" for a header the browser cannot read, rather than refusing the file', async () => {
    const pending = readVideoDuration(file);
    answer(Number.NaN, 'error');

    await expect(pending).resolves.toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(ADDRESS);
  });

  it('answers "unknown" for a recording with no length in its header', async () => {
    // A MediaRecorder WebM reports Infinity until somebody seeks to its end.
    const pending = readVideoDuration(file);
    answer(Number.POSITIVE_INFINITY);

    await expect(pending).resolves.toBeNull();
  });

  it('stops waiting for a header that never arrives', async () => {
    vi.useFakeTimers();
    const pending = readVideoDuration(file);

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(ADDRESS);
  });

  it('is abandoned with the upload it belongs to', async () => {
    const controller = new AbortController();
    const pending = readVideoDuration(file, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(ADDRESS);
  });
});
