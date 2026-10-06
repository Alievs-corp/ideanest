import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import type { components } from '@ideanest/api-client';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import * as apiClient from '../../../api/client';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { colors } from '../../../theme';
import { SEND_CONFIRM_MS, SurveyBuilder } from './survey-builder';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };
const mockGet = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../../lib/use-session', () => ({ useSession: () => mockSession }));
jest.mock('../../../api/client', () => ({
  api: () => ({ get: mockGet }),
  sendJson: jest.fn(),
  sendJsonForFile: jest.fn(),
  traceIdOfError: () => null,
}));

jest.setTimeout(30_000);

type ContractSurvey = components['schemas']['SurveyResponseBody'];

const sendJson = jest.mocked(apiClient.sendJson);
const PROJECT = 'project-1';
const copy = en.dashboard.surveys;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const TIERS = [
  { id: 'tier-1', title: 'Early bird' },
  { id: 'tier-2', title: 'Collector' },
];

function draft(id: string, extra: Partial<ContractSurvey> = {}): ContractSurvey {
  return {
    id,
    title: `Survey ${id}`,
    sent: false,
    responseCount: 0,
    questions: [{ id: `${id}-q1`, prompt: 'Which size?', type: 'CHOICE', required: true, choices: ['S', 'M'] }],
    ...extra,
  };
}

function sent(id: string): ContractSurvey {
  return draft(id, { sent: true, sentTo: 40, responseCount: 12, sentAt: '2026-10-01T10:00:00Z' });
}

/** What the service answers each read with, by path. */
let surveysAnswer: () => Promise<unknown>;
let tiersAnswer: () => Promise<unknown>;

let client: QueryClient;

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <SurveyBuilder projectId={PROJECT} />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

/** The press handler a control holds now. Called twice, it is two taps landing before React renders again. */
function pressHandlerOf(element: { readonly unstable_fiber: unknown }): () => void {
  interface FiberLike {
    readonly memoizedProps: { readonly onPress?: unknown } | null;
    readonly return: FiberLike | null;
  }
  let fiber = element.unstable_fiber as FiberLike | null;
  while (fiber !== null) {
    const onPress = fiber.memoizedProps?.onPress;
    if (typeof onPress === 'function') return onPress as () => void;
    fiber = fiber.return;
  }
  throw new Error('No press handler above this element.');
}

async function doubleTap(element: { readonly unstable_fiber: unknown }) {
  const press = pressHandlerOf(element);
  await act(async () => {
    press();
    press();
  });
  await settle();
}

function button(name: string) {
  return screen.getByRole('button', { name });
}

async function choose(combobox: string, option: string) {
  await fireEvent.press(screen.getByTestId(combobox));
  await fireEvent.press(screen.getByRole('radio', { name: option }));
}

/** The body of the last write to `path`. */
function lastBody(method: string, path: string) {
  const call = sendJson.mock.calls.filter(([m, p]) => m === method && p === path).at(-1);
  return call?.[2] as { questions: Record<string, unknown>[] } & Record<string, unknown>;
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  sendJson.mockReset();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
  surveysAnswer = async () => ({ surveys: [] });
  tiersAnswer = async () => TIERS;
  mockGet.mockReset().mockImplementation((path: string) =>
    path.endsWith('/rewards') ? tiersAnswer() : surveysAnswer(),
  );
});

describe('states', () => {
  it('asks a signed-out reader to sign in, and comes back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();
    await fireEvent.press(button(en.shell.actions.signIn));
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ returnTo: '/campaigns/project-1/dashboard/surveys' }) }),
    );
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('shows a skeleton while the surveys load', async () => {
    surveysAnswer = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('surveys-loading')).toBeTruthy();
    expect(screen.getByLabelText(copy.loading)).toBeTruthy();
  });

  it.each([
    [401, en.dashboard.failures.signedOut],
    [403, copy.notGranted],
    [404, en.dashboard.failures.noCampaign],
    [503, en.mobile.dashboardSurveys.unavailable],
  ])('words a %s with a retry', async (status, words) => {
    surveysAnswer = async () => {
      throw new ApiError(status, null);
    };
    await show();
    expect(screen.getByText(en.mobile.dashboardSurveys.failedTitle)).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();

    surveysAnswer = async () => ({ surveys: [draft('a')] });
    await fireEvent.press(button(en.common.tryAgain));
    await settle();
    expect(screen.getByTestId('survey-row-a')).toBeTruthy();
  });

  it('says nothing was cached when it opens offline', async () => {
    setOnline(false);
    surveysAnswer = async () => {
      throw new TypeError('Network request failed');
    };
    await show();
    expect(screen.getByText(en.mobile.offline.nothingCached)).toBeTruthy();
  });

  it('says there are no surveys yet, with the new survey form ready', async () => {
    await show();
    expect(screen.getByTestId('surveys-empty')).toBeTruthy();
    expect(screen.getByTestId('surveys-form-heading')).toHaveTextContent(copy.newHeading);
    expect(button(copy.createDraft)).toBeTruthy();
  });

  it('keeps the surveys read offline and disables every write', async () => {
    surveysAnswer = async () => ({ surveys: [draft('a')] });
    await show();
    await act(async () => setOnline(false));
    await settle();

    expect(screen.getByText(en.mobile.dashboardSurveys.offline)).toBeTruthy();
    expect(screen.getByTestId('survey-row-a')).toBeTruthy();
    expect(button(copy.createDraft)).toBeDisabled();
    expect(button('Delete the draft survey Survey a')).toBeDisabled();
  });
});

describe('the list', () => {
  it('says what each survey is, and offers to delete drafts only', async () => {
    surveysAnswer = async () => ({ surveys: [sent('s'), draft('d')] });
    await show();

    expect(within(screen.getByTestId('survey-row-s')).getByText('Sent to 40 · 12 answered')).toBeTruthy();
    expect(within(screen.getByTestId('survey-row-d')).getByText(copy.draft)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete the draft survey Survey s' })).toBeNull();

    sendJson.mockResolvedValueOnce(null);
    await fireEvent.press(button('Delete the draft survey Survey d'));
    await settle();
    expect(sendJson).toHaveBeenCalledWith('DELETE', '/v1/surveys/d');
    expect(screen.queryByTestId('survey-row-d')).toBeNull();
    expect(screen.getByTestId('survey-status')).toHaveTextContent('Deleted “Survey d”.');
  });
});

describe('the form', () => {
  it('creates a draft, then saves it, with a lime button in near-black text', async () => {
    await show();
    const create = button(copy.createDraft);
    expect(within(create).getByText(copy.createDraft, { includeHiddenElements: true })).toHaveStyle({
      color: colors.textOnLime,
    });

    await fireEvent.changeText(screen.getByTestId('survey-title'), 'Sizes');
    await fireEvent.changeText(screen.getByTestId('survey-question-1-prompt'), 'Your size?');
    sendJson.mockResolvedValueOnce(draft('new', { title: 'Sizes' }));
    await fireEvent.press(create);
    await settle();

    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/projects/project-1/surveys', {
      title: 'Sizes',
      message: undefined,
      respondBy: undefined,
      questions: [
        { prompt: 'Your size?', helpText: undefined, type: 'TEXT', required: false, choices: [], rewardTierId: undefined },
      ],
    });
    expect(screen.getByTestId('survey-status')).toHaveTextContent(copy.createdNotice);
    expect(screen.getByTestId('surveys-form-heading')).toHaveTextContent(copy.editHeading);

    sendJson.mockResolvedValueOnce(draft('new', { title: 'Sizes 2' }));
    await fireEvent.press(button(copy.save));
    await settle();
    expect(sendJson).toHaveBeenLastCalledWith('PUT', '/v1/surveys/new', expect.anything());
    expect(screen.getByTestId('survey-status')).toHaveTextContent(copy.savedNotice);
  });

  it('creates one draft for two taps in the same frame', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('survey-title'), 'Sizes');
    sendJson.mockResolvedValueOnce(draft('new', { title: 'Sizes' }));

    await doubleTap(screen.getByTestId('survey-save'));
    expect(sendJson.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
    expect(screen.getByTestId('survey-status')).toHaveTextContent(copy.createdNotice);
  });

  it('keeps options only for the choice types, as typed', async () => {
    await show();
    await choose('survey-question-1-type', copy.types.CHOICE);
    const options = screen.getByTestId('survey-question-1-options');
    await fireEvent.changeText(options, 'S\nM\n');
    // The trailing line is the next option being typed, not an empty one to drop.
    expect(screen.getByTestId('survey-question-1-options').props.value).toBe('S\nM\n');

    await choose('survey-question-1-type', copy.types.MULTI_CHOICE);
    expect(screen.getByTestId('survey-question-1-options').props.value).toBe('S\nM');

    await choose('survey-question-1-type', copy.types.DATE);
    expect(screen.queryByTestId('survey-question-1-options')).toBeNull();
    await choose('survey-question-1-type', copy.types.CHOICE);
    expect(screen.getByTestId('survey-question-1-options').props.value).toBe('');

    await choose('survey-question-1-type', copy.types.TEXT);
    await fireEvent.changeText(screen.getByTestId('survey-title'), 'Sizes');
    sendJson.mockResolvedValueOnce(draft('new'));
    await fireEvent.press(button(copy.createDraft));
    await settle();
    expect(lastBody('POST', '/v1/projects/project-1/surveys').questions[0]).toMatchObject({ type: 'TEXT', choices: [] });
  });

  it('offers no "required" for a postal address, and explains it instead', async () => {
    await show();
    expect(screen.getByTestId('survey-question-1-required')).toBeTruthy();
    await choose('survey-question-1-type', copy.types.ADDRESS);
    expect(screen.queryByTestId('survey-question-1-required')).toBeNull();
    expect(screen.getByText(copy.addressNote)).toBeTruthy();
  });

  it('adds and removes questions, keeping at least one', async () => {
    await show();
    expect(screen.queryByTestId('survey-question-1-remove')).toBeNull();
    await fireEvent.press(button(copy.addQuestion));
    expect(screen.getByTestId('survey-question-2')).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId('survey-question-1')).getByRole('button', { name: copy.removeQuestion }));
    expect(screen.queryByTestId('survey-question-2')).toBeNull();
    expect(screen.queryByTestId('survey-question-1-remove')).toBeNull();
  });

  it('locks a sent survey’s questions and offers no send', async () => {
    surveysAnswer = async () => ({ surveys: [sent('s')] });
    await show();
    await fireEvent.press(screen.getByTestId('survey-open-s'));

    expect(screen.getByTestId('surveys-form-heading')).toHaveTextContent(copy.sentHeading);
    expect(screen.getByText(copy.questionsLegendLocked)).toBeTruthy();
    expect(screen.getByTestId('survey-question-1-prompt').props.editable).toBe(false);
    expect(button(copy.addQuestion)).toBeDisabled();
    expect(screen.queryByTestId('survey-send')).toBeNull();
    // The title and the note stay editable: they are prose nobody answered.
    expect(screen.getByTestId('survey-title').props.editable).not.toBe(false);
  });
});

describe('the reward tier condition', () => {
  it('is populated from the campaign’s rewards and sends the chosen tier', async () => {
    await show();
    expect(mockGet).toHaveBeenCalledWith('/v1/projects/{projectId}/rewards', expect.objectContaining({ path: { projectId: PROJECT } }));

    await fireEvent.press(screen.getByTestId('survey-question-1-tier'));
    expect(screen.getByRole('radio', { name: copy.everybody })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Collector' }));

    await fireEvent.changeText(screen.getByTestId('survey-title'), 'Sizes');
    sendJson.mockResolvedValueOnce(draft('new'));
    await fireEvent.press(button(copy.createDraft));
    await settle();
    expect(lastBody('POST', '/v1/projects/project-1/surveys').questions[0]?.rewardTierId).toBe('tier-2');
  });

  it('is hidden with a note when the tiers do not load, and the rest still works', async () => {
    tiersAnswer = async () => {
      throw new ApiError(503, null);
    };
    await show();
    expect(screen.getByText(en.mobile.dashboardSurveys.tiersFailed)).toBeTruthy();
    expect(screen.queryByTestId('survey-question-1-tier')).toBeNull();
    expect(button(copy.createDraft)).not.toBeDisabled();
  });
});

describe('sending', () => {
  async function editDraft() {
    surveysAnswer = async () => ({ surveys: [draft('d')] });
    await show();
    await fireEvent.press(screen.getByTestId('survey-open-d'));
  }

  it('asks twice, then sends and says to how many', async () => {
    await editDraft();
    await fireEvent.press(button(copy.send));
    expect(sendJson).not.toHaveBeenCalled();

    sendJson.mockResolvedValueOnce(sent('d'));
    await fireEvent.press(button(copy.confirmSend));
    await settle();
    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/surveys/d/send');
    expect(screen.getByTestId('survey-status')).toHaveTextContent('Sent to 40 backers.');
    expect(screen.getByTestId('surveys-form-heading')).toHaveTextContent(copy.sentHeading);
  });

  it('sends once for two taps on the confirmation in the same frame', async () => {
    await editDraft();
    await fireEvent.press(button(copy.send));
    sendJson.mockResolvedValueOnce(sent('d'));

    await doubleTap(button(copy.confirmSend));
    expect(sendJson.mock.calls.filter(([, path]) => path === '/v1/surveys/d/send')).toHaveLength(1);
    expect(screen.getByTestId('survey-status')).toHaveTextContent('Sent to 40 backers.');
  });

  it('stands the confirmation down when anything else is pressed', async () => {
    await editDraft();
    await fireEvent.press(button(copy.send));
    await fireEvent.press(button(copy.addQuestion));
    expect(button(copy.send)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.confirmSend })).toBeNull();
  });

  it('stands the confirmation down after five seconds', async () => {
    await editDraft();
    jest.useFakeTimers();
    try {
      await fireEvent.press(button(copy.send));
      expect(button(copy.confirmSend)).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(SEND_CONFIRM_MS);
      });
      expect(button(copy.send)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    [new ApiError(409, null), copy.alreadySent],
    [new ApiError(422, { type: 'about:blank', title: 'Unprocessable', status: 422, detail: 'Add a question first.' }), 'Add a question first.'],
    [new ApiError(422, null), copy.needsQuestion],
    [new ApiError(400, null), copy.invalid],
  ])('words a refused send', async (error, words) => {
    await editDraft();
    sendJson.mockRejectedValueOnce(error);
    await fireEvent.press(button(copy.send));
    await fireEvent.press(button(copy.confirmSend));
    await settle();
    expect(screen.getByTestId('survey-status')).toHaveTextContent(words);
    expect(button(copy.send)).toBeTruthy();
  });

  it('starts a new survey from an open one', async () => {
    await editDraft();
    await fireEvent.press(button(copy.startNew));
    expect(screen.getByTestId('surveys-form-heading')).toHaveTextContent(copy.newHeading);
    expect(screen.getByTestId('survey-title').props.value).toBe('');
  });
});
