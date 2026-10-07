import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { memoryStore } from '../../lib/storage';
import { BasicsPanel } from './basics-panel';
import { EditorProvider } from './editor-context';

jest.mock('../../lib/use-session', () => ({ useSession: () => ({ signedIn: true, locked: false, unlocked: false }) }));
let mockProject: () => Promise<unknown> = async () => ({});
let mockCategories: () => Promise<unknown> = async () => [];
jest.mock('../../api/client', () => ({
  api: () => ({
    get: (path: string) => (path === '/v1/categories' ? mockCategories() : mockProject()),
  }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));
const mockSend = jest.fn();
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'az', languageTag: 'az-AZ', decimalSeparator: ',' }],
}));
jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => createElement(View, { testID: props.testID }),
    DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() },
  };
});

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const CATEGORIES = [
  {
    id: 'c1',
    slug: 'design',
    name: 'Design',
    subcategories: [
      { id: 's1', slug: 'lamps', name: 'Lamps' },
      { id: 's2', slug: 'chairs', name: 'Chairs' },
    ],
  },
  { id: 'c2', slug: 'games', name: 'Games', subcategories: [] },
];

function project(extra: Partial<ProjectEdit> = {}): ProjectEdit {
  return {
    id: 'p1',
    slug: 'solar-lamp',
    state: 'DRAFT',
    title: 'Solar Lamp',
    blurb: 'A lamp.',
    categoryId: 'c1',
    subcategoryId: 's1',
    goal: { amount: '5000.00', currency: 'AZN' },
    durationDays: 30,
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

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <EditorProvider projectId="p1" store={memoryStore()}>
            <BasicsPanel />
          </EditorProvider>
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

const patches = () => mockSend.mock.calls.filter((call) => call[0] === 'PATCH').map((call) => call[2]);
/** A field's hint is drawn for the eye and read as the control's hint, so the drawn copy is hidden. */
const hint = (words: string) => screen.getByText(words, { includeHiddenElements: true });
const blur = async (testID: string) => {
  await fireEvent(screen.getByTestId(testID), 'blur');
  await settle();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  mockSend.mockImplementation(async () => project());
  mockProject = async () => project();
  mockCategories = async () => CATEGORIES;
  setOnline(true);
});

describe('BasicsPanel', () => {
  it('shows four named label-and-field placeholders while the project loads', async () => {
    mockProject = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('basics-loading').props.accessibilityLabel).toBe(en.campaignEditor.basics.loadingLabel);
  });

  it('fills every field from the project', async () => {
    await show();
    expect(screen.getByTestId('basics-title').props.value).toBe('Solar Lamp');
    expect(screen.getByTestId('basics-summary').props.value).toBe('A lamp.');
    expect(screen.getByTestId('basics-goal').props.value).toBe('5000.00');
    expect(screen.getByTestId('basics-duration').props.value).toBe('30');
    expect(screen.getByTestId('basics-currency')).toHaveTextContent('AZN');
    expect(screen.getByTestId('basics-category').props.accessibilityValue).toEqual({ text: 'Design' });
    expect(screen.getByTestId('basics-subcategory').props.accessibilityValue).toEqual({ text: 'Lamps' });
  });

  it('sends one field, on blur, and only that field', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('basics-title'), 'Solar Lamp Mini');
    await blur('basics-title');
    expect(patches()).toEqual([{ title: 'Solar Lamp Mini' }]);
    expect(mockSend).toHaveBeenCalledWith('PATCH', '/v1/projects/p1', { title: 'Solar Lamp Mini' });
  });

  it('refuses an empty title on the phone and sends nothing', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('basics-title'), '   ');
    await blur('basics-title');
    expect(screen.getByText(en.campaignEditor.basics.validation.titleRequired)).toBeTruthy();
    expect(patches()).toEqual([]);
  });

  it('refuses a duration outside 1 to 60 days', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('basics-duration'), '61');
    await blur('basics-duration');
    expect(screen.getByText('A campaign runs for 1 to 60 days.')).toBeTruthy();
    expect(patches()).toEqual([]);
  });

  it('reads the goal through parseAmount: a comma typed on this phone becomes a point, and goes as a string', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('basics-goal'), '12,5');
    expect(screen.getByTestId('basics-goal').props.value).toBe('12.5');
    await blur('basics-goal');
    expect(patches()).toEqual([{ goal: { amount: '12.50', currency: 'AZN' } }]);
  });

  it('refuses a goal with three decimals', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('basics-goal'), '1,500');
    await blur('basics-goal');
    expect(screen.getByText(en.campaignEditor.basics.validation.amount.tooManyDecimals)).toBeTruthy();
    expect(patches()).toEqual([]);
  });

  it('changing the category clears the subcategory, in the same patch', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('basics-category'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Games' }));
    await settle();
    expect(patches()).toEqual([{ categoryId: 'c2', subcategoryId: null }]);
    expect(hint(en.campaignEditor.basics.subcategoryHintNone)).toBeTruthy();
  });

  it('when the categories will not load, says so, disables only the pickers, and the rest still saves', async () => {
    mockCategories = async () => {
      throw new ApiError(500, { status: 500 });
    };
    await show();
    expect(screen.getByText(en.campaignEditor.basics.categoriesUnavailableTitle)).toBeTruthy();
    expect(screen.getByTestId('basics-category').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByTestId('basics-title'), 'Still saves');
    await blur('basics-title');
    expect(patches()).toEqual([{ title: 'Still saves' }]);
  });

  it('disables the locked fields and says why', async () => {
    mockProject = async () =>
      project({ state: 'LIVE', lockedFields: ['goal', 'durationDays', 'scheduledLaunchAt'] });
    await show();
    expect(screen.getByTestId('basics-goal').props.editable).toBe(false);
    expect(screen.getByTestId('basics-duration').props.editable).toBe(false);
    expect(screen.getByTestId('basics-launch').props.accessibilityState).toMatchObject({ disabled: true });
    expect(hint(en.campaignEditor.basics.goalHintLocked)).toBeTruthy();
    expect(hint(en.campaignEditor.basics.durationHintLocked)).toBeTruthy();
    expect(hint(en.mobile.editor.scheduledLaunchLocked)).toBeTruthy();
    expect(screen.getByTestId('basics-title').props.editable).toBe(true);
  });

  it('keeps a refused change, says so with the server’s words on the field, and retries it', async () => {
    mockSend.mockRejectedValueOnce(
      new ApiError(422, { status: 422, detail: 'That title is taken.', errors: { title: 'Choose another title.' } }),
    );
    await show();
    await fireEvent.changeText(screen.getByTestId('basics-title'), 'Taken');
    await blur('basics-title');

    const alert = screen.getByTestId('basics-not-saved');
    expect(within(alert).getByText(en.campaignEditor.basics.notSavedTitle)).toBeTruthy();
    expect(within(alert).getByText('That title is taken.')).toBeTruthy();
    expect(screen.getByText('Choose another title.')).toBeTruthy();
    expect(screen.getByTestId('basics-title').props.value).toBe('Taken');

    await fireEvent.press(screen.getByTestId('basics-retry'));
    await settle();
    expect(patches()).toEqual([{ title: 'Taken' }, { title: 'Taken' }]);
    expect(screen.queryByTestId('basics-not-saved')).toBeNull();
  });

  it('turns late pledges on at once, without waiting for a blur', async () => {
    await show();
    await fireEvent(screen.getByTestId('basics-late-pledges'), 'valueChange', true);
    await settle();
    expect(patches()).toEqual([{ latePledgeEnabled: true }]);
  });

  it('clears the scheduled launch with its own button, sending null', async () => {
    mockProject = async () => project({ scheduledLaunchAt: '2099-01-01T09:00:00.000Z' });
    await show();
    await fireEvent.press(screen.getByLabelText(`Clear ${en.campaignEditor.basics.scheduledLaunch}`));
    await settle();
    expect(patches()).toEqual([{ scheduledLaunchAt: null }]);
  });

  it('offline, every field is read-only', async () => {
    await show();
    await act(async () => setOnline(false));
    expect(screen.getByTestId('basics-title').props.editable).toBe(false);
    expect(screen.getByTestId('basics-goal').props.editable).toBe(false);
    await fireEvent.changeText(screen.getByTestId('basics-title'), 'Offline');
    await blur('basics-title');
    expect(patches()).toEqual([]);
  });
});
