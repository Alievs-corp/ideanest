import * as Notifications from 'expo-notifications';
import {
  EXPLAINER_SNOOZE_MS,
  explainerSnoozed,
  registerForPush,
  snoozeExplainer,
  syncPushRegistration,
} from './push';
import { rememberAccessToken } from './session';
import { memoryStore } from './storage';

/**
 * When this phone is registered for push, and when it is asked — #160. `expo-notifications` and
 * `expo-device` are mocked: a real device, a permission the test sets, and the service as `fetch`.
 */
jest.mock('expo-device', () => ({ isDevice: true, deviceName: 'Test phone' }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  AndroidImportance: { DEFAULT: 3 },
}));

const permissions = jest.mocked(Notifications.getPermissionsAsync);
const request = jest.mocked(Notifications.requestPermissionsAsync);
const fetchMock = jest.fn(async () => new Response(null, { status: 201 }));
const realFetch = global.fetch;

function phone(status: 'granted' | 'denied' | 'undetermined') {
  permissions.mockResolvedValue({ granted: status === 'granted', status } as Awaited<
    ReturnType<typeof Notifications.getPermissionsAsync>
  >);
}

function calls(): { method: string | undefined; url: string }[] {
  return fetchMock.mock.calls.map((call) => {
    const [url, init] = call as unknown as [string, RequestInit | undefined];
    return { url, method: init?.method };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  rememberAccessToken('access-1');
});

afterAll(() => {
  global.fetch = realFetch;
  rememberAccessToken(null);
});

describe('registerForPush', () => {
  it('asks only a phone that has not decided', async () => {
    phone('undetermined');
    await expect(registerForPush()).resolves.toEqual({ status: 'registered' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not ask a phone that already allows it, and registers it', async () => {
    phone('granted');
    await expect(registerForPush()).resolves.toEqual({ status: 'registered' });
    expect(request).not.toHaveBeenCalled();
    expect(calls()).toEqual([{ url: expect.stringMatching(/\/v1\/me\/devices$/), method: 'POST' }]);
  });

  it('never asks again after a refusal', async () => {
    phone('denied');
    await expect(registerForPush()).resolves.toEqual({ status: 'denied' });
    expect(request).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses without a session, before anything is asked', async () => {
    rememberAccessToken(null);
    phone('undetermined');
    await expect(registerForPush()).resolves.toEqual({ status: 'signed-out' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('syncPushRegistration — launch and foreground', () => {
  it('registers a phone that allows notifications, without a prompt', async () => {
    const store = memoryStore();
    phone('granted');

    await expect(syncPushRegistration(store)).resolves.toBe('registered');
    expect(request).not.toHaveBeenCalled();
    expect(calls()).toEqual([{ url: expect.stringMatching(/\/v1\/me\/devices$/), method: 'POST' }]);
  });

  it('neither asks nor registers a phone that has not decided, or refused', async () => {
    for (const status of ['undetermined', 'denied'] as const) {
      phone(status);
      await expect(syncPushRegistration(memoryStore())).resolves.toBe('none');
    }
    expect(request).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the registration when the permission went from allowed to refused', async () => {
    const store = memoryStore();
    phone('granted');
    await syncPushRegistration(store);
    fetchMock.mockClear();

    phone('denied');
    await expect(syncPushRegistration(store)).resolves.toBe('unregistered');
    expect(calls()).toEqual([{ url: expect.stringMatching(/\/v1\/me\/devices$/), method: 'DELETE' }]);

    // Once dropped, a later foreground with the permission still off does nothing more.
    fetchMock.mockClear();
    await expect(syncPushRegistration(store)).resolves.toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the explainer’s "Not now"', () => {
  it('holds for thirty days on this phone', () => {
    const store = memoryStore();
    const at = Date.parse('2026-10-06T10:00:00Z');
    expect(explainerSnoozed(at, store)).toBe(false);

    snoozeExplainer(at, store);
    expect(explainerSnoozed(at + 1, store)).toBe(true);
    expect(explainerSnoozed(at + EXPLAINER_SNOOZE_MS - 1, store)).toBe(true);
    expect(explainerSnoozed(at + EXPLAINER_SNOOZE_MS, store)).toBe(false);
    expect(EXPLAINER_SNOOZE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
