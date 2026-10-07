import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { Item, ProjectEdit, Reward } from '@ideanest/campaign-editor/contract';
import { editorChromeCopyFrom, rewardsPanelCopyFrom } from '@ideanest/campaign-editor/copy';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../../lib/locale';
import { editorTranslators } from '../translator';
import { RewardEditor } from './reward-editor';

const mockSend = jest.fn();
jest.mock('../../../api/client', () => ({
  api: () => ({ get: jest.fn() }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));
// A comma-decimal phone (az): the price and the rates normalise "12,5" to "12.5" as typed.
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

const { t, counter } = editorTranslators('en');
const COPY = rewardsPanelCopyFrom(t, 'en', editorChromeCopyFrom(t, counter, 'en').characterCount);
const TIER = en.campaignEditor.rewards.tier;

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
  isDigital: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const STORED: Reward = {
  id: 'r1',
  projectId: 'p1',
  title: 'The lamp',
  description: null,
  price: { amount: '40.00', currency: 'AZN' },
  estimatedDelivery: null,
  limitQuantity: 10,
  claimedQuantity: 3,
  reservedQuantity: 2,
  remainingQuantity: 5,
  shippingType: 'DOMESTIC',
  isEarlyBird: false,
  isFeatured: false,
  isSecret: false,
  secretToken: null,
  isAddon: false,
  sortOrder: 0,
  availableFrom: null,
  availableUntil: null,
  items: [],
  shippingRules: [{ countryCode: 'AZ', amount: '5.00', additionalItemAmount: '0.00' }],
  version: 1,
  pricingLocked: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(reward: Reward | null, items: readonly Item[] = [MUG]) {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        <RewardEditor
          visible
          project={PROJECT}
          reward={reward}
          items={items}
          copy={COPY}
          readOnly={false}
          onClose={onClose}
          onSaved={onSaved}
        />
      </IntlProvider>
    </SafeAreaProvider>,
  );
  return { onSaved, onClose };
}

const type = (testID: string, text: string) => fireEvent.changeText(screen.getByTestId(testID), text);
const save = async () => {
  await fireEvent.press(screen.getByTestId('reward-editor-save'));
  await settle();
};
/** A field's error is drawn and also read as the control's hint, so the drawn copy is hidden. */
const shown = (words: string) => screen.queryByText(words, { includeHiddenElements: true });

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  mockSend.mockReset();
  jest.mocked(Clipboard.setStringAsync).mockClear();
});

describe('RewardEditor', () => {
  it('says nothing is wrong with a blank form until Save is pressed, then says what', async () => {
    const { onClose } = await show(null);
    expect(shown(en.campaignEditor.rewards.vocabulary.reward.titleRequired)).toBeNull();
    await save();
    expect(shown(en.campaignEditor.rewards.vocabulary.reward.titleRequired)).toBeTruthy();
    expect(shown(en.campaignEditor.rewards.vocabulary.price.empty)).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses, on the phone, places below what is claimed plus reserved', async () => {
    await show(STORED);
    expect(shown('Leave empty for unlimited. 5 places are already taken, so the limit cannot go below that.')).toBeTruthy();
    await type('reward-places', '4');
    await save();
    expect(
      shown('That is below the 5 places already taken. A quantity may always be raised, and lowered only above what is claimed.'),
    ).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();

    mockSend.mockImplementation(async () => ({ ...STORED, limitQuantity: 5 }));
    await type('reward-places', '5');
    await save();
    expect(mockSend.mock.calls).toEqual([['PATCH', '/v1/rewards/r1', { limitQuantity: 5 }]]);
  });

  it('creates a shipped reward, then prices its destinations — amounts as two-decimal strings, 0 allowed', async () => {
    mockSend.mockImplementation(async (method: string, _path: string, body: Record<string, unknown>) =>
      method === 'POST'
        ? { ...STORED, id: 'r-new', claimedQuantity: 0, reservedQuantity: 0, ...body, shippingRules: [] }
        : { ...STORED, id: 'r-new', shippingRules: body.rules },
    );
    const { onSaved, onClose } = await show(null);
    await type('reward-title', 'Lamp and mug');
    await type('reward-price', '12,5');
    expect(screen.getByTestId('reward-price').props.value).toBe('12.5');

    await fireEvent.press(screen.getByTestId('reward-delivery'));
    await fireEvent.press(screen.getByRole('radio', { name: /Shipped domestically/u }));
    await fireEvent.press(screen.getByTestId('reward-rate-add'));
    await type('reward-rate-0-country', 'az');
    await type('reward-rate-0-amount', '0');
    await save();

    const [post, put] = mockSend.mock.calls as [string, string, Record<string, unknown>][];
    expect(post?.[0]).toBe('POST');
    expect(post?.[1]).toBe('/v1/projects/p1/rewards');
    expect(post?.[2]).toMatchObject({ title: 'Lamp and mug', price: { amount: '12.50', currency: 'AZN' }, shippingType: 'DOMESTIC' });
    expect(put).toEqual([
      'PUT',
      '/v1/rewards/r-new/shipping-rules',
      { rules: [{ countryCode: 'AZ', amount: '0.00', additionalItemAmount: '0.00' }] },
    ]);
    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the tier and says only the rates were refused, and the next Save sends only the rates', async () => {
    mockSend
      .mockImplementationOnce(async () => ({ ...STORED, title: 'The big lamp' }))
      .mockImplementationOnce(async () => {
        throw new ApiError(400, { status: 400, detail: 'TR is not a destination you ship to.' });
      })
      .mockImplementationOnce(async (_method: string, _path: string, body: Record<string, unknown>) => ({
        ...STORED,
        title: 'The big lamp',
        shippingRules: body.rules,
      }));
    const { onSaved, onClose } = await show(STORED);
    await type('reward-title', 'The big lamp');
    await type('reward-rate-0-country', 'TR');
    await save();

    const alert = screen.getByTestId('reward-editor-failure');
    expect(within(alert).getByText(TIER.ratesNotSavedTitle)).toBeTruthy();
    expect(within(alert).getByText('TR is not a destination you ship to.')).toBeTruthy();
    expect(within(alert).getByText(en.mobile.editor.rewards.ratesNotSavedDetail)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);

    await save();
    expect(mockSend.mock.calls.map((call) => call[0])).toEqual(['PATCH', 'PUT', 'PUT']);
    expect(onClose).toHaveBeenCalled();
  });

  it('sends only what changed, and nothing at all when nothing did', async () => {
    const { onClose } = await show(STORED);
    await save();
    expect(mockSend).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('puts the service’s refusal on the field it names', async () => {
    mockSend.mockImplementation(async () => {
      throw new ApiError(400, {
        status: 400,
        detail: 'A price cannot change once the campaign has launched.',
        code: 'REWARD_FIELD_INVALID',
        meta: { field: 'price' },
      });
    });
    await show(STORED);
    await type('reward-price', '45');
    await save();
    expect(screen.getByTestId('reward-price').props.accessibilityHint).toContain(
      'A price cannot change once the campaign has launched.',
    );
    expect(within(screen.getByTestId('reward-editor-failure')).getByText(TIER.notSavedTitle)).toBeTruthy();
  });

  it('adds an item from the picker and names its quantity and removal by the item', async () => {
    await show(null);
    await fireEvent.press(screen.getByTestId('reward-add-item'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Enamel mug' }));
    expect(screen.getByLabelText('Quantity of Enamel mug').props.value).toBe('1');
    expect(screen.getByText(TIER.everyItemAdded)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Remove Enamel mug from this reward'));
    expect(screen.queryByLabelText('Quantity of Enamel mug')).toBeNull();
  });

  it('names a rate row by its destination, or by its place before one is typed', async () => {
    await show(STORED);
    expect(screen.getByLabelText('Country code for AZ')).toBeTruthy();
    expect(screen.getByLabelText('Shipping rate to AZ')).toBeTruthy();
    expect(screen.getByLabelText('Rate for each additional item to AZ')).toBeTruthy();
    expect(screen.getByLabelText('Remove AZ')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reward-rate-add'));
    expect(screen.getByLabelText('Country code for destination 2')).toBeTruthy();
  });

  it('shows a secret reward’s token in mono and copies it', async () => {
    await show({ ...STORED, isSecret: true, secretToken: 'tok-7f3a' });
    expect(within(screen.getByTestId('reward-token')).getByText('tok-7f3a')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reward-token-copy'));
    await settle();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('tok-7f3a');
    expect(screen.getByTestId('reward-token-copy').props.accessibilityLabel).toBe(en.mobile.editor.rewards.copied);
    const said = jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls.map((call) => call[0]);
    const android = jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map((call) => call[0]);
    expect([...said, ...android]).toContain(en.mobile.editor.rewards.tokenCopied);
  });

  it('cannot be cancelled while it is saving', async () => {
    mockSend.mockImplementation(() => new Promise(() => {}));
    await show(STORED);
    await type('reward-title', 'Renamed');
    await fireEvent.press(screen.getByTestId('reward-editor-save'));
    expect(screen.getByTestId('reward-editor-cancel').props.accessibilityState).toMatchObject({ disabled: true });
  });
});
