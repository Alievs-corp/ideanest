import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { formatDateTime } from '../../lib/i18n';
import { setLocale } from '../../lib/locale';
import { deviceStore } from '../../lib/storage';
import { unsentKeyFor } from '../../lib/unsent-edits';
import { EditorFrame } from './editor-frame';
import { SaveStatus } from './save-status';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
let mockPath = '/campaigns/p1/edit/basics';
let mockId = 'p1';

/*
 * The router, with the two pieces the frame draws: `Stack.Screen` prints the header's title and
 * renders its right-hand control, so the test reads what the stack header would show; `Slot` is
 * the tab.
 */
jest.mock('expo-router', () => {
  const { createElement, Fragment } = jest.requireActual('react');
  const { Text: RNText, View: RNView } = jest.requireActual('react-native');
  return {
    useRouter: () => mockRouter,
    usePathname: () => mockPath,
    useLocalSearchParams: () => ({ id: mockId }),
    Slot: () => createElement(RNText, { testID: 'tab-slot' }, 'tab'),
    Stack: {
      Screen: ({ options }: { options: { title?: string; headerRight?: () => ReactNode } }) =>
        createElement(
          Fragment,
          null,
          createElement(RNText, { testID: 'header-title' }, options.title),
          createElement(RNView, { testID: 'header-right' }, options.headerRight?.()),
        ),
    },
  };
});
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
const mockGet = jest.fn();
const mockSend = jest.fn();
jest.mock('../../api/client', () => ({
  api: () => ({ get: mockGet }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function project(extra: Partial<ProjectEdit> = {}): ProjectEdit {
  return {
    id: 'p1',
    slug: 'solar-lamp',
    state: 'DRAFT',
    title: 'Solar Lamp',
    latePledgeEnabled: false,
    lockedFields: [],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(seed?: ProjectEdit) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } } });
  if (seed !== undefined) client.setQueryData(queryKeys.projectEdit('p1'), seed);
  await act(async () => setLocale('en'));
  const tree = () => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <EditorFrame />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  view = await render(tree());
  rerenderFrame = async () => {
    await view.rerender(tree());
    await settle();
  };
  await settle();
  return client;
}

let view: Awaited<ReturnType<typeof render>>;
let rerenderFrame: () => Promise<void> = async () => {};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReset();
  mockSend.mockReset();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
  mockPath = '/campaigns/p1/edit/basics';
  mockId = 'p1';
  for (const key of deviceStore.getAllKeys()) deviceStore.remove(key);
});

describe('EditorFrame', () => {
  it('says Loading in the header while the project loads, and draws the tab under the tabs', async () => {
    mockGet.mockReturnValueOnce(new Promise(() => {}));
    await show();

    expect(screen.getByTestId('header-title')).toHaveTextContent(en.campaignEditor.loadingTitle);
    expect(screen.getByText(en.campaignEditor.eyebrow)).toBeTruthy();
    expect(screen.getByTestId('tab-slot')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/v1/projects/{id}/edit', expect.objectContaining({ path: { id: 'p1' } }));
  });

  it('names the project in the header, shows its state, and marks the tab shown', async () => {
    mockGet.mockResolvedValueOnce(project());
    await show();

    expect(screen.getByTestId('header-title')).toHaveTextContent('Solar Lamp');
    expect(screen.getByTestId('editor-state')).toHaveTextContent(en.campaignEditor.state.DRAFT);
    const row = screen.getByTestId('editor-tabs');
    expect(row.props.accessibilityRole).toBe('tablist');
    expect(row.props.accessibilityLabel).toBe(en.campaignEditor.sectionsLabel);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      en.campaignEditor.tabs.basics,
      en.campaignEditor.tabs.rewards,
      en.campaignEditor.tabs.story,
      en.campaignEditor.tabs.faq,
      en.campaignEditor.tabs.prelaunch,
      en.campaignEditor.tabs.review,
    ]);
    expect(screen.getByRole('tab', { name: en.campaignEditor.tabs.basics, selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: en.campaignEditor.tabs.story, selected: false })).toBeTruthy();
  });

  it('replaces the route between tabs, so Back leaves the editor', async () => {
    mockGet.mockResolvedValueOnce(project());
    await show();

    await fireEvent.press(screen.getByRole('tab', { name: en.campaignEditor.tabs.rewards }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/campaigns/[id]/edit/rewards', params: { id: 'p1' } });
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('gives every tab a 44pt target', async () => {
    mockGet.mockResolvedValueOnce(project());
    await show();
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.props.style).toMatchObject({ minHeight: 44 });
    }
  });

  it.each([
    [403, en.mobile.editor.load.forbidden],
    [404, en.mobile.editor.load.notFound],
  ])('words a %i and offers to try again', async (status, words) => {
    mockGet.mockRejectedValueOnce(new ApiError(status, { status })).mockResolvedValueOnce(project());
    await show();

    expect(screen.getByText(en.campaignEditor.loadFailedTitle)).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByTestId('tab-slot')).toBeNull();
    await fireEvent.press(screen.getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.getByTestId('header-title')).toHaveTextContent('Solar Lamp');
    expect(screen.getByTestId('tab-slot')).toBeTruthy();
  });

  it('a 401 is "You are signed out", with Sign in and the way back', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(401, { status: 401 }));
    await show();

    expect(screen.getByText(en.campaignEditor.signedOutTitle)).toBeTruthy();
    expect(screen.getByText(en.mobile.editor.signedOutDetail)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.shell.actions.signIn));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/campaigns/p1/edit/basics' },
    });
  });

  it('with no session on the phone, asks nothing of the service and offers to sign in', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-signed-out')).toBeTruthy();
    expect(screen.queryByTestId('tab-slot')).toBeNull();
  });

  it('offline, shows the project as last loaded, read-only, with a notice', async () => {
    setOnline(false);
    mockGet.mockRejectedValue(new Error('offline'));
    await show(project());

    expect(screen.getByTestId('header-title')).toHaveTextContent('Solar Lamp');
    expect(screen.getByText(en.mobile.editor.offlineReadOnly)).toBeTruthy();
    expect(screen.getByTestId('tab-slot')).toBeTruthy();
  });

  it('offline with nothing loaded says so rather than loading for ever', async () => {
    setOnline(false);
    mockGet.mockRejectedValueOnce(new Error('offline'));
    await show();

    expect(screen.getByText(en.mobile.offline.nothingCached)).toBeTruthy();
  });

  it('offers a change an earlier launch left unsent, and sends it only when asked', async () => {
    const at = '2026-10-06T20:00:00.000Z';
    deviceStore.set(unsentKeyFor('p1'), JSON.stringify({ patch: { title: 'Solar Lamp 2' }, at }));
    mockGet.mockResolvedValueOnce(project());
    mockSend.mockResolvedValueOnce(project({ title: 'Solar Lamp 2' }));
    const client = await show();

    expect(
      screen.getByText(en.mobile.editor.unsent.title.replace('{time}', formatDateTime(at, 'en'))),
    ).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('editor-unsent-send'));
    await settle();
    expect(mockSend).toHaveBeenCalledWith('PATCH', '/v1/projects/p1', { title: 'Solar Lamp 2' });
    expect(client.getQueryData<ProjectEdit>(queryKeys.projectEdit('p1'))?.title).toBe('Solar Lamp 2');
    expect(screen.queryByTestId('editor-unsent')).toBeNull();
    expect(deviceStore.getString(unsentKeyFor('p1'))).toBeUndefined();
  });

  it('discards the offered change without sending it', async () => {
    deviceStore.set(
      unsentKeyFor('p1'),
      JSON.stringify({ patch: { title: 'Gone' }, at: '2026-10-06T20:00:00.000Z' }),
    );
    mockGet.mockResolvedValueOnce(project());
    await show();

    await fireEvent.press(screen.getByTestId('editor-unsent-discard'));
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('editor-unsent')).toBeNull();
    expect(deviceStore.getString(unsentKeyFor('p1'))).toBeUndefined();
  });

  it('names the screen "Edit campaign" rather than "Loading" once the load has failed', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(404, { status: 404 }));
    await show();
    expect(screen.getByTestId('header-title')).toHaveTextContent(en.mobile.fallback.editCampaign);
  });

  it('online, says so when a cached project could not be refreshed, and offers to try again', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(500, { status: 500, detail: 'Down for a moment.' }));
    await show(project());

    expect(screen.getByTestId('editor-refresh-failed')).toBeTruthy();
    expect(screen.getByText('Down for a moment.')).toBeTruthy();
    expect(screen.getByTestId('tab-slot')).toBeTruthy();
  });

  it('does not offer to send an unsent change before the service’s current copy is in', async () => {
    deviceStore.set(unsentKeyFor('p1'), JSON.stringify({ patch: { title: 'Later' }, at: '2026-10-06T20:00:00.000Z' }));
    mockGet.mockReturnValueOnce(new Promise(() => {}));
    await show(project());
    expect(screen.getByTestId('editor-unsent-send').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('is a new editor for another project: its offer and its autosave do not carry over', async () => {
    deviceStore.set(unsentKeyFor('p1'), JSON.stringify({ patch: { title: 'For p1' }, at: '2026-10-06T20:00:00.000Z' }));
    mockGet.mockResolvedValueOnce(project()).mockResolvedValueOnce(project({ id: 'p2', title: 'Other' }));
    await show();
    expect(screen.getByTestId('editor-unsent')).toBeTruthy();

    mockId = 'p2';
    mockPath = '/campaigns/p2/edit/basics';
    await rerenderFrame();
    expect(mockGet).toHaveBeenLastCalledWith('/v1/projects/{id}/edit', expect.objectContaining({ path: { id: 'p2' } }));
    expect(screen.getByTestId('header-title')).toHaveTextContent('Other');
    expect(screen.queryByTestId('editor-unsent')).toBeNull();
  });
});

describe('SaveStatus', () => {
  const copy = { saving: 'Saving', saved: 'Saved', notSaved: 'Not saved' };

  it('shows nothing while idle', async () => {
    await render(<SaveStatus state="idle" copy={copy} />);
    expect(screen.queryByText('Saving')).toBeNull();
  });

  it('pairs each state with a word, and announces only the two outcomes, politely', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const spyIos = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    const view = await render(<SaveStatus state="idle" copy={copy} />);

    await view.rerender(<SaveStatus state="saving" copy={copy} />);
    expect(screen.getByLabelText('Saving')).toBeTruthy();
    expect(screen.getByTestId('save-status-spinner')).toBeTruthy();
    const said = () => [...spy.mock.calls.map((call) => call[0]), ...spyIos.mock.calls.map((call) => call[0])];
    expect(said()).toEqual([]);

    await view.rerender(<SaveStatus state="saved" copy={copy} />);
    expect(screen.getByLabelText('Saved')).toBeTruthy();
    expect(said()).toEqual(['Saved']);
    for (const call of spyIos.mock.calls) expect(call[1]).toEqual({ queue: true });

    await view.rerender(<SaveStatus state="failed" copy={copy} />);
    expect(screen.getByLabelText('Not saved')).toBeTruthy();
    expect(said()).toEqual(['Saved', 'Not saved']);
  });

  it('holds the spinner still under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(
      <View>
        <Text>frame</Text>
        <SaveStatus state="saving" copy={copy} />
      </View>,
    );
    await settle();
    expect(screen.getByTestId('save-status-still')).toBeTruthy();
    expect(screen.queryByTestId('save-status-spinner')).toBeNull();
  });
});
