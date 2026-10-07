import { act, renderHook } from '@testing-library/react-native';
import { MAINTENANCE_PROBLEM_TYPE } from '@ideanest/api-client/maintenance';
import { setOnline } from './connectivity';
import { deferUntilUp, leaveMaintenance, observeResponse, takeDeferred } from './maintenance';
import { useMaintenanceGate } from './maintenance-gate';
import { resetAppLockForTests, unlockWithPin } from './app-lock';
import { enableLock, rememberAccessToken, storeRefreshToken, useFlagStore } from './session';
import { memoryStore } from './storage';

/**
 * The root's maintenance gate — issues #150 and #214: one push per window however many requests
 * fail, nothing while it lasts, a fresh push for the next one, a held link opened on the way
 * out — and no push at all for a 503 that is not the maintenance problem.
 */

const down = () =>
  new Response(
    JSON.stringify({
      type: MAINTENANCE_PROBLEM_TYPE,
      title: 'Scheduled maintenance',
      status: 503,
      startsAt: '2026-10-04T22:00:00Z',
      endsAt: null,
      source: 'api',
    }),
    { status: 503, headers: { 'content-type': 'application/problem+json' } },
  );

beforeEach(() => {
  setOnline(true);
  leaveMaintenance();
  takeDeferred();
});

async function mountGate() {
  const router = { push: jest.fn() };
  const view = await renderHook(() => useMaintenanceGate(router));
  return { router, view };
}

it('pushes nothing while the service answers', async () => {
  const { router } = await mountGate();
  expect(router.push).not.toHaveBeenCalled();
});

it('pushes once when a screen of requests all meet the 503 together', async () => {
  const { router } = await mountGate();

  await act(async () => {
    await Promise.all([observeResponse(down()), observeResponse(down()), observeResponse(down())]);
  });

  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/maintenance');
});

it('stays quiet while the outage lasts, re-render or not', async () => {
  const { router, view } = await mountGate();
  await act(async () => observeResponse(down()));

  await view.rerender(undefined);
  await act(async () => observeResponse(down()));

  expect(router.push).toHaveBeenCalledTimes(1);
});

it('pushes nothing for a plain 503: that is an ordinary failure', async () => {
  const { router } = await mountGate();
  await act(async () => {
    await observeResponse(new Response(null, { status: 503, headers: { 'Retry-After': '30' } }));
  });
  expect(router.push).not.toHaveBeenCalled();
});

it('pushes again for the next outage', async () => {
  const { router } = await mountGate();

  await act(async () => observeResponse(down()));
  await act(async () => leaveMaintenance());
  await act(async () => observeResponse(down()));

  expect(router.push).toHaveBeenCalledTimes(2);
});

it('opens a link held during the outage once the service is back, and not before', async () => {
  const { router } = await mountGate();
  const open = jest.fn();

  await act(async () => observeResponse(down()));
  expect(deferUntilUp(open)).toBe(true);
  expect(open).not.toHaveBeenCalled();

  await act(async () => leaveMaintenance());
  expect(open).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledTimes(1);
});

describe('#319: while the app lock is shut', () => {
  beforeEach(async () => {
    useFlagStore(memoryStore());
    rememberAccessToken(null);
    await storeRefreshToken('refresh-1');
    await enableLock('135790');
    resetAppLockForTests();
  });

  afterEach(() => {
    useFlagStore(memoryStore());
    resetAppLockForTests();
  });

  it('pushes nothing over the lock screen, and pushes once when it opens', async () => {
    const { router } = await mountGate();
    await act(async () => observeResponse(down()));
    expect(router.push).not.toHaveBeenCalled();

    await act(async () => {
      await unlockWithPin('135790', async () => undefined);
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/maintenance');
  });
});
