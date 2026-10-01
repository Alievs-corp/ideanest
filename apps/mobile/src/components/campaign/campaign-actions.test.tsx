import type { ReactNode } from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as SecureStore from 'expo-secure-store';
import type { TestInstance } from 'test-renderer';
import en from '@ideanest/messages/en.json';
import type { ProjectState } from '@ideanest/campaign/states';
import { queryKeys } from '../../api/queries';
import { setLocale } from '../../lib/locale';
import { rememberAccessToken, storeRefreshToken, useFlagStore } from '../../lib/session';
import { memoryStore } from '../../lib/storage';
import { CampaignActions } from './campaign-actions';
import { CampaignCountdown } from './campaign-countdown';

/**
 * Save, Share and Remind — issue #155's `CampaignActions` tests — and the countdown's role.
 *
 * <p>The session is the real one over the keychain double, and the writes go through the app's
 * own `sendJson`; only `fetch` is replaced.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };

jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.setTimeout(30_000);

const A = en.campaign.actions;
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const TITLE = 'Solar Lamp';
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const keychain = SecureStore as unknown as { __reset: () => void };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

type Route = () => Response | Promise<Response>;
let routes: { save: Route; unsave: Route; remind: Route; forget: Route; refresh: Route };
let writes: string[];
let client: QueryClient;

beforeEach(async () => {
  await act(async () => setLocale('en'));
  keychain.__reset();
  useFlagStore(memoryStore());
  rememberAccessToken(null);
  jest.clearAllMocks();
  writes = [];
  routes = {
    save: () => json({ saved: true }),
    unsave: () => json({ saved: false }),
    remind: () => json({ following: true, followerCount: 4 }),
    forget: () => new Response(null, { status: 204 }),
    refresh: () => problem(401),
  };
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === '/v1/auth/refresh') return routes.refresh();
    writes.push(`${method} ${url.pathname}`);
    if (url.pathname === `/v1/projects/${ID}/save`) {
      return method === 'POST' ? routes.save() : routes.unsave();
    }
    if (url.pathname === `/v1/projects/${ID}/remind`) {
      return method === 'POST' ? routes.remind() : routes.forget();
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  client?.clear();
  jest.restoreAllMocks();
});

async function signIn() {
  await storeRefreshToken('refresh-1');
  rememberAccessToken('access-1');
}

async function show(state: ProjectState = 'LIVE', { offline = false } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  await render(
    <CampaignActions
      projectId={ID}
      state={state}
      title={TITLE}
      shareUrl="https://test.invalid/projects/aysel/solar-lamp"
      offline={offline}
    />,
    { wrapper },
  );
  await settle();
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function textOf(node: TestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

const notice = () => textOf(screen.getByTestId('actions-notice'));
const named = (template: string) => template.replace('{title}', TITLE);

describe('the controls, by name', () => {
  it('names each control with the campaign, and Save carries its state', async () => {
    await show('PRELAUNCH');
    const save = screen.getByRole('button', { name: named(A.saveLabel) });
    expect(save.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    expect(screen.getByRole('button', { name: named(A.shareLabel) })).toBeTruthy();
    expect(screen.getByRole('button', { name: named(A.remindLabel) })).toBeTruthy();
  });

  it('offers Remind only before launch', async () => {
    for (const state of ['LIVE', 'SUCCESSFUL', 'CANCELED', 'EXTENDED'] as const) {
      await show(state);
      expect(screen.queryByTestId('action-remind')).toBeNull();
    }
    await show('PRELAUNCH');
    expect(screen.getByTestId('action-remind')).toBeTruthy();
  });
});

describe('Save', () => {
  it('sends a signed-out reader to sign in, and writes nothing', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: named(A.saveLabel) }));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
    expect(writes).toEqual([]);
  });

  it('turns on at once, settles on the service’s answer, and refreshes the Saved list', async () => {
    await signIn();
    let answer: (response: Response) => void = () => {};
    routes.save = () => new Promise<Response>((resolve) => (answer = resolve));
    await show();
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    await fireEvent.press(screen.getByRole('button', { name: named(A.saveLabel) }));
    // Optimistic: "Saved", selected, before the service has answered.
    expect(screen.getByText(A.saved, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('action-save').props.accessibilityLabel).toBe(named(A.savedLabel));
    expect(screen.getByTestId('action-save').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );

    await act(async () => answer(json({ saved: true })));
    await settle();
    expect(writes).toEqual([`POST /v1/projects/${ID}/save`]);
    expect(notice()).toBe(named(A.notices.saved));
    expect(screen.getByRole('button', { name: named(A.savedLabel) })).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.saved() });

    await fireEvent.press(screen.getByRole('button', { name: named(A.savedLabel) }));
    await settle();
    expect(writes).toEqual([`POST /v1/projects/${ID}/save`, `DELETE /v1/projects/${ID}/save`]);
    expect(notice()).toBe(named(A.notices.removed));
  });

  it('rolls back on a 500 and says what the service said', async () => {
    await signIn();
    routes.save = () => problem(500, { detail: 'Saving is paused for maintenance.' });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: named(A.saveLabel) }));
    await settle();
    expect(screen.getByTestId('action-save').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
    expect(screen.getByText(A.save, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('action-save').props.accessibilityLabel).toBe(named(A.saveLabel));
    expect(notice()).toBe('Saving is paused for maintenance.');
  });

  it('falls back to its own sentence for a refusal with no words', async () => {
    await signIn();
    routes.save = () => problem(500);
    await show();
    await fireEvent.press(screen.getByRole('button', { name: named(A.saveLabel) }));
    await settle();
    expect(notice()).toBe(A.failures.notSaved);
  });

  it('asks the reader to sign in on a 401', async () => {
    await signIn();
    routes.save = () => problem(401);
    await show();
    await fireEvent.press(screen.getByRole('button', { name: named(A.saveLabel) }));
    await settle();
    expect(notice()).toBe(A.failures.signIn);
    expect(screen.getByTestId('action-save').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
  });

  it('says the service could not be reached when nothing answered', async () => {
    await signIn();
    routes.save = () => Promise.reject(new TypeError('Network request failed'));
    await show();
    await fireEvent.press(screen.getByRole('button', { name: named(A.saveLabel) }));
    await settle();
    expect(notice()).toBe(A.failures.unreachable);
  });
});

describe('Share', () => {
  it('says nothing when the sheet is dismissed', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: named(A.shareLabel) }));
    await settle();
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://test.invalid/projects/aysel/solar-lamp', title: TITLE }),
    );
    expect(notice()).toBe('');
  });

  it('says it was shared, and says so when it failed', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: named(A.shareLabel) }));
    await settle();
    expect(notice()).toBe(A.notices.shared);

    jest.spyOn(Share, 'share').mockRejectedValue(new Error('no sheet'));
    await fireEvent.press(screen.getByRole('button', { name: named(A.shareLabel) }));
    await settle();
    expect(notice()).toBe(en.mobile.campaign.shareFailed);
  });
});

describe('Remind me', () => {
  it('sends a signed-out reader to the pre-launch page, which takes an address', async () => {
    await show('PRELAUNCH');
    await fireEvent.press(screen.getByRole('button', { name: named(A.remindLabel) }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/campaigns/[id]/prelaunch',
      params: { id: ID },
    });
    expect(writes).toEqual([]);
  });

  it('follows and unfollows for a signed-in reader', async () => {
    await signIn();
    await show('PRELAUNCH');
    await fireEvent.press(screen.getByRole('button', { name: named(A.remindLabel) }));
    await settle();
    expect(notice()).toBe(A.notices.remindOn);
    const set = screen.getByRole('button', { name: named(A.remindingLabel) });
    expect(set.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

    await fireEvent.press(set);
    await settle();
    expect(writes).toEqual([`POST /v1/projects/${ID}/remind`, `DELETE /v1/projects/${ID}/remind`]);
    expect(notice()).toBe(A.notices.remindOff);
  });
});

describe('the countdown', () => {
  it('is a timer named with the time left, and not a live region', async () => {
    const deadline = new Date(Date.now() + 3 * 86_400_000 + 4 * 3_600_000 + 60_000).toISOString();
    await render(
      <IntlProvider locale="en" messages={en}>
        <CampaignCountdown deadline={deadline} active />
      </IntlProvider>,
    );
    const timer = screen.getByRole('timer');
    expect(timer.props.accessibilityLabel).toBe(
      'Time left to back this campaign: 3 days, 4 hours',
    );
    expect(timer.props.accessibilityLiveRegion).toBe('none');
    expect(screen.getByText('3 days, 4 hours left')).toBeTruthy();
  });

  it('draws nothing once the deadline has passed', async () => {
    await render(
      <IntlProvider locale="en" messages={en}>
        <CampaignCountdown deadline="2020-01-01T00:00:00Z" active />
      </IntlProvider>,
    );
    expect(screen.queryByRole('timer')).toBeNull();
  });
});
