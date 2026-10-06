import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccessibilityInfo, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { BackerSurvey, SurveyQuestion } from '@ideanest/account/surveys';
import { ApiError } from '@ideanest/api-client';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import ru from '@ideanest/messages/ru.json';
import tr from '@ideanest/messages/tr.json';
import { queryKeys } from '../../api/queries';
import { setOnline } from '../../lib/connectivity';
import { formatDate } from '../../lib/i18n';
import { setLocale } from '../../lib/locale';
import * as apiClient from '../../api/client';
import { dateAnswerOf } from './survey-form';
import { SurveysScreen } from './survey-list';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockSession = { signedIn: true, locked: false, unlocked: false };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../lib/use-session', () => ({ useSession: () => mockSession }));
const mockGet = jest.fn();
jest.mock('../../api/client', () => ({
  api: () => ({ get: mockGet }),
  sendJson: jest.fn(),
  traceIdOfError: () => null,
}));
/*
 * The picker is a native view; here it is a stand-in that hands its `onValueChange` to the test,
 * so a test can choose a day the way the calendar would.
 */
jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function Picker(props: Record<string, unknown>) {
    return createElement(View, { testID: props.testID, value: props.value, onValueChange: props.onValueChange });
  }
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() } };
});

jest.setTimeout(30_000);

const sendJson = jest.mocked(apiClient.sendJson);
/** The service's answer to `GET /v1/me/surveys`: the test's surveys, once each call. */
const api = {
  listMySurveys: {
    mockResolvedValueOnce(list: readonly BackerSurvey[]) {
      mockGet.mockResolvedValueOnce({ surveys: list });
      return api.listMySurveys;
    },
    mockRejectedValueOnce(error: unknown) {
      mockGet.mockRejectedValueOnce(error);
      return api.listMySurveys;
    },
    mockRejectedValue(error: unknown) {
      mockGet.mockRejectedValue(error);
      return api.listMySurveys;
    },
    mockReturnValueOnce(value: Promise<never>) {
      mockGet.mockReturnValueOnce(value);
      return api.listMySurveys;
    },
  },
};
const androidPicker = jest.mocked(DateTimePickerAndroid);
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const CATALOGUES = { az, en, ru, tr } as const;
type LocaleName = keyof typeof CATALOGUES;

function question(id: string, extra: Partial<SurveyQuestion> = {}): SurveyQuestion {
  return { id, position: null, prompt: `Prompt ${id}`, helpText: null, type: 'TEXT', required: false, choices: [], rewardTierId: null, ...extra };
}

function survey(id: string, extra: Partial<BackerSurvey> = {}): BackerSurvey {
  return {
    surveyId: id,
    projectId: 'project-1',
    pledgeId: `pledge-${id}`,
    title: `Survey ${id}`,
    message: null,
    respondBy: null,
    open: true,
    answered: false,
    submittedAt: null,
    questions: [],
    answers: [],
    ...extra,
  };
}

let client: QueryClient;

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show({ locale = 'en', seed }: { locale?: LocaleName; seed?: readonly BackerSurvey[] } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 60_000 } } });
  if (seed !== undefined) client.setQueryData(queryKeys.surveys(), seed);
  await act(async () => setLocale(locale));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale={locale} messages={CATALOGUES[locale]}>
          <SurveysScreen />
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

const card = (s: BackerSurvey) => `survey-${s.surveyId}:${s.pledgeId}`;

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.clearAllMocks();
  // Reset, not only cleared: a test's unconsumed answers must not reach the next one.
  mockGet.mockReset();
  sendJson.mockReset();
  setOnline(true);
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

describe('SurveysScreen states', () => {
  it('shows two skeleton cards, named, while the list loads', async () => {
    api.listMySurveys.mockReturnValueOnce(new Promise(() => {}));
    await show();

    expect(screen.getByTestId('surveys-loading').props.accessibilityLabel).toBe(en.account.surveys.list.loading);
    expect(screen.getByText(en.account.pages.surveys.title)).toBeTruthy();
  });

  it('says there is nothing to answer, with a way to browse', async () => {
    api.listMySurveys.mockResolvedValueOnce([]);
    await show();

    expect(screen.getByText(en.account.surveys.list.emptyTitle)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.common.browseCampaigns));
    expect(mockRouter.push).toHaveBeenCalledWith('/discover');
  });

  it('names the failure and retries', async () => {
    api.listMySurveys.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([survey('a')]);
    await show();

    expect(screen.getByText(en.account.surveys.list.failedTitle)).toBeTruthy();
    expect(screen.getByText(en.account.surveys.list.unreachable)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.common.tryAgain));
    await settle();
    expect(screen.getByTestId(card(survey('a')))).toBeTruthy();
  });

  it('shows the service’s own reason when it refused', async () => {
    api.listMySurveys.mockRejectedValueOnce(new ApiError(403, { status: 403, detail: 'Not for you.' }));
    await show();
    expect(screen.getByText('Not for you.')).toBeTruthy();
  });

  it('offline, shows the cached list with a notice, and Save disabled with the reason', async () => {
    setOnline(false);
    api.listMySurveys.mockRejectedValue(new Error('offline'));
    const owed = survey('a', { questions: [question('q1')] });
    await show({ seed: [owed] });

    expect(screen.getByText(en.mobile.surveys.stale)).toBeTruthy();
    expect(screen.getByTestId(`${card(owed)}-offline`)).toBeTruthy();
    expect(screen.getByTestId(`${card(owed)}-save`).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId(`${card(owed)}-save`));
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('offline with nothing cached says so rather than loading for ever', async () => {
    setOnline(false);
    api.listMySurveys.mockRejectedValueOnce(new Error('offline'));
    await show();
    expect(screen.getByText(en.mobile.offline.nothingCached)).toBeTruthy();
  });

  it('signed out, asks to sign in and comes back here', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    await show();

    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByText(en.mobile.surveys.signedOutTitle)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(en.shell.actions.signIn));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: '/account/surveys' } });
  });
});

describe('SurveysScreen list', () => {
  it('puts open, unanswered surveys first and keeps the service order in each group', async () => {
    api.listMySurveys.mockResolvedValueOnce([
      survey('answered', { answered: true, submittedAt: '2026-09-01T10:00:00Z' }),
      survey('owed-1'),
      survey('closed', { open: false }),
      survey('owed-2'),
    ]);
    await show();

    const order = screen.getAllByText(/^Survey /).map((node) => node.props.children);
    expect(order).toEqual(['Survey owed-1', 'Survey owed-2', 'Survey answered', 'Survey closed']);
  });

  it('labels each state in words: needs an answer, answered, closed', async () => {
    const list = [survey('a'), survey('b', { answered: true }), survey('c', { open: false })];
    api.listMySurveys.mockResolvedValueOnce(list);
    await show();

    expect(within(screen.getByTestId(`${card(list[0]!)}-status`)).getByText(en.account.surveys.card.needsAnAnswer)).toBeTruthy();
    expect(within(screen.getByTestId(`${card(list[1]!)}-status`)).getByText(en.account.surveys.card.answered)).toBeTruthy();
    expect(within(screen.getByTestId(`${card(list[2]!)}-status`)).getByText(en.account.surveys.card.closed)).toBeTruthy();
  });

  it.each([
    ['en', 1],
    ['en', 3],
    ['az', 1],
    ['az', 4],
    ['ru', 1],
    ['ru', 3],
    ['ru', 5],
    ['tr', 1],
    ['tr', 2],
  ] as const)('counts the creators waiting in the %s plural form for %i', async (locale, count) => {
    const owed = Array.from({ length: count }, (_, index) => survey(`s${index}`));
    api.listMySurveys.mockResolvedValueOnce([...owed, survey('done', { answered: true })]);
    await show({ locale });

    const forms = CATALOGUES[locale].account.surveys.list.waitingTitle;
    const category = new Intl.PluralRules(locale).select(count) as keyof typeof forms;
    const expected = (forms[category] ?? forms.other).replace('{count}', String(count));
    expect(within(screen.getByTestId('surveys-waiting')).getByText(expected)).toBeTruthy();
    expect(screen.getByText(CATALOGUES[locale].account.surveys.list.waitingBody)).toBeTruthy();
  });

  it('answers under Reduce Motion as well: the cards render still and save', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const one = survey('one', { questions: [question('note')] });
    api.listMySurveys.mockResolvedValueOnce([one]);
    sendJson.mockResolvedValueOnce({ ...one, answered: true, answers: [{ questionId: 'note', value: ['Hi'] }] });
    await show();

    await fireEvent.changeText(screen.getByTestId('survey-question-note-text'), 'Hi');
    await fireEvent.press(screen.getByTestId(`${card(one)}-save`));
    await settle();
    expect(screen.getByTestId(`${card(one)}-saved`)).toBeTruthy();
  });

  it('shows no warning when nothing is owed', async () => {
    api.listMySurveys.mockResolvedValueOnce([survey('a', { answered: true }), survey('b', { open: false })]);
    await show();
    expect(screen.queryByTestId('surveys-waiting')).toBeNull();
  });

  it('reloads on pull to refresh', async () => {
    api.listMySurveys.mockResolvedValueOnce([survey('a')]).mockResolvedValueOnce([survey('a'), survey('b')]);
    await show();
    const control = screen.getByTestId('surveys').props.refreshControl as { props: { onRefresh: () => void } };
    await act(async () => control.props.onRefresh());
    await settle();

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(card(survey('b')))).toBeTruthy();
  });
});

describe('SurveyCard', () => {
  const full = survey('full', {
    questions: [
      question('note', { position: 4 }),
      question('colours', { type: 'MULTI_CHOICE', choices: ['Red', 'Green', 'Blue'], position: 2 }),
      question('when', { type: 'DATE', position: 3 }),
      question('where', { type: 'ADDRESS', position: 1, helpText: 'Where it goes' }),
      question('size', { type: 'CHOICE', choices: ['S', 'M'], required: true, position: null }),
    ],
  });

  it('draws the questions by position, unpositioned last', async () => {
    api.listMySurveys.mockResolvedValueOnce([full]);
    await show();

    const order = screen.getAllByTestId(/^survey-question-[a-z]+$/).map((node) => node.props.testID);
    expect(order).toEqual([
      'survey-question-where',
      'survey-question-colours',
      'survey-question-when',
      'survey-question-note',
      'survey-question-size',
    ]);
  });

  it('blocks the request until a required question is answered, and says so beside it', async () => {
    api.listMySurveys.mockResolvedValueOnce([full]);
    await show();

    await fireEvent.press(screen.getByTestId(`${card(full)}-save`));
    expect(sendJson).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('survey-question-size')).getByText(en.account.surveys.card.required)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('survey-question-size-M'));
    expect(within(screen.getByTestId('survey-question-size')).queryByText(en.account.surveys.card.required)).toBeNull();
  });

  it('sends every answer but ADDRESS, ticks in choice order and the date as YYYY-MM-DD, then replaces the card in the cache', async () => {
    const updated: BackerSurvey = {
      ...full,
      answered: true,
      submittedAt: '2026-10-06T08:00:00Z',
      answers: [
        { questionId: 'colours', value: ['Red', 'Blue'] },
        { questionId: 'when', value: ['2026-10-06'] },
        { questionId: 'note', value: ['Thanks'] },
        { questionId: 'size', value: ['M'] },
      ],
    };
    api.listMySurveys.mockResolvedValueOnce([full]);
    sendJson.mockResolvedValueOnce(updated);
    await show();

    await fireEvent.press(screen.getByTestId('survey-question-colours-Blue'));
    await fireEvent.press(screen.getByTestId('survey-question-colours-Red'));
    await fireEvent.press(screen.getByTestId('survey-question-when-date'));
    // Thirty minutes into the 6th in Baku is still the 5th in UTC.
    await act(async () =>
      (screen.getByTestId('survey-question-when-date-picker').props.onValueChange as (e: unknown, d: Date) => void)(
        { nativeEvent: { timestamp: 0, utcOffset: 0 } },
        new Date(2026, 9, 6, 0, 30),
      ),
    );
    await fireEvent.changeText(screen.getByTestId('survey-question-note-text'), 'Thanks');
    await fireEvent.press(screen.getByTestId('survey-question-size-M'));
    await fireEvent.press(screen.getByTestId(`${card(full)}-save`));
    await settle();

    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/surveys/full/respond', {
      pledgeId: 'pledge-full',
      answers: [
        { questionId: 'colours', value: ['Red', 'Blue'] },
        { questionId: 'when', value: ['2026-10-06'] },
        { questionId: 'note', value: ['Thanks'] },
        { questionId: 'size', value: ['M'] },
      ],
    });
    expect(client.getQueryData(queryKeys.surveys())).toEqual([updated]);
    expect(screen.getByTestId(`${card(full)}-saved`)).toBeTruthy();
    expect(within(screen.getByTestId(`${card(full)}-status`)).getByText(en.account.surveys.card.answered)).toBeTruthy();
  });

  it('lets today be chosen on iOS, where tapping the day already selected fires nothing', async () => {
    const today = survey('today', { questions: [question('when', { type: 'DATE', required: true })] });
    api.listMySurveys.mockResolvedValueOnce([today]);
    sendJson.mockResolvedValueOnce({ ...today, answered: true });
    await show();

    await fireEvent.press(screen.getByTestId('survey-question-when-date'));
    const now = new Date();
    const shown = formatDate(now.toISOString(), 'en');
    const confirm = screen.getByTestId('survey-question-when-date-confirm');
    expect(confirm.props.accessibilityLabel).toBe(`Use ${shown} as the answer to Prompt when`);
    await fireEvent.press(confirm);

    expect(screen.queryByTestId('survey-question-when-date-picker')).toBeNull();
    expect(screen.getByTestId('survey-question-when-date').props.accessibilityValue).toEqual({ text: shown });
    await fireEvent.press(screen.getByTestId(`${card(today)}-save`));
    await settle();
    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/surveys/today/respond', {
      pledgeId: 'pledge-today',
      answers: [{ questionId: 'when', value: [dateAnswerOf(now)] }],
    });
  });

  it('opens the calendar on the saved answer, and Use this date keeps it', async () => {
    const dated = survey('d', {
      questions: [question('when', { type: 'DATE' })],
      answers: [{ questionId: 'when', value: ['2026-03-04'] }],
    });
    api.listMySurveys.mockResolvedValueOnce([dated]);
    await show();

    await fireEvent.press(screen.getByTestId('survey-question-when-date'));
    expect(dateAnswerOf(screen.getByTestId('survey-question-when-date-picker').props.value as Date)).toBe('2026-03-04');
    expect(screen.getByTestId('survey-question-when-date-confirm').props.accessibilityLabel).toBe(
      'Use 4 Mar 2026 as the answer to Prompt when',
    );
    await fireEvent.press(screen.getByTestId('survey-question-when-date-confirm'));
    expect(screen.getByTestId('survey-question-when-date').props.accessibilityValue).toEqual({ text: '4 Mar 2026' });
  });

  it('opens the system date dialog on Android and keeps the calendar day', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    api.listMySurveys.mockResolvedValueOnce([full]);
    await show();

    await fireEvent.press(screen.getByTestId('survey-question-when-date'));
    expect(androidPicker.open).toHaveBeenCalledWith(expect.objectContaining({ mode: 'date' }));
    const options = androidPicker.open.mock.calls[0]?.[0] as { onValueChange: (e: unknown, d: Date) => void };
    await act(async () => options.onValueChange({}, new Date(2026, 0, 1, 0, 5)));

    expect(screen.getByTestId('survey-question-when-date').props.accessibilityValue).toEqual({ text: '1 Jan 2026' });
  });

  it('names the date field by its question, and lets an optional date be cleared', async () => {
    const dated = survey('d', {
      questions: [question('when', { type: 'DATE' })],
      answers: [{ questionId: 'when', value: ['2026-03-04'] }],
    });
    api.listMySurveys.mockResolvedValueOnce([dated]);
    await show();

    const field = screen.getByTestId('survey-question-when-date');
    expect(field.props.accessibilityLabel).toBe('Prompt when');
    expect(field.props.accessibilityValue).toEqual({ text: '4 Mar 2026' });
    const clear = screen.getByTestId('survey-question-when-date-clear');
    expect(clear.props.accessibilityLabel).toBe('Clear the date for Prompt when');
    await fireEvent.press(clear);
    expect(screen.getByTestId('survey-question-when-date').props.accessibilityValue).toEqual({
      text: en.mobile.surveys.chooseDate,
    });
  });

  it('does not offer to clear a required date', async () => {
    const dated = survey('d', {
      questions: [question('when', { type: 'DATE', required: true })],
      answers: [{ questionId: 'when', value: ['2026-03-04'] }],
    });
    api.listMySurveys.mockResolvedValueOnce([dated]);
    await show();

    expect(screen.getByTestId('survey-question-when-date').props.accessibilityLabel).toBe('Prompt when, required');
    expect(screen.queryByTestId('survey-question-when-date-clear')).toBeNull();
  });

  it('sends an ADDRESS question to the pledge’s address screen', async () => {
    api.listMySurveys.mockResolvedValueOnce([full]);
    await show();

    expect(screen.getByText(en.account.surveys.question.addressNote)).toBeTruthy();
    const link = screen.getByTestId('survey-question-where-address');
    expect(link.props.accessibilityRole).toBe('link');
    await fireEvent.press(link);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/pledges/[id]/address', params: { id: 'pledge-full' } });
  });

  it('shows a closed survey read-only: the reason, disabled fields and no Save', async () => {
    const closed = survey('closed', {
      open: false,
      answered: true,
      questions: [question('note'), question('colours', { type: 'MULTI_CHOICE', choices: ['Red'] })],
      answers: [{ questionId: 'note', value: ['Kept'] }],
    });
    api.listMySurveys.mockResolvedValueOnce([closed]);
    await show();

    expect(screen.getByTestId(`${card(closed)}-closed`)).toBeTruthy();
    expect(screen.queryByTestId(`${card(closed)}-save`)).toBeNull();
    expect(screen.getByTestId('survey-question-note-text').props.editable).toBe(false);
    expect(screen.getByTestId('survey-question-colours-Red').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('keeps the answers and names the failure when saving fails', async () => {
    const one = survey('one', { questions: [question('note')] });
    api.listMySurveys.mockResolvedValueOnce([one]);
    sendJson.mockRejectedValueOnce(new Error('down'));
    await show();

    await fireEvent.changeText(screen.getByTestId('survey-question-note-text'), 'Mine');
    await fireEvent.press(screen.getByTestId(`${card(one)}-save`));
    await settle();

    expect(within(screen.getByTestId(`${card(one)}-failed`)).getByText(en.account.surveys.card.unreachable)).toBeTruthy();
    expect(screen.getByTestId('survey-question-note-text').props.value).toBe('Mine');
  });
});
