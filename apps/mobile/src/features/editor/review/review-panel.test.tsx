import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ChecklistItem, ProjectChecklist, ProjectEdit } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { PROGRESS_FILL } from '../../../components/ui';
import { FOCUS_DELAY_MS } from '../../../components/ui/overlay';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { memoryStore } from '../../../lib/storage';
import { colors } from '../../../theme';
import { EditorProvider } from '../editor-context';
import { ReviewPanel } from './review-panel';

/**
 * The Review tab (#162): completeness from the server's checklist, required and recommended rows
 * with "Fix in …", the gated Submit and its focus jump, the refusals (`SUBSCRIPTION_REQUIRED` to
 * pricing, a plan limit, unmet requirements), the moderator's note, the per-state notes, the
 * inline launch confirmation, the failed read, and offline.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../../lib/use-session', () => ({
  useSession: () => ({ signedIn: true, locked: false, unlocked: false }),
}));
let mockProject: () => Promise<unknown> = async () => ({});
let mockChecklist: () => Promise<unknown> = async () => ({});
jest.mock('../../../api/client', () => ({
  api: () => ({
    get: (path: string) => (path === '/v1/projects/{id}/checklist' ? mockChecklist() : mockProject()),
  }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));
const mockSend = jest.fn();

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const words = en.campaignEditor.review;
const mobile = en.mobile.editor.review;

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

function item(extra: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    requirement: 'COVER_IMAGE',
    label: 'Cover image',
    satisfied: false,
    section: 'basics',
    detail: 'A cover image is required.',
    ...extra,
  };
}

const BLOCKED: ProjectChecklist = {
  projectId: 'p1',
  state: 'DRAFT',
  submittable: false,
  score: 72,
  blocking: [
    item({ requirement: 'TITLE', label: 'Title', satisfied: true, detail: null }),
    item(),
    item({ requirement: 'STORY', label: 'Story', section: 'story', detail: 'The story has 120 of 500 characters.' }),
  ],
  advisory: [item({ requirement: 'FAQ', label: 'Questions', section: 'faq', detail: 'Add a question.' })],
  moderation: null,
};

const READY: ProjectChecklist = {
  ...BLOCKED,
  submittable: true,
  score: 100,
  blocking: [item({ satisfied: true, detail: null })],
  advisory: [item({ requirement: 'FAQ', label: 'Questions', section: 'faq', satisfied: true, detail: null })],
};

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <EditorProvider projectId="p1" store={memoryStore()}>
            <ReviewPanel />
          </EditorProvider>
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

const calls = () => mockSend.mock.calls.map((call) => `${String(call[0])} ${String(call[1])}`);
type FocusCall = [unknown, string];
const focused = () =>
  (jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls as FocusCall[])
    .filter(([, type]) => type === 'focus')
    .map(([node]) => (node as { props?: { testID?: unknown } } | null)?.props?.testID);

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  mockProject = async () => project();
  mockChecklist = async () => BLOCKED;
  setOnline(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
});

describe('ReviewPanel', () => {
  it('shows four named placeholders while the checklist loads', async () => {
    mockChecklist = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('review-loading').props.accessibilityLabel).toBe(words.loadingLabel);
  });

  it('says how complete the campaign is, in words, with a lime bar that is not announced', async () => {
    await show();
    expect(screen.getByTestId('review-progress')).toHaveTextContent(
      '72% complete. 1 of 3 required items done, 0 of 1 recommended.',
    );
    expect(screen.getByText(words.completeness)).toBeTruthy();
    const fill = StyleSheet.flatten(screen.getByTestId(PROGRESS_FILL, { includeHiddenElements: true }).props.style) as ViewStyle;
    expect(fill.backgroundColor).toBe(colors.lime500);
    expect(screen.getByTestId('review-progress-bar', { includeHiddenElements: true }).props.accessible).toBe(false);
  });

  it('turns the bar success, not lime, at 100%', async () => {
    mockChecklist = async () => READY;
    await show();
    const fill = StyleSheet.flatten(screen.getByTestId(PROGRESS_FILL, { includeHiddenElements: true }).props.style) as ViewStyle;
    expect(fill.backgroundColor).toBe(colors.success);
  });

  it('names each row with its status, and only the unmet rows offer a fix', async () => {
    await show();
    expect(screen.getByText(words.requiredHeading)).toBeTruthy();
    expect(screen.getByText(words.recommendedHeading)).toBeTruthy();
    expect(screen.getByLabelText(`Title, ${mobile.done}`)).toBeTruthy();
    expect(
      screen.getByLabelText(`Cover image, ${words.requiredNotDone}. A cover image is required.`),
    ).toBeTruthy();
    expect(screen.getByLabelText(`Questions, ${words.recommendedNotDone}. Add a question.`)).toBeTruthy();
    expect(screen.queryByTestId('review-fix-TITLE')).toBeNull();
    // A section this build has no tab for is shown without a link rather than with a dead one.
    expect(screen.queryByTestId('review-fix-FAQ')).toBeNull();
    expect(screen.getByTestId('review-fix-COVER_IMAGE').props.accessibilityLabel).toBe('Fix in Basics: Cover image');
  });

  it('replaces the route with the tab that fixes a requirement', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('review-fix-STORY'));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/campaigns/[id]/edit/story', params: { id: 'p1' } });
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('draws a blocked Submit as disabled, and pressing it moves focus to the required list', async () => {
    await show();
    const submit = screen.getByTestId('review-submit');
    expect(submit.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('review-submit-explanation')).toHaveTextContent(
      `2 required items are not done yet. ${words.recommendedNotPartOfThis}`,
    );

    await fireEvent.press(submit);
    await settle();
    expect(calls()).toEqual([]);
    expect(focused()).toContain('review-required-heading');
  });

  it('submits a complete campaign and re-reads the checklist', async () => {
    mockChecklist = async () => READY;
    mockSend.mockImplementation(async () => project({ state: 'SUBMITTED' }));
    await show();
    expect(screen.getByTestId('review-submit').props.accessibilityState).toMatchObject({ disabled: false });

    mockChecklist = async () => ({ ...READY, state: 'SUBMITTED' });
    await fireEvent.press(screen.getByTestId('review-submit'));
    await settle();

    expect(calls()).toEqual(['POST /v1/projects/p1/submit']);
    expect(screen.queryByTestId('review-submit')).toBeNull();
    expect(screen.getByTestId('review-state-note')).toHaveTextContent(words.stateNote.SUBMITTED, { exact: false });
  });

  it('sends a creator with no plan to pricing, saying where they came from', async () => {
    mockChecklist = async () => READY;
    mockSend.mockRejectedValue(new ApiError(402, { status: 402, code: 'SUBSCRIPTION_REQUIRED' }));
    await show();
    await fireEvent.press(screen.getByTestId('review-submit'));
    await settle();
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/pricing',
      params: { from: 'submit', project: 'p1' },
    });
    expect(screen.queryByTestId('review-refusal')).toBeNull();
  });

  it('offers the plans beside a plan limit rather than navigating to them', async () => {
    mockChecklist = async () => READY;
    mockSend.mockRejectedValue(
      new ApiError(403, { status: 403, code: 'PLAN_LIMIT_EXCEEDED', detail: 'Your plan allows one live campaign.' }),
    );
    await show();
    await fireEvent.press(screen.getByTestId('review-submit'));
    await settle();
    expect(screen.getByTestId('review-refusal')).toHaveTextContent('Your plan allows one live campaign.', { exact: false });
    expect(mockRouter.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('review-plans'));
    expect(mockRouter.push).toHaveBeenCalledWith('/pricing');
  });

  it('lists the requirements the server named, and "Check again" re-reads', async () => {
    mockChecklist = async () => READY;
    mockSend.mockRejectedValue(
      new ApiError(409, {
        status: 409,
        code: 'PROJECT_NOT_SUBMITTABLE',
        detail: 'This campaign is not ready.',
        meta: { unmet: [{ requirement: 'RISKS', label: 'Risks', section: 'story', detail: 'Write 200 characters.' }] },
      }),
    );
    await show();
    await fireEvent.press(screen.getByTestId('review-submit'));
    await settle();
    expect(screen.getByText('Risks: Write 200 characters.')).toBeTruthy();

    const reads = jest.fn(async () => READY);
    mockChecklist = reads;
    await fireEvent.press(screen.getByTestId('review-check-again'));
    await settle();
    expect(reads).toHaveBeenCalled();
    expect(screen.queryByTestId('review-refusal')).toBeNull();
  });

  it("shows the moderator's note with its line breaks and the date", async () => {
    mockProject = async () => project({ state: 'CHANGES_REQUESTED' });
    mockChecklist = async () => ({
      ...BLOCKED,
      state: 'CHANGES_REQUESTED',
      moderation: {
        outcome: 'CHANGES_REQUESTED',
        note: 'Add a risk section.\nShow the prototype.',
        decidedAt: '2026-10-05T09:00:00Z',
        current: true,
      },
    });
    await show();
    expect(screen.getByText(words.changesRequestedTitle)).toBeTruthy();
    expect(screen.getByText('Add a risk section.\nShow the prototype.')).toBeTruthy();
    expect(screen.getByTestId('review-moderation-date')).toHaveTextContent(/2026/);
    expect(screen.getByTestId('review-submit')).toBeTruthy();
  });

  it('launches only after the inline confirmation, which takes focus', async () => {
    mockProject = async () => project({ state: 'APPROVED' });
    mockChecklist = async () => ({ ...READY, state: 'APPROVED' });
    mockSend.mockImplementation(async () => project({ state: 'LIVE' }));
    await show();
    expect(screen.queryByTestId('review-submit')).toBeNull();
    expect(screen.getByTestId('review-state-note')).toHaveTextContent(words.stateNote.APPROVED, { exact: false });

    await fireEvent.press(screen.getByTestId('review-launch'));
    await settle();
    expect(calls()).toEqual([]);
    expect(screen.getByText(words.confirmLaunchTitle)).toBeTruthy();
    expect(screen.getByText(mobile.confirmLaunchBody)).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOCUS_DELAY_MS + 20));
    });
    expect(focused()).toContain('review-launch-now');

    mockChecklist = async () => ({ ...READY, state: 'LIVE' });
    await fireEvent.press(screen.getByTestId('review-launch-now'));
    await settle();
    expect(calls()).toEqual(['POST /v1/projects/p1/launch']);
    expect(screen.queryByTestId('review-launch')).toBeNull();
    expect(screen.getByTestId('review-state-note')).toHaveTextContent(words.stateNote.LIVE, { exact: false });
  });

  it('cancels the launch without sending anything', async () => {
    mockProject = async () => project({ state: 'SCHEDULED' });
    mockChecklist = async () => ({ ...READY, state: 'SCHEDULED' });
    await show();
    await fireEvent.press(screen.getByTestId('review-launch'));
    await fireEvent.press(screen.getByTestId('review-launch-cancel'));
    await settle();
    expect(calls()).toEqual([]);
    expect(screen.getByTestId('review-launch')).toBeTruthy();
  });

  it('offers neither action on a live campaign', async () => {
    mockProject = async () => project({ state: 'LIVE' });
    mockChecklist = async () => ({ ...READY, state: 'LIVE' });
    await show();
    expect(screen.queryByTestId('review-submit')).toBeNull();
    expect(screen.queryByTestId('review-launch')).toBeNull();
  });

  it.each([
    [404, words.notFound],
    [403, words.noAccess],
  ])('says why the checklist could not be read (%s) and tries again', async (status, message) => {
    mockChecklist = async () => {
      throw new ApiError(status, { status });
    };
    await show();
    expect(screen.getByTestId('review-failed')).toHaveTextContent(message, { exact: false });
    mockChecklist = async () => BLOCKED;
    await fireEvent.press(screen.getByTestId('review-retry'));
    await settle();
    expect(screen.getByTestId('review-panel')).toBeTruthy();
  });

  it('says the service could not be reached when there was no answer', async () => {
    mockChecklist = async () => {
      throw new TypeError('Network request failed');
    };
    await show();
    expect(screen.getByTestId('review-failed')).toHaveTextContent(words.unreachable, { exact: false });
  });

  it('keeps both actions disabled offline', async () => {
    mockChecklist = async () => READY;
    await show();
    await act(async () => setOnline(false));
    await settle();
    expect(screen.getByTestId('review-submit').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('review-submit'));
    expect(calls()).toEqual([]);
  });
});
