import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { saveAccountLocale } from '../api/client';
import { queryKeys } from '../api/queries';
import { sweepAccountExports } from './account-export-files';
import { AccountSync } from './account-sync';
import { currentLocale, setLocale } from './locale';
import { chooseLocale, forgetAccountSync, pushPendingLocale } from './locale-sync';
import { deviceStore } from './storage';

/**
 * The device's language and the account's — issue #216, one case per rule.
 *
 * The latest explicit choice wins and is written to the account; the account's language is
 * applied to this phone only when the phone has no choice of its own, or when the account
 * changed elsewhere since this phone last synced it (`locale.accountSynced`). The rule itself
 * is `reconcileLocale`, tested bare in `locale.test.ts`; these drive it the way the app does —
 * `AccountSync` reading `GET /v1/me`, the foreground, the sign-out — over the real MMKV mock.
 *
 * The per-app setting's launch half (a new first language in `getLocales()` becomes the
 * stored, pending choice; German changes nothing) is in `locale.test.ts`, where a launch can be
 * replayed on a fresh module registry. Here it is picked up from the state that launch leaves.
 */

// eslint-disable-next-line no-var
var mockMe: { id: string; locale?: string } | null | undefined;
// eslint-disable-next-line no-var
var mockSession: { signedIn: boolean; locked: boolean; unlocked: boolean };

jest.mock('./account', () => ({
  ACCOUNT_KEYS: { me: ['me'], unread: ['unread'] },
  canReadAccount: (session: { signedIn: boolean; locked: boolean; unlocked: boolean }) =>
    session.signedIn && (!session.locked || session.unlocked),
  useMe: () => ({ data: mockMe }),
}));
jest.mock('./use-session', () => ({ useSession: () => mockSession }));
jest.mock('../api/client', () => ({ saveAccountLocale: jest.fn(async () => true) }));
jest.mock('./account-export-files', () => ({ sweepAccountExports: jest.fn() }));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: () => ({ remove: () => {} }),
}));

const save = jest.mocked(saveAccountLocale);
const sweep = jest.mocked(sweepAccountExports);

/* The first render loads the module graph, which took past 5 s on a CI runner elsewhere. */
jest.setTimeout(20_000);

/** What the phone holds about the language, as MMKV has it. */
function held() {
  return {
    locale: currentLocale(),
    stored: deviceStore.getString('locale'),
    synced: deviceStore.getString('locale.accountSynced'),
    pending: deviceStore.getString('locale.pending'),
  };
}

let foreground: ((state: AppStateStatus) => void) | undefined;
let client: QueryClient;

/** `AccountSync` over a fresh cache, with the foreground listener captured. */
async function mount() {
  foreground = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementationOnce((_type, listener) => {
    foreground = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = await render(<AccountSync />, { wrapper });
  await act(async () => {});
  return view;
}

/** A read of `GET /v1/me` arriving with this language. */
async function accountSays(view: Awaited<ReturnType<typeof mount>>, locale: string) {
  mockMe = { id: 'account-1', locale };
  await view.rerender(<AccountSync />);
  await act(async () => {});
}

beforeEach(async () => {
  jest.clearAllMocks();
  save.mockResolvedValue(true);
  mockMe = undefined;
  mockSession = { signedIn: true, locked: false, unlocked: false };
  forgetAccountSync();
  deviceStore.remove('locale');
  await act(async () => setLocale('az'));
  deviceStore.remove('locale');
});

describe('the account language on this phone (#216)', () => {
  it('fresh install and sign-in: the account wins', async () => {
    const view = await mount();
    await accountSays(view, 'ru');

    expect(held()).toEqual({ locale: 'ru', stored: 'ru', synced: 'ru', pending: undefined });
    expect(save).not.toHaveBeenCalled();
  });

  it('a device choice with the account unchanged: the device wins', async () => {
    deviceStore.set('locale.accountSynced', 'ru');
    await act(async () => setLocale('tr'));

    const view = await mount();
    await accountSays(view, 'ru');

    expect(held()).toEqual({ locale: 'tr', stored: 'tr', synced: 'ru', pending: undefined });
    expect(save).not.toHaveBeenCalled();
  });

  it('the account changed on the web: the account wins and replaces the device choice', async () => {
    deviceStore.set('locale.accountSynced', 'tr');
    await act(async () => setLocale('tr'));

    const view = await mount();
    await accountSays(view, 'en');

    expect(held()).toEqual({ locale: 'en', stored: 'en', synced: 'en', pending: undefined });
  });

  it('the per-app setting changed while signed in: PATCH sent, and the device wins after it', async () => {
    // What the launch left (locale.test.ts): the new language stored and marked for the account.
    deviceStore.set('locale.accountSynced', 'az');
    await act(async () => setLocale('ru'));
    deviceStore.set('locale.pending', 'ru');

    let land: (saved: boolean) => void = () => {};
    save.mockImplementationOnce(() => new Promise<boolean>((resolve) => (land = resolve)));

    // Sent as soon as the account can be read. A read that answers before the PATCH lands
    // still says the old language, and it does not switch the app back.
    const view = await mount();
    expect(save).toHaveBeenCalledWith('ru');
    await accountSays(view, 'az');
    expect(held()).toEqual({ locale: 'ru', stored: 'ru', synced: 'az', pending: 'ru' });

    await act(async () => land(true));
    expect(held()).toEqual({ locale: 'ru', stored: 'ru', synced: 'ru', pending: undefined });
    expect(save).toHaveBeenCalledTimes(1);

    // The next read carries the choice; this phone agrees with it and keeps it.
    await accountSays(view, 'ru');
    expect(held()).toEqual({ locale: 'ru', stored: 'ru', synced: 'ru', pending: undefined });
  });

  it('a failed PATCH: the choice stays, and the retry goes out on the next foreground', async () => {
    deviceStore.set('locale.accountSynced', 'az');
    save.mockResolvedValue(false);

    const view = await mount();
    chooseLocale('ru', true);
    await act(async () => {
      await pushPendingLocale();
    });
    expect(held()).toEqual({ locale: 'ru', stored: 'ru', synced: 'az', pending: 'ru' });

    // A read while offline-then-back still says the old language; the pending choice outranks it.
    await accountSays(view, 'az');
    expect(held()).toMatchObject({ locale: 'ru', pending: 'ru' });

    save.mockClear();
    save.mockResolvedValue(true);
    await act(async () => foreground?.('active'));

    expect(save).toHaveBeenCalledWith('ru');
    expect(held()).toEqual({ locale: 'ru', stored: 'ru', synced: 'ru', pending: undefined });
  });

  it('does not retry on a foreground while the biometric lock is shut', async () => {
    mockSession = { signedIn: true, locked: true, unlocked: false };
    chooseLocale('ru', true);

    await mount();
    await act(async () => foreground?.('active'));

    expect(save).not.toHaveBeenCalled();
    expect(held().pending).toBe('ru');
  });

  it('the phone moving to German changes nothing, whatever the account says', async () => {
    // locale.test.ts: a switch to a language the app lacks leaves the stored choice and no mark.
    deviceStore.set('locale.accountSynced', 'en');
    await act(async () => setLocale('tr'));

    const view = await mount();
    await accountSays(view, 'en');

    expect(held()).toEqual({ locale: 'tr', stored: 'tr', synced: 'en', pending: undefined });
  });

  it('sign-out: the choice stays and the synced marker is cleared', async () => {
    deviceStore.set('locale.accountSynced', 'ru');
    deviceStore.set('locale.pending', 'tr');
    await act(async () => setLocale('tr'));
    mockSession = { signedIn: false, locked: false, unlocked: false };

    await mount();

    expect(held()).toEqual({ locale: 'tr', stored: 'tr', synced: undefined, pending: undefined });
    expect(save).not.toHaveBeenCalled();
  });

  it('the next sign-in after that follows its own account', async () => {
    await act(async () => setLocale('tr'));

    const view = await mount();
    await accountSays(view, 'en');

    expect(held()).toEqual({ locale: 'en', stored: 'en', synced: 'en', pending: undefined });
  });
});

describe('the session ending (#160, #163)', () => {
  /** `lib/offline.ts`'s persisted document, as MMKV holds it. */
  const PERSISTED = 'ideanest.query-cache.v1';
  const PRIVATE = [
    ['me', true],
    ['unread'],
    queryKeys.inbox(),
    queryKeys.saved(),
    queryKeys.pledgeList(),
    queryKeys.myProjects(),
    queryKeys.dashboardOverview('c1'),
    queryKeys.dashboardAnalytics('c1'),
    queryKeys.dashboardFinance('c1'),
    queryKeys.dashboardBackers('c1', 'filter:{}'),
    queryKeys.dashboardSegments('c1'),
    queryKeys.dashboardSurveys('c1'),
    queryKeys.dashboardRewardTiers('c1'),
    queryKeys.ownProfile(),
  ] as const;

  afterEach(() => deviceStore.remove(PERSISTED));

  it('a revoked session takes every account root with it, in memory and on disk, and sweeps the exports', async () => {
    const view = await mount();
    for (const key of PRIVATE) client.setQueryData(key, { owner: 'account-1' });
    client.setQueryData(queryKeys.project('aysel', 'solar-lamp'), { title: 'Solar Lamp' });
    deviceStore.set(PERSISTED, '{"clientState":{}}');

    // A refresh answered 401: the keychain is emptied and nothing else is called.
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await view.rerender(<AccountSync />);
    await act(async () => {});

    for (const key of PRIVATE) expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(queryKeys.project('aysel', 'solar-lamp'))).toEqual({ title: 'Solar Lamp' });
    expect(deviceStore.getString(PERSISTED)).toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('a signed-out launch keeps a guest’s persisted pages and sweeps nothing', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    deviceStore.set(PERSISTED, '{"clientState":{}}');

    await mount();

    expect(deviceStore.getString(PERSISTED)).toBe('{"clientState":{}}');
    expect(sweep).not.toHaveBeenCalled();
  });
});
