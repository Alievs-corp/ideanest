import { MAINTENANCE_PROBLEM_TYPE } from '@ideanest/api-client/maintenance';
import { appStateChanged, RELOCK_AFTER_MS, resetAppLockForTests, unlockWithPin } from './app-lock';
import { setOnline } from './connectivity';
import { leaveMaintenance, observeResponse, takeDeferred } from './maintenance';
import { openWhenAllowed } from './open-when-allowed';
import { enableLock, rememberAccessToken, storeRefreshToken, useFlagStore } from './session';
import { memoryStore } from './storage';

/**
 * A link or a push tap — `app/_layout.tsx`'s `go` — never opens behind the app lock (#319), and
 * still waits for maintenance to end (#214).
 */

const down = () =>
  new Response(
    JSON.stringify({ type: MAINTENANCE_PROBLEM_TYPE, title: 'Scheduled maintenance', status: 503 }),
    { status: 503, headers: { 'content-type': 'application/problem+json' } },
  );
const noWipe = async () => undefined;

beforeEach(async () => {
  setOnline(true);
  leaveMaintenance();
  takeDeferred();
  useFlagStore(memoryStore());
  rememberAccessToken(null);
  await storeRefreshToken('refresh-1');
  await enableLock('135790');
  resetAppLockForTests();
});

it('a link at a locked cold start waits for the PIN, then opens', async () => {
  const navigate = jest.fn();
  openWhenAllowed(navigate);
  expect(navigate).not.toHaveBeenCalled();

  await unlockWithPin('135790', noWipe);
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('a push tap that brings the app back after more than five minutes waits for the unlock', async () => {
  await unlockWithPin('135790', noWipe);
  appStateChanged('background', 0, 0);

  // Delivered before 'active', as both platforms do.
  const navigate = jest.fn();
  openWhenAllowed(navigate);
  appStateChanged('active', RELOCK_AFTER_MS + 1, 0);
  expect(navigate).not.toHaveBeenCalled();

  await unlockWithPin('135790', noWipe);
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('a push tap that brings the app back within five minutes opens once it is active', async () => {
  await unlockWithPin('135790', noWipe);
  appStateChanged('background', 0, 0);

  const navigate = jest.fn();
  openWhenAllowed(navigate);
  expect(navigate).not.toHaveBeenCalled();
  appStateChanged('active', 30_000, 30_000);
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('opened during maintenance, it waits for the service after the lock', async () => {
  await observeResponse(down());
  const navigate = jest.fn();
  openWhenAllowed(navigate);

  await unlockWithPin('135790', noWipe);
  expect(navigate).not.toHaveBeenCalled(); // the service is still away
  leaveMaintenance();
  takeDeferred()?.();
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('runs at once with the gate open and the service up', async () => {
  await unlockWithPin('135790', noWipe);
  const navigate = jest.fn();
  openWhenAllowed(navigate);
  expect(navigate).toHaveBeenCalledTimes(1);
});
