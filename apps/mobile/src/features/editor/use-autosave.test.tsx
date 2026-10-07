import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import { memoryStore, type KeyValueStore } from '../../lib/storage';
import { readUnsent, unsentKeyFor } from '../../lib/unsent-edits';
import { useAutosave, type AutosaveOptions } from './use-autosave';

type Patch = { title?: string; blurb?: string | null };

/** A request the test answers by hand. */
function deferred() {
  let resolve: (value: string) => void = () => {};
  let reject: (cause: unknown) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const FAILED: SaveFailure = { message: 'Not saved', fieldErrors: {}, status: null, code: null, meta: null };
const KEY = unsentKeyFor('p1');
const NOW = new Date('2026-10-07T09:30:00.000Z');

let appState: ((state: AppStateStatus) => void)[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  appState = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appState.push(handler as (state: AppStateStatus) => void);
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function mount(
  send: jest.Mock<Promise<string>, [Patch]>,
  store: KeyValueStore = memoryStore(),
  extra: Partial<AutosaveOptions<Patch, string>> = {},
) {
  const onSaved = jest.fn();
  const hook = await renderHook(() =>
    useAutosave<Patch, string>({
      send,
      onSaved,
      describe: () => FAILED,
      persist: { store, key: KEY, now: () => NOW },
      ...extra,
    }),
  );
  return { hook, onSaved, store };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAutosave', () => {
  it('debounces: one request 800ms after the last change, with the changes merged', async () => {
    const send = jest.fn<Promise<string>, [Patch]>(() => Promise.resolve('ok'));
    const { hook } = await mount(send);

    await act(async () => hook.result.current.save({ title: 'A' }));
    await act(async () => jest.advanceTimersByTime(500));
    await act(async () => hook.result.current.save({ blurb: 'B' }));
    await act(async () => jest.advanceTimersByTime(799));
    expect(send).not.toHaveBeenCalled();
    expect(hook.result.current.state).toBe('saving');

    await act(async () => jest.advanceTimersByTime(1));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ title: 'A', blurb: 'B' });
    await flushPromises();
    expect(hook.result.current.state).toBe('saved');
  });

  it('flushes at once on blur', async () => {
    const send = jest.fn<Promise<string>, [Patch]>(() => Promise.resolve('ok'));
    const { hook } = await mount(send);

    await act(async () => hook.result.current.save({ title: 'A' }));
    await act(async () => hook.result.current.flush());
    expect(send).toHaveBeenCalledWith({ title: 'A' });
  });

  it('keeps one request in flight and merges what is typed meanwhile into the next one', async () => {
    const first = deferred();
    const send = jest
      .fn<Promise<string>, [Patch]>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce('second');
    const { hook, onSaved } = await mount(send);

    await act(async () => hook.result.current.save({ title: 'A' }));
    await act(async () => hook.result.current.flush());
    await act(async () => hook.result.current.save({ title: 'AB' }));
    await act(async () => hook.result.current.save({ blurb: 'x' }));
    await act(async () => jest.advanceTimersByTime(800));
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve('first'));
    await flushPromises();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ title: 'AB', blurb: 'x' });
    await flushPromises();
    expect(onSaved).toHaveBeenCalledWith('second');
    expect(hook.result.current.state).toBe('saved');
  });

  it('keeps a failed patch, and a retry sends it with the newer changes, once', async () => {
    const send = jest
      .fn<Promise<string>, [Patch]>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ok');
    const { hook } = await mount(send);

    await act(async () => hook.result.current.save({ title: 'A' }));
    await act(async () => hook.result.current.flush());
    await flushPromises();
    expect(hook.result.current.state).toBe('failed');
    expect(hook.result.current.failure).toBe(FAILED);
    expect(hook.result.current.pending).toBe(true);

    await act(async () => hook.result.current.save({ blurb: 'B' }));
    await act(async () => hook.result.current.retry());
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ title: 'A', blurb: 'B' });
    await flushPromises();
    await act(async () => jest.advanceTimersByTime(800));
    expect(send).toHaveBeenCalledTimes(2);
    expect(hook.result.current.state).toBe('saved');
    expect(hook.result.current.failure).toBeNull();
  });

  it('flushes when the app goes to the background or becomes inactive', async () => {
    const send = jest.fn<Promise<string>, [Patch]>(() => Promise.resolve('ok'));
    const { hook } = await mount(send);

    await act(async () => hook.result.current.save({ title: 'A' }));
    await act(async () => appState.forEach((listener) => listener('background')));
    expect(send).toHaveBeenCalledWith({ title: 'A' });

    await flushPromises();
    await act(async () => hook.result.current.save({ title: 'B' }));
    await act(async () => appState.forEach((listener) => listener('inactive')));
    expect(send).toHaveBeenLastCalledWith({ title: 'B' });
  });

  it('keeps what is unsent on the phone, and forgets it once the service has it', async () => {
    const answer = deferred();
    const send = jest.fn<Promise<string>, [Patch]>(() => answer.promise);
    const { hook, store } = await mount(send);

    await act(async () => hook.result.current.save({ title: 'A' }));
    expect(readUnsent(store, KEY)).toEqual({ patch: { title: 'A' }, at: NOW.toISOString() });

    await act(async () => hook.result.current.flush());
    // In the air is not the same as accepted: still kept.
    expect(readUnsent(store, KEY)).toEqual({ patch: { title: 'A' }, at: NOW.toISOString() });

    await act(async () => answer.resolve('ok'));
    await flushPromises();
    expect(store.getString(KEY)).toBeUndefined();
  });

  it('offers a change an earlier launch left unsent, and never sends it on its own', async () => {
    const store = memoryStore();
    store.set(KEY, JSON.stringify({ patch: { title: 'Killed' }, at: '2026-10-06T20:00:00.000Z' }));
    const send = jest.fn<Promise<string>, [Patch]>(() => Promise.resolve('ok'));
    const { hook } = await mount(send, store);

    expect(hook.result.current.unsent).toEqual({ patch: { title: 'Killed' }, at: '2026-10-06T20:00:00.000Z' });
    await act(async () => jest.advanceTimersByTime(10_000));
    await act(async () => appState.forEach((listener) => listener('background')));
    expect(send).not.toHaveBeenCalled();
    expect(hook.result.current.state).toBe('idle');
  });

  it('sends the offered change on request, under anything typed since', async () => {
    const store = memoryStore();
    store.set(KEY, JSON.stringify({ patch: { title: 'Killed', blurb: 'old' }, at: '2026-10-06T20:00:00.000Z' }));
    const send = jest.fn<Promise<string>, [Patch]>(() => Promise.resolve('ok'));
    const { hook } = await mount(send, store);

    await act(async () => hook.result.current.save({ blurb: 'new' }));
    // While the offer stands, a second kill must lose neither.
    expect(readUnsent<Patch>(store, KEY)?.patch).toEqual({ title: 'Killed', blurb: 'new' });

    let queued: Patch | null = null;
    await act(async () => {
      queued = hook.result.current.sendUnsent();
    });
    expect(queued).toEqual({ title: 'Killed', blurb: 'new' });
    expect(send).toHaveBeenCalledWith({ title: 'Killed', blurb: 'new' });
    expect(hook.result.current.unsent).toBeNull();
    await flushPromises();
    expect(store.getString(KEY)).toBeUndefined();
  });

  it('discards the offered change without sending it', async () => {
    const store = memoryStore();
    store.set(KEY, JSON.stringify({ patch: { title: 'Killed' }, at: '2026-10-06T20:00:00.000Z' }));
    const send = jest.fn<Promise<string>, [Patch]>(() => Promise.resolve('ok'));
    const { hook } = await mount(send, store);

    await act(async () => hook.result.current.discardUnsent());
    expect(hook.result.current.unsent).toBeNull();
    expect(store.getString(KEY)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('forgets an entry nobody can read rather than offering it', async () => {
    const store = memoryStore();
    store.set(KEY, '{not json');
    const { hook } = await mount(jest.fn(), store);
    expect(hook.result.current.unsent).toBeNull();
    expect(store.getString(KEY)).toBeUndefined();
  });

  it('sends what is queued on unmount without leaving the machine in flight', async () => {
    const send = jest.fn<Promise<string>, [Patch]>(() => Promise.resolve('ok'));
    const { hook, store } = await mount(send);

    await act(async () => hook.result.current.save({ title: 'Leaving' }));
    await act(async () => hook.unmount());
    expect(send).toHaveBeenCalledWith({ title: 'Leaving' });
    await flushPromises();
    expect(store.getString(KEY)).toBeUndefined();
  });

  it('keeps the stored copy when the unmount send fails, for the next launch to offer', async () => {
    const send = jest.fn<Promise<string>, [Patch]>(() => Promise.reject(new Error('offline')));
    const { hook, store } = await mount(send);

    await act(async () => hook.result.current.save({ title: 'Leaving' }));
    await act(async () => hook.unmount());
    await flushPromises();
    expect(readUnsent<Patch>(store, KEY)?.patch).toEqual({ title: 'Leaving' });
  });
});
