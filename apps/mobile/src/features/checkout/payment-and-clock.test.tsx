import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as client from '../../api/client';
import { sendIdempotent } from '../../api/mutate';
import { appReturnPrefix, paymentReturnFor, returnHintOf } from './payment';
import { useReservationClock } from './use-reservation-clock';

describe('payment return addresses', () => {
  it('returns through the site with via=app, in the app language', () => {
    expect(paymentReturnFor('a b', 'az', 'https://ideyanest.com/')).toEqual({
      language: 'az',
      successUrl: 'https://ideyanest.com/az/pledges/a%20b?payment=returned&via=app',
      errorUrl: 'https://ideyanest.com/az/pledges/a%20b?payment=failed&via=app',
    });
    expect(appReturnPrefix('pl-1')).toBe('ideanest://pledges/pl-1');
  });

  it('reads only returned or failed from the return', () => {
    expect(returnHintOf('ideanest://pledges/x?payment=returned')).toBe('returned');
    expect(returnHintOf('ideanest://pledges/x?payment=failed#y')).toBe('failed');
    expect(returnHintOf('ideanest://pledges/x?payment=paid')).toBeNull();
    expect(returnHintOf('ideanest://pledges/x')).toBeNull();
  });
});

describe('sendIdempotent', () => {
  it('sends the key as Idempotency-Key and refuses to send without one', async () => {
    const send = jest.spyOn(client, 'sendJson').mockResolvedValue({ id: 'x' });
    await expect(sendIdempotent('/v1/pledges/draft', { a: 1 }, 'k-1')).resolves.toEqual({ id: 'x' });
    expect(send).toHaveBeenCalledWith('POST', '/v1/pledges/draft', { a: 1 }, { 'Idempotency-Key': 'k-1' });
    await expect(sendIdempotent('/v1/pledges/draft', {}, '')).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });
});

describe('useReservationClock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('counts down once a second and expires at zero', async () => {
    const view = await renderHook(() => useReservationClock('2030-01-01T00:01:00Z'));
    expect(view.result.current.label).toBe('1:00');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(view.result.current.label).toBe('0:59');
    await act(async () => {
      jest.advanceTimersByTime(59_000);
    });
    expect(view.result.current).toEqual({ remainingMs: 0, expired: true, label: '0:00' });
  });

  it('recomputes on resume after the clock jumped in the background', async () => {
    let listener: ((state: AppStateStatus) => void) | null = null;
    const subscribe = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    const view = await renderHook(() => useReservationClock('2030-01-01T00:05:00Z'));
    expect(view.result.current.label).toBe('5:00');
    jest.setSystemTime(new Date('2030-01-01T00:04:30Z'));
    await act(async () => listener?.('active'));
    expect(view.result.current.label).toBe('0:30');
    subscribe.mockRestore();
  });
});
