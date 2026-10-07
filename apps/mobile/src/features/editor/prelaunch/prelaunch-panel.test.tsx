import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccessibilityInfo, Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../../api/queries';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { memoryStore } from '../../../lib/storage';
import { EditorProvider } from '../editor-context';
import { COPIED_MS, PrelaunchPanel } from './prelaunch-panel';

/**
 * The Pre-launch tab (#162): the three states of the page, the opening (confirmed, after the
 * autosave has settled), the follower count from the public read, the link's Copy and Share, the
 * shared autosave for title and summary, offline, and the accessible names.
 */

jest.mock('../../../lib/use-session', () => ({
  useSession: () => ({ signedIn: true, locked: false, unlocked: false }),
}));
let mockProject: () => Promise<unknown> = async () => ({});
let mockPage: () => Promise<unknown> = async () => ({});
jest.mock('../../../api/client', () => ({
  api: () => ({
    get: (path: string) => (path === '/v1/projects/{id}/prelaunch' ? mockPage() : mockProject()),
  }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));
const mockSend = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-GB', decimalSeparator: '.' }],
}));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const words = en.campaignEditor.prelaunch;
const mobile = en.mobile.editor.prelaunch;
const LINK = 'https://test.invalid/projects/p1/prelaunch';

function project(extra: Partial<ProjectEdit> = {}): ProjectEdit {
  return {
    id: 'p1',
    slug: 'solar-lamp',
    state: 'DRAFT',
    title: 'Solar Lamp',
    blurb: 'A lamp.',
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

async function show({ cached }: { cached?: ProjectEdit } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (cached !== undefined) client.setQueryData(queryKeys.projectEdit('p1'), cached);
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <EditorProvider projectId="p1" store={memoryStore()}>
            <PrelaunchPanel />
          </EditorProvider>
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
  return client;
}

const calls = () => mockSend.mock.calls.map((call) => `${String(call[0])} ${String(call[1])}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  mockSend.mockImplementation(async () => project());
  mockProject = async () => project();
  mockPage = async () => ({ followerCount: 12 });
  setOnline(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
});

describe('PrelaunchPanel', () => {
  it('shows three named label-and-field placeholders while the project loads', async () => {
    mockProject = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('prelaunch-loading').props.accessibilityLabel).toBe(words.loadingLabel);
  });

  it('explains a draft page and does not open it without a confirmation', async () => {
    await show();
    expect(screen.getByText(words.notOpenHeading)).toBeTruthy();
    expect(screen.getByText(words.notOpenBody)).toBeTruthy();
    expect(screen.getByText(words.notOpenIrreversible)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('prelaunch-open'));
    await settle();
    expect(screen.getByText(words.confirmTitle)).toBeTruthy();
    expect(screen.getByText(mobile.confirmDetail)).toBeTruthy();
    expect(calls()).toEqual([]);

    await fireEvent.press(screen.getByTestId('prelaunch-confirm-cancel'));
    await settle();
    expect(calls()).toEqual([]);
  });

  it('sends what was typed first, then opens the page, and shows it open', async () => {
    mockSend.mockImplementation(async (_method: string, path: string, body?: { title?: string }) =>
      path.endsWith('/prelaunch') ? project({ state: 'PRELAUNCH', title: 'Solar Lamp Mini' }) : project(body),
    );
    await show();
    await fireEvent.changeText(screen.getByTestId('prelaunch-title'), 'Solar Lamp Mini');

    await fireEvent.press(screen.getByTestId('prelaunch-open'));
    await settle();
    await fireEvent.press(screen.getByTestId('prelaunch-confirm-open'));
    await settle();

    expect(calls()).toEqual(['PATCH /v1/projects/p1', 'POST /v1/projects/p1/prelaunch']);
    expect(mockSend.mock.calls[0]?.[2]).toEqual({ title: 'Solar Lamp Mini' });
    expect(screen.getByText(words.openHeading)).toBeTruthy();
    expect(screen.queryByTestId('prelaunch-draft')).toBeNull();
    expect(screen.getByTestId('prelaunch-waiting')).toHaveTextContent('12 people are waiting for this campaign.');
  });

  it('does not open the page over a change the server refused', async () => {
    mockSend.mockImplementation(async (method: string) => {
      if (method === 'PATCH') throw new ApiError(422, { status: 422, detail: 'That title is taken.' });
      return project({ state: 'PRELAUNCH' });
    });
    await show();
    await fireEvent.changeText(screen.getByTestId('prelaunch-title'), 'Taken');
    await fireEvent.press(screen.getByTestId('prelaunch-open'));
    await settle();
    await fireEvent.press(screen.getByTestId('prelaunch-confirm-open'));
    await settle();

    expect(calls()).toEqual(['PATCH /v1/projects/p1']);
    expect(screen.getByTestId('prelaunch-not-saved')).toBeTruthy();
    expect(screen.getByTestId('prelaunch-open-failed')).toHaveTextContent('That title is taken.', { exact: false });
  });

  it('says so in the draft card when opening is refused', async () => {
    mockSend.mockImplementation(async () => {
      throw new ApiError(409, { status: 409, detail: 'The campaign has moved on.' });
    });
    await show();
    await fireEvent.press(screen.getByTestId('prelaunch-open'));
    await settle();
    await fireEvent.press(screen.getByTestId('prelaunch-confirm-open'));
    await settle();

    expect(screen.getByText(words.openFailedTitle)).toBeTruthy();
    expect(screen.getByText('The campaign has moved on.')).toBeTruthy();
    expect(screen.getByTestId('prelaunch-open')).toBeTruthy();
  });

  it('counts the people waiting on an open page, and the link is the site address', async () => {
    mockProject = async () => project({ state: 'PRELAUNCH' });
    mockPage = async () => ({ followerCount: 1 });
    await show();
    expect(screen.getByTestId('prelaunch-waiting')).toHaveTextContent('1 person is waiting for this campaign.');
    expect(screen.getByTestId('prelaunch-link')).toHaveTextContent(LINK);
  });

  it('says the count could not be loaded rather than drawing a zero', async () => {
    mockProject = async () => project({ state: 'SCHEDULED' });
    mockPage = async () => {
      throw new ApiError(500, { status: 500 });
    };
    await show();
    expect(screen.getByTestId('prelaunch-followers-failed')).toHaveTextContent(words.followersFailed);
    expect(screen.queryByTestId('prelaunch-waiting')).toBeNull();
  });

  it('copies the link, says "Copied" for a moment and announces it', async () => {
    mockProject = async () => project({ state: 'PRELAUNCH' });
    await show();
    const copy = screen.getByTestId('prelaunch-copy');
    expect(copy.props.accessibilityLabel).toBe(mobile.copyLabel);

    jest.useFakeTimers();
    try {
      await fireEvent.press(copy);
      await act(async () => {
        await Promise.resolve();
      });
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(LINK);
      expect(screen.getByTestId('prelaunch-copy')).toHaveTextContent(words.copied);
      const said = [
        ...jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls.map((call) => call[0]),
        ...jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map((call) => call[0]),
      ];
      expect(said).toContain(words.copiedAnnouncement);

      await act(async () => {
        jest.advanceTimersByTime(COPIED_MS);
      });
      expect(screen.getByTestId('prelaunch-copy')).toHaveTextContent(words.copy);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tells the creator when the clipboard refused the link', async () => {
    mockProject = async () => project({ state: 'PRELAUNCH' });
    jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
    await show();
    await fireEvent.press(screen.getByTestId('prelaunch-copy'));
    await settle();
    expect(screen.getByTestId('prelaunch-copy-failed')).toHaveTextContent(mobile.copyFailed);
  });

  it('opens the share sheet with the same address', async () => {
    mockProject = async () => project({ state: 'PRELAUNCH' });
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await show();
    expect(screen.getByTestId('prelaunch-share').props.accessibilityLabel).toBe(mobile.shareLabel);
    await fireEvent.press(screen.getByTestId('prelaunch-share'));
    await settle();
    expect(share).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(share.mock.calls[0]?.[0])).toContain(LINK);
  });

  it('says the page has closed once the campaign has moved past it', async () => {
    mockProject = async () => project({ state: 'LIVE' });
    await show();
    expect(screen.getByTestId('prelaunch-closed')).toBeTruthy();
    expect(screen.getByText(words.closedTitle)).toBeTruthy();
    expect(screen.queryByTestId('prelaunch-open')).toBeNull();
  });

  it('edits the title and summary on the shared autosave, one field per patch', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('prelaunch-summary'), 'A small lamp.');
    await fireEvent(screen.getByTestId('prelaunch-summary'), 'blur');
    await settle();
    expect(mockSend.mock.calls.map((call) => call[2])).toEqual([{ blurb: 'A small lamp.' }]);
  });

  it('is read-only offline: no field, no opening', async () => {
    await show();
    await act(async () => setOnline(false));
    await settle();
    expect(screen.getByTestId('prelaunch-title').props.editable).toBe(false);
    expect(screen.getByTestId('prelaunch-open').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('online, never builds the form from a cached copy: it waits for the service', async () => {
    let reply: (value: ProjectEdit) => void = () => {};
    mockProject = () => new Promise((resolve) => (reply = resolve));
    await show({ cached: project({ title: 'Week-old title' }) });
    expect(screen.getByTestId('prelaunch-loading')).toBeTruthy();
    expect(screen.queryByTestId('prelaunch-title')).toBeNull();

    await act(async () => reply(project({ title: 'Renamed on the web' })));
    await settle();
    expect(screen.getByTestId('prelaunch-title').props.value).toBe('Renamed on the web');
  });

  it('takes a newer copy read from the service while nothing is pending', async () => {
    const client = await show();
    mockProject = async () => project({ title: 'Renamed elsewhere', blurb: 'Changed elsewhere' });
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.projectEdit('p1') });
    });
    await settle();
    expect(screen.getByTestId('prelaunch-title').props.value).toBe('Renamed elsewhere');
    expect(screen.getByTestId('prelaunch-summary').props.value).toBe('Changed elsewhere');
  });
});
