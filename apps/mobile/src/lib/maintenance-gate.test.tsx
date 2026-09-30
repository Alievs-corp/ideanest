import { act, renderHook } from '@testing-library/react-native';
import { setOnline } from './connectivity';
import { deferUntilUp, leaveMaintenance, observeResponse, takeDeferred } from './maintenance';
import { useMaintenanceGate } from './maintenance-gate';

/**
 * The root's maintenance gate — issue #150: one push per outage however many requests fail,
 * nothing while it lasts, a fresh push for the next one, and a held link opened on the way out.
 */

const down = () => new Response(null, { status: 503 });

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
    observeResponse(down());
    observeResponse(down());
    observeResponse(down());
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
