import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit, ProjectFaq } from '@ideanest/campaign-editor/contract';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { memoryStore } from '../../../lib/storage';
import { EditorProvider } from '../editor-context';
import { FaqPanel } from './faq-panel';

jest.mock('../../../lib/use-session', () => ({ useSession: () => ({ signedIn: true, locked: false, unlocked: false }) }));
let mockProject: () => Promise<unknown> = async () => ({});
let mockFaqs: () => Promise<unknown> = async () => ({ faqs: [] });
const mockSend = jest.fn();
jest.mock('../../../api/client', () => ({
  api: () => ({
    get: (path: string) => (path === '/v1/projects/{projectId}/faqs' ? mockFaqs() : mockProject()),
  }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const PROJECT: ProjectEdit = {
  id: 'p1',
  slug: 'solar-lamp',
  state: 'DRAFT',
  title: 'Solar Lamp',
  latePledgeEnabled: false,
  lockedFields: [],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const SHIP: ProjectFaq = { id: 'f-ship', question: 'Do you ship to Germany?', answer: 'Yes.\n\nFrom March.\nTracked.' };
const WHEN: ProjectFaq = { id: 'f-when', question: 'When does it ship?', answer: 'In March.' };
const BATTERY: ProjectFaq = { id: 'f-battery', question: 'Is the battery replaceable?', answer: 'Yes.' };

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(locale: 'en' | 'az' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => setLocale(locale));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale={locale} messages={locale === 'az' ? az : en}>
          <EditorProvider projectId="p1" store={memoryStore()}>
            <FaqPanel />
          </EditorProvider>
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

const said = () => [
  ...jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls.map((call) => call[0]),
  ...jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map((call) => call[0]),
];
const order = () => screen.getAllByTestId(/^faq-f-[a-z]+$/u).map((row) => String(row.props.testID).slice('faq-'.length));

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  mockSend.mockReset();
  mockProject = async () => PROJECT;
  mockFaqs = async () => ({ faqs: [SHIP, WHEN, BATTERY] });
  setOnline(true);
});

describe('FaqPanel', () => {
  it('shows three named rows while the project loads', async () => {
    mockProject = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('faq-loading').props.accessibilityLabel).toBe(en.campaignEditor.faq.loadingLabel);
  });

  it('shows the list loading under the heading once the project is there', async () => {
    mockFaqs = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('faq-list-loading')).toBeTruthy();
    expect(screen.getByText(en.mobile.editor.faq.heading)).toBeTruthy();
  });

  it('says the questions could not be loaded, and tries again', async () => {
    mockFaqs = async () => {
      throw new ApiError(500, { status: 500 });
    };
    await show();
    expect(within(screen.getByTestId('faq-list-failed')).getByText(en.campaignEditor.faq.questionsFailedTitle)).toBeTruthy();
    mockFaqs = async () => ({ faqs: [WHEN] });
    await fireEvent.press(screen.getByTestId('faq-retry'));
    await settle();
    expect(screen.getByTestId('faq-f-when')).toBeTruthy();
  });

  it('explains an empty list and offers the first question', async () => {
    mockFaqs = async () => ({ faqs: [] });
    await show();
    expect(within(screen.getByTestId('faq-empty')).getByText(en.campaignEditor.faq.emptyTitle)).toBeTruthy();
    expect(screen.getByTestId('faq-add-first')).toBeTruthy();
  });

  it('draws each answer cut to two lines, keeping its line breaks', async () => {
    await show();
    const answer = screen.getByTestId('faq-f-ship-answer');
    expect(answer.props.numberOfLines).toBe(2);
    expect(answer.props.children).toBe('Yes.\n\nFrom March.\nTracked.');
    expect(screen.getByText('(3)')).toBeTruthy();
  });

  it('names the controls of each row with its question and place', async () => {
    await show();
    expect(screen.getByLabelText('Move When does it ship? up, currently 2 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Move When does it ship? down, currently 2 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Edit When does it ship?')).toBeTruthy();
    expect(screen.getByLabelText('Delete When does it ship?')).toBeTruthy();
  });

  it('moves a question at once, sends every id, and announces where it went', async () => {
    mockSend.mockImplementation(async () => ({ faqs: [SHIP, BATTERY, WHEN] }));
    await show();
    await fireEvent.press(screen.getByTestId('faq-f-when-move-down'));
    expect(order()).toEqual(['f-ship', 'f-battery', 'f-when']);
    await settle();
    expect(mockSend.mock.calls).toEqual([
      ['PATCH', '/v1/projects/p1/faqs/reorder', { faqIds: ['f-ship', 'f-battery', 'f-when'] }],
    ]);
    expect(said()).toContain('When does it ship? moved to position 3 of 3.');
  });

  it('on FAQ_ORDER_INCOMPLETE, reads the list again and names the questions the lists disagreed about', async () => {
    mockSend.mockImplementation(async () => {
      throw new ApiError(409, {
        status: 409,
        detail: 'The order did not name every question.',
        code: 'FAQ_ORDER_INCOMPLETE',
        meta: { missing: ['f-new'], unexpected: ['f-battery'] },
      });
    });
    await show();
    const fresh: ProjectFaq = { id: 'f-new', question: 'Is there a warranty?', answer: 'Two years.' };
    mockFaqs = async () => ({ faqs: [SHIP, WHEN, fresh] });
    await fireEvent.press(screen.getByTestId('faq-f-when-move-down'));
    await settle();

    expect(order()).toEqual(['f-ship', 'f-when', 'f-new']);
    const explanation = screen.getByTestId('faq-order-explanation');
    expect(explanation).toHaveTextContent(/this page had not seen “Is there a warranty\?”/u);
    expect(explanation).toHaveTextContent(/“Is the battery replaceable\?” no longer exists/u);
  });

  it('runs the screen reader’s actions, delete included', async () => {
    await show();
    const summary = screen.getByTestId('faq-f-ship-summary');
    expect((summary.props.accessibilityActions as { name: string }[]).map((action) => action.name)).toEqual([
      'moveDown',
      'delete',
    ]);
    await fireEvent(summary, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(screen.getByText('Delete “Do you ship to Germany?”?')).toBeTruthy();
  });

  it('adds a question, refusing a blank one first in the reader’s language', async () => {
    mockSend.mockImplementation(async (_method: string, _path: string, body: Record<string, unknown>) => ({
      id: 'f-new',
      ...body,
    }));
    await show('az');
    await fireEvent.press(screen.getByTestId('faq-add'));
    await fireEvent.press(screen.getByTestId('faq-editor-save'));
    await settle();
    expect(screen.getByText(az.campaignEditor.faq.validation.questionRequired, { includeHiddenElements: true })).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('faq-question'), 'Zəmanət var?');
    await fireEvent.changeText(screen.getByTestId('faq-answer'), 'İki il.\n\nPulsuz.');
    await fireEvent.press(screen.getByTestId('faq-editor-save'));
    await settle();
    expect(mockSend.mock.calls).toEqual([
      ['POST', '/v1/projects/p1/faqs', { question: 'Zəmanət var?', answer: 'İki il.\n\nPulsuz.' }],
    ]);
    expect(screen.getByTestId('faq-f-new')).toBeTruthy();
  });

  it('edits only what changed', async () => {
    mockSend.mockImplementation(async () => ({ ...WHEN, answer: 'In April.' }));
    await show();
    await fireEvent.press(screen.getByTestId('faq-f-when-edit'));
    await fireEvent.changeText(screen.getByTestId('faq-answer'), 'In April.');
    await fireEvent.press(screen.getByTestId('faq-editor-save'));
    await settle();
    expect(mockSend.mock.calls).toEqual([['PATCH', '/v1/faqs/f-when', { answer: 'In April.' }]]);
    expect(screen.getByTestId('faq-f-when-answer')).toHaveTextContent('In April.');
  });

  it('deletes a question after the confirmation and says so', async () => {
    mockSend.mockImplementation(async () => null);
    await show();
    await fireEvent.press(screen.getByTestId('faq-f-when-delete'));
    await fireEvent.press(screen.getByTestId('faq-delete-delete'));
    await settle();
    expect(mockSend.mock.calls).toEqual([['DELETE', '/v1/faqs/f-when']]);
    expect(screen.queryByTestId('faq-f-when')).toBeNull();
    expect(said()).toContain('When does it ship? was deleted.');
  });

  it('stops at fifty questions and says why', async () => {
    mockFaqs = async () => ({
      faqs: Array.from({ length: 50 }, (_, index) => ({ id: `f-${index}`, question: `Q${index}`, answer: 'A' })),
    });
    await show();
    expect(screen.getByText('A campaign may publish 50 questions. Delete one to add another.')).toBeTruthy();
    expect(screen.getByTestId('faq-add').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('offline, shows the list as last loaded and changes nothing', async () => {
    await show();
    await act(async () => setOnline(false));
    await settle();
    expect(screen.getByTestId('faq-f-when')).toBeTruthy();
    for (const id of ['faq-add', 'faq-f-when-edit', 'faq-f-when-delete', 'faq-f-when-move-up']) {
      expect(screen.getByTestId(id).props.accessibilityState).toMatchObject({ disabled: true });
    }
  });

  it('offline with nothing loaded yet, says so', async () => {
    mockFaqs = () => new Promise(() => {});
    await show();
    await act(async () => setOnline(false));
    await settle();
    expect(screen.getByTestId('faq-nothing-cached')).toBeTruthy();
  });
});
