import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { Item, ProjectEdit, Reward } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { queryKeys } from '../../../api/queries';
import { setOnline } from '../../../lib/connectivity';
import { setLocale } from '../../../lib/locale';
import { memoryStore } from '../../../lib/storage';
import { EditorProvider } from '../editor-context';
import { RewardsPanel } from './rewards-panel';

jest.mock('../../../lib/use-session', () => ({ useSession: () => ({ signedIn: true, locked: false, unlocked: false }) }));
let mockProject: () => Promise<unknown> = async () => ({});
let mockItems: () => Promise<unknown> = async () => [];
let mockRewards: () => Promise<unknown> = async () => [];
const mockSend = jest.fn();
jest.mock('../../../api/client', () => ({
  api: () => ({
    get: (path: string) =>
      path === '/v1/projects/{projectId}/items'
        ? mockItems()
        : path === '/v1/projects/{projectId}/rewards'
          ? mockRewards()
          : mockProject(),
  }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
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

const PROJECT: ProjectEdit = {
  id: 'p1',
  slug: 'solar-lamp',
  state: 'DRAFT',
  title: 'Solar Lamp',
  goal: { amount: '5000.00', currency: 'AZN' },
  latePledgeEnabled: false,
  lockedFields: [],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const MUG: Item = {
  id: 'i-mug',
  projectId: 'p1',
  name: 'Enamel mug',
  description: 'Chipped by design.',
  imageUrl: null,
  weightGrams: 320,
  isDigital: false,
  sku: 'MUG-01',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

function reward(id: string, title: string, extra: Partial<Reward> = {}): Reward {
  return {
    id,
    projectId: 'p1',
    title,
    description: null,
    price: { amount: '25.00', currency: 'AZN' },
    estimatedDelivery: null,
    limitQuantity: null,
    claimedQuantity: 0,
    reservedQuantity: 0,
    remainingQuantity: null,
    shippingType: 'NONE',
    isEarlyBird: false,
    isFeatured: false,
    isSecret: false,
    secretToken: null,
    isAddon: false,
    sortOrder: 0,
    availableFrom: null,
    availableUntil: null,
    items: [],
    shippingRules: [],
    version: 1,
    pricingLocked: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
}

const THANKS = reward('r-thanks', 'Thank you', { items: [{ itemId: 'i-mug', quantity: 2 }] });
const LAMP = reward('r-lamp', 'The lamp', { estimatedDelivery: '2027-03-01', isFeatured: true });
const POSTER = reward('r-poster', 'Poster', { claimedQuantity: 3, limitQuantity: 10, remainingQuantity: 7 });

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let client: QueryClient;

async function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          <EditorProvider projectId="p1" store={memoryStore()}>
            <RewardsPanel />
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
const calls = (method: string) => mockSend.mock.calls.filter((call) => call[0] === method);
const tierOrder = () =>
  screen.getAllByTestId(/^reward-r-[a-z]+$/u).map((card) => String(card.props.testID).slice('reward-'.length));
const refusal = (status: number, code: string, meta: Record<string, unknown> | null = null, detail = 'Refused.') =>
  new ApiError(status, { type: 'about:blank', title: 'Refused', status, detail, code, ...(meta === null ? {} : { meta }) });

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  mockSend.mockReset();
  mockProject = async () => PROJECT;
  mockItems = async () => [MUG];
  mockRewards = async () => [THANKS, LAMP, POSTER];
  setOnline(true);
});

describe('RewardsPanel', () => {
  it('shows three named blocks while the project loads', async () => {
    mockProject = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('rewards-loading').props.accessibilityLabel).toBe(en.campaignEditor.rewards.loadingLabel);
  });

  it('shows the items and the rewards loading once the project is there', async () => {
    mockItems = () => new Promise(() => {});
    await show();
    expect(screen.getByTestId('items-loading').props.accessibilityLabel).toBe(en.campaignEditor.rewards.items.loadingLabel);
    expect(screen.getByTestId('tiers-loading')).toBeTruthy();
  });

  it('says the lists could not be loaded, and tries again', async () => {
    mockRewards = async () => {
      throw refusal(500, 'BOOM', null, 'The rewards are unavailable.');
    };
    await show();
    const alert = screen.getByTestId('rewards-list-failed');
    expect(within(alert).getByText(en.campaignEditor.rewards.rewardsFailedTitle)).toBeTruthy();
    expect(within(alert).getByText('The rewards are unavailable.')).toBeTruthy();

    mockRewards = async () => [THANKS];
    await fireEvent.press(screen.getByTestId('rewards-retry'));
    await settle();
    expect(screen.queryByTestId('rewards-list-failed')).toBeNull();
    expect(screen.getByTestId('reward-r-thanks')).toBeTruthy();
  });

  it('offers the first item and the first reward when there are none', async () => {
    mockItems = async () => [];
    mockRewards = async () => [];
    await show();
    expect(within(screen.getByTestId('items-empty')).getByText(en.campaignEditor.rewards.items.emptyTitle)).toBeTruthy();
    expect(within(screen.getByTestId('tiers-empty')).getByText(en.campaignEditor.rewards.emptyTitle)).toBeTruthy();
    expect(screen.getByTestId('items-add-first')).toBeTruthy();
    expect(screen.getByTestId('tiers-add-first')).toBeTruthy();
  });

  it('draws an item’s kind, weight and stock code as words', async () => {
    await show();
    const card = screen.getByTestId('item-i-mug');
    expect(within(card).getByText('Physical')).toBeTruthy();
    expect(within(card).getByText('320 g')).toBeTruthy();
    expect(within(card).getByText('MUG-01')).toBeTruthy();
    expect(screen.getByLabelText('Edit Enamel mug')).toBeTruthy();
    expect(screen.getByLabelText('Delete Enamel mug')).toBeTruthy();
  });

  it('draws each reward’s price, places, delivery, tags and contents', async () => {
    await show();
    const thanks = screen.getByTestId('reward-r-thanks');
    expect(within(thanks).getByText('25.00 AZN · Unlimited places · Nothing is delivered')).toBeTruthy();
    expect(within(thanks).getByText('Contains Enamel mug ×2')).toBeTruthy();
    const lamp = screen.getByTestId('reward-r-lamp');
    expect(within(lamp).getByText('Featured')).toBeTruthy();
    expect(within(lamp).getByText('Delivers 2027-03-01')).toBeTruthy();
    expect(within(screen.getByTestId('reward-r-poster')).getByText('25.00 AZN · 7 of 10 places left · Nothing is delivered')).toBeTruthy();
    expect(screen.getByText('Rewards')).toBeTruthy();
    expect(screen.getByText('(3 of 100)')).toBeTruthy();
  });

  it('offers delete only while nobody has chosen the reward, and says why otherwise', async () => {
    await show();
    expect(screen.getByTestId('reward-r-thanks-delete')).toBeTruthy();
    expect(screen.queryByTestId('reward-r-poster-delete')).toBeNull();
    expect(screen.getByTestId('reward-r-poster-backed')).toHaveTextContent(
      '3 backers have chosen this reward, so it can be hidden but not deleted.',
    );
    const actions = screen.getByTestId('reward-r-poster-summary').props.accessibilityActions as { name: string }[];
    expect(actions.map((action) => action.name)).not.toContain('delete');
  });

  it('names every move button with the reward and its position', async () => {
    await show();
    expect(screen.getByLabelText('Move Thank you up, currently 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Move The lamp down, currently 2 of 3')).toBeTruthy();
    expect(screen.getByTestId('reward-r-thanks-move-up').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('moves a reward at once, sends the whole order, and announces where it went', async () => {
    mockSend.mockImplementation(async () => [LAMP, THANKS, POSTER]);
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-lamp-move-up'));
    expect(tierOrder()).toEqual(['r-lamp', 'r-thanks', 'r-poster']);
    await settle();
    expect(calls('PATCH')).toEqual([['PATCH', '/v1/projects/p1/rewards/reorder', { rewardIds: ['r-lamp', 'r-thanks', 'r-poster'] }]]);
    expect(said()).toContain('The lamp moved to position 1 of 3.');
    expect(client.getQueryData<readonly Reward[]>(queryKeys.editorRewards('p1'))?.map((one) => one.id)).toEqual([
      'r-lamp',
      'r-thanks',
      'r-poster',
    ]);
  });

  it('runs the screen reader’s move action like the button', async () => {
    mockSend.mockImplementation(async () => [THANKS, POSTER, LAMP]);
    await show();
    const summary = screen.getByTestId('reward-r-lamp-summary');
    const actions = summary.props.accessibilityActions as { name: string; label: string }[];
    expect(actions).toEqual([
      { name: 'moveUp', label: 'Move The lamp up, currently 2 of 3' },
      { name: 'moveDown', label: 'Move The lamp down, currently 2 of 3' },
      { name: 'delete', label: 'Delete The lamp' },
    ]);
    await fireEvent(summary, 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
    expect(tierOrder()).toEqual(['r-thanks', 'r-poster', 'r-lamp']);
  });

  it('on a refused reorder, shows the stored order again, says why and reads the list again', async () => {
    mockSend.mockImplementation(async () => {
      throw refusal(409, 'REWARD_ORDER_INCOMPLETE', null, 'The order is out of date.');
    });
    await show();
    let reads = 0;
    mockRewards = async () => {
      reads += 1;
      return [THANKS, LAMP, POSTER];
    };
    await fireEvent.press(screen.getByTestId('reward-r-lamp-move-up'));
    await settle();
    expect(tierOrder()).toEqual(['r-thanks', 'r-lamp', 'r-poster']);
    expect(within(screen.getByTestId('rewards-failure')).getByText('The order is out of date.')).toBeTruthy();
    expect(reads).toBe(1);
  });

  it('adds, duplicates and deletes nothing while a reorder is in the air', async () => {
    mockSend.mockImplementation(() => new Promise(() => {}));
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-lamp-move-up'));
    expect(screen.getByTestId('tiers-add').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('reward-r-thanks-duplicate').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('reward-r-thanks-delete').props.accessibilityState).toMatchObject({ disabled: true });
    const actions = screen.getByTestId('reward-r-thanks-summary').props.accessibilityActions as { name: string }[];
    expect(actions.map((action) => action.name)).not.toContain('delete');
  });

  it('rests a card’s move buttons while its own request is in the air', async () => {
    mockSend.mockImplementation(() => new Promise(() => {}));
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-lamp-hide'));
    expect(screen.getByTestId('reward-r-lamp-move-up').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('reward-r-lamp-summary').props.accessibilityActions).toEqual([]);
    expect(screen.getByTestId('reward-r-thanks-move-down').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('clears a refused reorder’s explanation once a later move goes through', async () => {
    mockSend
      .mockImplementationOnce(async () => {
        throw refusal(409, 'REWARD_ORDER_INCOMPLETE', null, 'The order is out of date.');
      })
      .mockImplementation(async () => [LAMP, THANKS, POSTER]);
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-lamp-move-up'));
    await settle();
    expect(screen.getByTestId('rewards-failure')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reward-r-lamp-move-up'));
    await settle();
    expect(screen.queryByTestId('rewards-failure')).toBeNull();
  });

  it('marks the creator’s public reward lists stale after a change', async () => {
    mockSend.mockImplementation(async () => reward('r-copy', 'Thank you (copy)'));
    await show();
    client.setQueryData(queryKeys.projectRewards('p1'), { items: [] });
    expect(client.getQueryState(queryKeys.projectRewards('p1'))?.isInvalidated).toBe(false);
    await fireEvent.press(screen.getByTestId('reward-r-thanks-duplicate'));
    await settle();
    expect(client.getQueryState(queryKeys.projectRewards('p1'))?.isInvalidated).toBe(true);
  });

  it('hides a reward by closing it now, and clears an opening still to come', async () => {
    const scheduled = reward('r-later', 'Later', { availableFrom: '2099-01-01T10:00:00.000Z' });
    mockRewards = async () => [scheduled];
    mockSend.mockImplementation(async (_method: string, _path: string, body: Record<string, unknown>) => ({
      ...scheduled,
      ...body,
    }));
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-later-hide'));
    await settle();
    const [, path, body] = calls('PATCH')[0] as [string, string, Record<string, unknown>];
    expect(path).toBe('/v1/rewards/r-later');
    expect(body.availableFrom).toBeNull();
    expect(typeof body.availableUntil).toBe('string');
    expect(within(screen.getByTestId('reward-r-later')).getByText('Hidden')).toBeTruthy();
    expect(said()).toContain('Later is hidden from the campaign page.');
  });

  it('will not show a hidden early bird with no limit, and says why', async () => {
    const early = reward('r-early', 'Early', { isEarlyBird: true, availableUntil: '2026-01-01T00:00:00.000Z' });
    mockRewards = async () => [early];
    await show();
    expect(screen.getByTestId('reward-r-early-show').props.accessibilityState).toMatchObject({ disabled: true });
    expect(
      within(screen.getByTestId('reward-r-early-blocked')).getByText(en.campaignEditor.rewards.vocabulary.showBlockedEarlyBird),
    ).toBeTruthy();
  });

  it('shows a hidden reward again with a null closing time', async () => {
    const hidden = reward('r-hidden', 'Hidden one', { availableUntil: '2026-01-01T00:00:00.000Z' });
    mockRewards = async () => [hidden];
    mockSend.mockImplementation(async () => ({ ...hidden, availableUntil: null }));
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-hidden-show'));
    await settle();
    expect(calls('PATCH')).toEqual([['PATCH', '/v1/rewards/r-hidden', { availableUntil: null }]]);
  });

  it('appends a duplicate and says where it went', async () => {
    mockSend.mockImplementation(async () => reward('r-copy', 'Thank you (copy)'));
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-thanks-duplicate'));
    await settle();
    expect(calls('POST')).toEqual([['POST', '/v1/rewards/r-thanks/duplicate']]);
    expect(tierOrder()).toEqual(['r-thanks', 'r-lamp', 'r-poster', 'r-copy']);
    expect(said()).toContain('Thank you was copied to position 4.');
  });

  it('deletes a reward only after the confirmation', async () => {
    mockSend.mockImplementation(async () => null);
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-thanks-delete'));
    expect(screen.getByText('Delete Thank you?')).toBeTruthy();
    expect(calls('DELETE')).toEqual([]);
    await fireEvent.press(screen.getByTestId('reward-delete-delete'));
    await settle();
    expect(calls('DELETE')).toEqual([['DELETE', '/v1/rewards/r-thanks']]);
    expect(screen.queryByTestId('reward-r-thanks')).toBeNull();
  });

  it('says to hide a reward the service will not delete because it has backers', async () => {
    mockSend.mockImplementation(async () => {
      throw refusal(409, 'REWARD_HAS_BACKERS', null, 'Somebody chose it a moment ago.');
    });
    await show();
    await fireEvent.press(screen.getByTestId('reward-r-thanks-delete'));
    await fireEvent.press(screen.getByTestId('reward-delete-delete'));
    await settle();
    const alert = screen.getByTestId('rewards-failure');
    expect(within(alert).getByText(en.campaignEditor.rewards.rewardHasBackers)).toBeTruthy();
    expect(screen.getByTestId('reward-r-thanks')).toBeTruthy();
  });

  it('names the rewards still using an item the service will not delete', async () => {
    mockSend.mockImplementation(async () => {
      throw refusal(409, 'ITEM_IN_USE', { rewardTierIds: ['r-thanks'] }, 'The item is in use.');
    });
    await show();
    await fireEvent.press(screen.getByTestId('item-i-mug-delete'));
    await fireEvent.press(screen.getByTestId('item-delete-delete'));
    await settle();
    expect(calls('DELETE')).toEqual([['DELETE', '/v1/items/i-mug']]);
    expect(
      within(screen.getByTestId('rewards-failure')).getByText(
        'It is part of Thank you. Take it out of that reward first, then delete it.',
      ),
    ).toBeTruthy();
  });

  it('stops at a hundred rewards and says why', async () => {
    mockRewards = async () => Array.from({ length: 100 }, (_, index) => reward(`r-${index}`, `Tier ${index}`));
    await show();
    expect(screen.getByTestId('tiers-full')).toBeTruthy();
    expect(screen.getByText('A campaign can offer 100 rewards. Delete or combine one before adding another.')).toBeTruthy();
    expect(screen.getByTestId('tiers-add').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('offline, shows the lists as last loaded and changes nothing', async () => {
    await show();
    await act(async () => setOnline(false));
    await settle();
    expect(screen.getByTestId('reward-r-thanks')).toBeTruthy();
    for (const id of ['items-add', 'tiers-add', 'reward-r-thanks-edit', 'reward-r-thanks-delete', 'reward-r-lamp-move-up', 'item-i-mug-edit']) {
      expect(screen.getByTestId(id).props.accessibilityState).toMatchObject({ disabled: true });
    }
    expect(screen.getByTestId('reward-r-lamp-summary').props.accessibilityActions).toEqual([]);
  });

  it('offline with nothing loaded yet, says so instead of waiting for ever', async () => {
    // Offline, the query client pauses the read; here it simply never answers.
    mockItems = () => new Promise(() => {});
    mockRewards = () => new Promise(() => {});
    setOnline(false);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(queryKeys.projectEdit('p1'), PROJECT);
    await act(async () => setLocale('en'));
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <QueryClientProvider client={client}>
          <IntlProvider locale="en" messages={en}>
            <EditorProvider projectId="p1" store={memoryStore()}>
              <RewardsPanel />
            </EditorProvider>
          </IntlProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    await settle();
    expect(screen.getByTestId('rewards-nothing-cached')).toBeTruthy();
    expect(screen.queryByTestId('tiers-loading')).toBeNull();
  });
});
