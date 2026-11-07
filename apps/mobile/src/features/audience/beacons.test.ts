import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { recordClick, recordView, recordVisit, useAudienceView, watchVisits } from './beacons';
import { sendAudienceEvent } from './send';

/**
 * When the app counts a reader (#636). `sendAudienceEvent` is the spy `jest.setup.ts` puts in
 * place of the wire for every suite; what reaches the wire is `send.test.ts`'s.
 */

const sent = sendAudienceEvent as jest.Mock;

let listeners: ((state: AppStateStatus) => void)[];
const remove = jest.fn();
const initial = AppState.currentState;

/** `currentState` is a plain property in jest's React Native, so it is set rather than spied on. */
function setCurrent(state: AppStateStatus) {
  (AppState as { currentState: AppStateStatus }).currentState = state;
}

beforeEach(() => {
  sent.mockClear();
  remove.mockClear();
  listeners = [];
  setCurrent('active');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove } as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  setCurrent(initial);
});

function go(state: AppStateStatus) {
  setCurrent(state);
  for (const listener of listeners) listener(state);
}

describe('VISIT', () => {
  it('counts the launch when the app opens in front', () => {
    const stop = watchVisits();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith({ kind: 'VISIT' });
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('counts each return from the background', () => {
    watchVisits();
    go('background');
    go('active');
    go('background');
    go('active');
    expect(sent).toHaveBeenCalledTimes(3);
    expect(sent.mock.calls.every(([event]) => event.kind === 'VISIT')).toBe(true);
  });

  it('does not count a glance at the app switcher or the control centre', () => {
    watchVisits();
    go('inactive');
    go('active');
    go('inactive');
    go('active');
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('waits for the foreground when launched in the background (a push woke it)', () => {
    setCurrent('background');
    watchVisits();
    expect(sent).not.toHaveBeenCalled();
    go('active');
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('records a VISIT on demand', () => {
    recordVisit();
    expect(sent).toHaveBeenCalledWith({ kind: 'VISIT' });
  });
});

describe('VIEW', () => {
  it('counts once per campaign the screen shows, not per render', async () => {
    const { rerender } = await renderHook(({ id }: { id: string | undefined }) => useAudienceView(id), {
      initialProps: { id: undefined as string | undefined },
    });
    expect(sent).not.toHaveBeenCalled();

    await rerender({ id: 'p-1' });
    await rerender({ id: 'p-1' });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenLastCalledWith({ kind: 'VIEW', projectId: 'p-1' });

    await act(async () => rerender({ id: 'p-2' }));
    expect(sent).toHaveBeenCalledTimes(2);
    expect(sent).toHaveBeenLastCalledWith({ kind: 'VIEW', projectId: 'p-2' });
  });

  it('sends nothing without a campaign id', () => {
    recordView('');
    recordView(null);
    recordView(undefined);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('CLICK', () => {
  it('carries the list the card was pressed in', () => {
    recordClick('p-1', 'SEARCH');
    expect(sent).toHaveBeenCalledWith({ kind: 'CLICK', projectId: 'p-1', surface: 'SEARCH' });
  });

  it('is OTHER when the list does not say', () => {
    recordClick('p-1');
    expect(sent).toHaveBeenCalledWith({ kind: 'CLICK', projectId: 'p-1', surface: 'OTHER' });
  });

  it('sends nothing without a campaign id', () => {
    recordClick('', 'HOME');
    recordClick(undefined, 'HOME');
    expect(sent).not.toHaveBeenCalled();
  });
});
