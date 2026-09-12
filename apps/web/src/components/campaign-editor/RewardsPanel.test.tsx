import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  createItem,
  createReward,
  deleteItem,
  deleteReward,
  duplicateReward,
  getProjectEdit,
  listItems,
  listRewards,
  patchReward,
  reorderRewards,
  replaceShippingRules,
  type Item,
  type ProjectEdit,
  type Reward,
} from '../../lib/projects/api';
import { RewardsPanel } from './RewardsPanel';
import { EDITOR_COPY } from '../../test-editor-copy';

/**
 * Appearance is reviewed in Storybook. These cover what fails silently: the
 * validation boundaries of docs/architecture.md §5.3, a price that must never
 * become a float, an order that has to be sent whole, and reordering that has
 * to work without a pointer.
 *
 * The save model is asserted directly, because it is the decision this tab
 * makes differently from every other one: nothing leaves the drawer until Save
 * is pressed. A test that only checked the eventual request would pass just as
 * happily against an autosave, and the point is that there is not one.
 */

vi.mock('../../lib/projects/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/projects/api')>()),
  getProjectEdit: vi.fn(),
  listItems: vi.fn(),
  listRewards: vi.fn(),
  createItem: vi.fn(),
  patchItem: vi.fn(),
  deleteItem: vi.fn(),
  createReward: vi.fn(),
  patchReward: vi.fn(),
  deleteReward: vi.fn(),
  duplicateReward: vi.fn(),
  reorderRewards: vi.fn(),
  replaceShippingRules: vi.fn(),
}));

const getProjectEditMock = vi.mocked(getProjectEdit);
const listItemsMock = vi.mocked(listItems);
const listRewardsMock = vi.mocked(listRewards);
const createItemMock = vi.mocked(createItem);
const deleteItemMock = vi.mocked(deleteItem);
const createRewardMock = vi.mocked(createReward);
const patchRewardMock = vi.mocked(patchReward);
const deleteRewardMock = vi.mocked(deleteReward);
const duplicateRewardMock = vi.mocked(duplicateReward);
const reorderRewardsMock = vi.mocked(reorderRewards);
const replaceShippingRulesMock = vi.mocked(replaceShippingRules);

const PROJECT: ProjectEdit = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'DRAFT',
  title: 'A field recorder',
  goal: { amount: '5000.00', currency: 'AZN' },
  durationDays: 30,
  latePledgeEnabled: false,
  lockedFields: [],
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

const MUG: Item = {
  id: 'item-mug',
  projectId: 'project-1',
  name: 'Enamel mug',
  description: null,
  imageUrl: null,
  weightGrams: 320,
  isDigital: false,
  sku: null,
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

function reward(overrides: Partial<Reward> = {}): Reward {
  return {
    id: 'reward-a',
    projectId: 'project-1',
    title: 'Early bird',
    description: null,
    price: { amount: '19.99', currency: 'AZN' },
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
    createdAt: '2026-08-15T09:00:00.000Z',
    updatedAt: '2026-08-15T09:00:00.000Z',
    ...overrides,
  };
}

const FIRST = reward({ id: 'reward-a', title: 'Early bird', sortOrder: 0 });
const SECOND = reward({
  id: 'reward-b',
  title: 'Collector edition',
  price: { amount: '120.00', currency: 'AZN' },
  sortOrder: 1,
  items: [{ itemId: 'item-mug', quantity: 2 }],
});

/** Lets pending promises settle. */
async function tick(ms = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

interface Fixture {
  project?: Partial<ProjectEdit>;
  items?: readonly Item[];
  rewards?: readonly Reward[];
}

async function openRewards({ project, items, rewards }: Fixture = {}): Promise<UserEvent> {
  getProjectEditMock.mockResolvedValue({ ...PROJECT, ...project });
  listItemsMock.mockResolvedValue(items ?? [MUG]);
  listRewardsMock.mockResolvedValue(rewards ?? [FIRST, SECOND]);

  const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
  render(<RewardsPanel projectId="project-1" copy={EDITOR_COPY} />);

  // The project, and the two lists that resolve together.
  await tick();
  await tick();

  return user;
}

const tierList = (): HTMLElement =>
  screen.getByRole('list', { name: 'Reward tiers, in the order backers see them' });

beforeEach(() => {
  vi.clearAllMocks();
  /*
   * `shouldAdvanceTime` lets real time drive the fake clock, which is what
   * makes `userEvent` usable at all: its async wrapper waits on a macrotask a
   * frozen clock never reaches.
   */
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RewardsPanel', () => {
  it('announces that it is loading rather than showing an empty list', async () => {
    getProjectEditMock.mockResolvedValue(PROJECT);
    listItemsMock.mockReturnValue(new Promise<readonly Item[]>(() => {}));
    listRewardsMock.mockReturnValue(new Promise<readonly Reward[]>(() => {}));

    render(<RewardsPanel projectId="project-1" copy={EDITOR_COPY} />);
    await tick();

    const label = screen.getByText('Loading this campaign’s items');
    expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('lists the items and the tiers, with a name on every control', async () => {
    await openRewards();

    expect(screen.getByRole('heading', { name: /^Items/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Rewards/ })).toBeInTheDocument();
    expect(screen.getByText('Enamel mug')).toBeInTheDocument();

    // Every control says which row it acts on: "Edit" four times over is four
    // controls a screen-reader user cannot tell apart.
    expect(screen.getByRole('button', { name: 'Edit Enamel mug' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Enamel mug' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Early bird' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate Early bird' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide Early bird from the campaign page' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Move Early bird down, currently 1 of 2' }),
    ).toBeInTheDocument();
  });

  it('shows a price formatted from its digits, never through a float', async () => {
    await openRewards({ rewards: [reward({ price: { amount: '1234567.89', currency: 'AZN' } })] });

    expect(screen.getByText('1,234,567.89 AZN')).toBeInTheDocument();
  });

  it('names what a tier contains rather than counting it', async () => {
    await openRewards();

    expect(screen.getByText('Contains Enamel mug ×2')).toBeInTheDocument();
    expect(screen.getByText('Contains no items')).toBeInTheDocument();
  });

  describe('the save model', () => {
    it('sends nothing while a reward is being typed, and everything when Save is pressed', async () => {
      const user = await openRewards({ rewards: [] });
      createRewardMock.mockResolvedValue(reward({ id: 'reward-new', title: 'Poster' }));

      await user.click(screen.getByRole('button', { name: 'Add the first reward' }));
      await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Poster');
      await user.type(screen.getByRole('textbox', { name: 'Price' }), '19.99');

      /*
       * The point of the tab. A debounce here would already have created a
       * reward called "P", and would have priced one at 1 on the way to 19.99 —
       * both of which are valid, chargeable, and not what anybody meant.
       */
      await tick(2000);
      expect(createRewardMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(createRewardMock).toHaveBeenCalledTimes(1);
      expect(createRewardMock.mock.lastCall?.[1]).toMatchObject({
        title: 'Poster',
        price: { amount: '19.99', currency: 'AZN' },
      });
    });

    it('sends only the field that changed, so an untouched price is never rewritten', async () => {
      const user = await openRewards({ rewards: [FIRST] });
      patchRewardMock.mockResolvedValue(reward({ description: 'The first hundred.' }));

      await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));
      await user.type(screen.getByRole('textbox', { name: 'Description' }), 'The first hundred.');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(patchRewardMock).toHaveBeenCalledWith('reward-a', {
        description: 'The first hundred.',
      });
    });

    it('makes no request at all when nothing was changed', async () => {
      const user = await openRewards({ rewards: [FIRST] });

      await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(patchRewardMock).not.toHaveBeenCalled();
    });

    it('replaces the rate table in a second request, after the tier itself', async () => {
      const user = await openRewards({ rewards: [FIRST] });
      const shipped = reward({ shippingType: 'DOMESTIC' });
      patchRewardMock.mockResolvedValue(shipped);
      replaceShippingRulesMock.mockResolvedValue({
        ...shipped,
        shippingRules: [{ countryCode: 'AZ', amount: '5.00', additionalItemAmount: '0.00' }],
      });

      await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Delivery' }),
        'DOMESTIC',
      );
      await user.click(screen.getByRole('button', { name: 'Add a destination' }));
      await user.type(screen.getByRole('textbox', { name: /Country code/ }), 'az');
      await user.type(screen.getByRole('textbox', { name: /^Shipping rate to/ }), '5');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      // The scope has to move first: the PUT is refused on a tier that is not
      // shipped, so the two requests are ordered rather than concurrent.
      expect(patchRewardMock).toHaveBeenCalledWith('reward-a', { shippingType: 'DOMESTIC' });
      expect(replaceShippingRulesMock).toHaveBeenCalledWith('reward-a', [
        { countryCode: 'AZ', amount: '5.00', additionalItemAmount: '0.00' },
      ]);
    });

    it('says the tier was saved when only its rates were refused', async () => {
      const user = await openRewards({ rewards: [FIRST] });
      patchRewardMock.mockResolvedValue(reward({ shippingType: 'DOMESTIC' }));
      replaceShippingRulesMock.mockRejectedValue(
        new ApiError(400, {
          status: 400,
          detail: 'A destination is a two-letter ISO 3166-1 country code',
          code: 'REWARD_FIELD_INVALID',
          meta: { field: 'rules' },
        }),
      );

      await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));
      await user.selectOptions(screen.getByRole('combobox', { name: 'Delivery' }), 'DOMESTIC');
      await user.click(screen.getByRole('button', { name: 'Add a destination' }));
      await user.type(screen.getByRole('textbox', { name: /Country code/ }), 'AZ');
      await user.type(screen.getByRole('textbox', { name: /^Shipping rate to/ }), '5');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      // Reporting a plain failure would have the creator retyping a tier that
      // is already stored.
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('The shipping rates were not saved');
      expect(alert).toHaveTextContent('was');
    });
  });

  describe('the boundaries of §5.3', () => {
    it('refuses a price of zero, and sends nothing', async () => {
      const user = await openRewards({ rewards: [] });

      await user.click(screen.getByRole('button', { name: 'Add the first reward' }));
      await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Thanks');
      await user.type(screen.getByRole('textbox', { name: 'Price' }), '0');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(screen.getByText('A reward price is more than zero.')).toBeInTheDocument();
      expect(createRewardMock).not.toHaveBeenCalled();
    });

    it('explains a comma instead of saving a hundredth of what was meant', async () => {
      const user = await openRewards({ rewards: [] });

      await user.click(screen.getByRole('button', { name: 'Add the first reward' }));
      await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Poster');
      await user.click(screen.getByRole('textbox', { name: 'Price' }));
      await user.paste('19,99');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(
        screen.getByText('Use a full stop for the decimal point, for example 19.99.'),
      ).toBeInTheDocument();
      expect(createRewardMock).not.toHaveBeenCalled();
    });

    it('refuses a limit below what is already claimed and reserved', async () => {
      const user = await openRewards({
        rewards: [reward({ limitQuantity: 100, claimedQuantity: 30, reservedQuantity: 10 })],
      });

      await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));
      const limit = screen.getByRole('textbox', { name: 'Number of places' });
      await user.clear(limit);
      await user.type(limit, '39');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      // A reservation is somebody entering their card details, so it counts as
      // taken exactly as a confirmed pledge does.
      expect(screen.getByText(/below the 40 places already taken/)).toBeInTheDocument();
      expect(patchRewardMock).not.toHaveBeenCalled();
    });

    it('does not offer to delete a tier somebody has backed, and says why', async () => {
      await openRewards({ rewards: [reward({ claimedQuantity: 11 })] });

      expect(screen.queryByRole('button', { name: 'Delete Early bird' })).not.toBeInTheDocument();
      expect(
        screen.getByText('11 backers have chosen this reward, so it can be hidden but not deleted.'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Hide Early bird from the campaign page' }),
      ).toBeInTheDocument();
    });

    it('stops offering a hundred-and-first tier', async () => {
      const many = Array.from({ length: 100 }, (_, index) =>
        reward({ id: `reward-${index}`, title: `Tier ${index}`, sortOrder: index }),
      );
      await openRewards({ rewards: many });

      expect(screen.getByRole('button', { name: 'Add a reward' })).toBeDisabled();
      expect(
        screen.getByText('This campaign has the most rewards it can have'),
      ).toBeInTheDocument();
    });
  });

  /*
   * §5.3 permits hiding a tier and forbids deleting one with backers. The
   * service expresses hidden as `available_until` in the past, and the whole
   * point of these two assertions is that the creator never has to know that.
   */
  describe('hiding, which is what the service calls a closing date in the past', () => {
    it('closes the tier now and says it is hidden, not that a date was set', async () => {
      const user = await openRewards({ rewards: [FIRST] });
      patchRewardMock.mockResolvedValue(
        reward({ availableUntil: '2020-01-01T00:00:00.000Z' }),
      );

      await user.click(
        screen.getByRole('button', { name: 'Hide Early bird from the campaign page' }),
      );
      await tick();

      const [, patch] = patchRewardMock.mock.lastCall ?? [];
      expect(typeof patch?.availableUntil).toBe('string');
      expect(screen.getByText('Hidden')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Show Early bird on the campaign page' }),
      ).toBeInTheDocument();
    });

    it('says why an early bird with no limit cannot simply be shown again', async () => {
      await openRewards({
        rewards: [
          reward({
            isEarlyBird: true,
            limitQuantity: null,
            availableUntil: '2020-01-01T00:00:00.000Z',
          }),
        ],
      });

      expect(
        screen.getByRole('button', { name: 'Show Early bird on the campaign page' }),
      ).toBeDisabled();
      expect(screen.getByRole('alert')).toHaveTextContent('turn off early bird');
    });
  });

  describe('reordering', () => {
    it('is reachable without a pointer, and sends the whole order', async () => {
      const user = await openRewards();
      reorderRewardsMock.mockResolvedValue([
        { ...SECOND, sortOrder: 0 },
        { ...FIRST, sortOrder: 1 },
      ]);

      await user.click(
        screen.getByRole('button', { name: 'Move Collector edition up, currently 2 of 2' }),
      );
      await tick();

      /*
       * Every tier, exactly once. The service refuses a partial order outright,
       * because the tiers it omits would stay where they were and interleave
       * with the ones that moved.
       */
      expect(reorderRewardsMock).toHaveBeenCalledWith('project-1', ['reward-b', 'reward-a']);

      const titles = within(tierList())
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent);
      expect(titles).toEqual(['Collector edition', 'Early bird']);
    });

    it('announces the new position, because the visual reshuffle says nothing', async () => {
      const user = await openRewards();
      reorderRewardsMock.mockResolvedValue([
        { ...SECOND, sortOrder: 0 },
        { ...FIRST, sortOrder: 1 },
      ]);

      await user.click(
        screen.getByRole('button', { name: 'Move Collector edition up, currently 2 of 2' }),
      );
      await tick();

      const announcements = screen.getAllByRole('status').map((region) => region.textContent);
      expect(announcements).toContain('Collector edition moved to position 1 of 2.');
    });

    /*
     * A tier moved to the top loses its "move up", and a control that disables
     * itself under the user's finger drops focus at the top of the document.
     * The keyboard route has to survive using it.
     */
    it('hands focus to the control the tier keeps when it reaches an end', async () => {
      const user = await openRewards();
      reorderRewardsMock.mockResolvedValue([
        { ...SECOND, sortOrder: 0 },
        { ...FIRST, sortOrder: 1 },
      ]);

      await user.click(
        screen.getByRole('button', { name: 'Move Collector edition up, currently 2 of 2' }),
      );
      await tick();

      expect(document.activeElement).toHaveAccessibleName(
        'Move Collector edition down, currently 1 of 2',
      );
    });

    it('re-reads the list when the service refuses the order, rather than lying about it', async () => {
      const user = await openRewards();
      reorderRewardsMock.mockRejectedValue(
        new ApiError(400, {
          status: 400,
          detail: 'A reorder lists every reward of the campaign exactly once.',
          code: 'REWARD_ORDER_INCOMPLETE',
        }),
      );

      await user.click(
        screen.getByRole('button', { name: 'Move Collector edition up, currently 2 of 2' }),
      );
      await tick();
      await tick();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'A reorder lists every reward of the campaign exactly once.',
      );
      // The list came back from the service, so what is on screen is what is
      // stored rather than the move that failed.
      expect(listRewardsMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('items', () => {
    it('creates one from the drawer, sending an emptied field as null', async () => {
      const user = await openRewards({ items: [] });
      createItemMock.mockResolvedValue({ ...MUG, id: 'item-new', name: 'Poster' });

      await user.click(screen.getByRole('button', { name: 'Add the first item' }));
      await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Poster');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(createItemMock).toHaveBeenCalledWith('project-1', {
        name: 'Poster',
        description: null,
        imageUrl: null,
        weightGrams: null,
        isDigital: false,
        sku: null,
      });
    });

    it('clears the weight when an item becomes a download', async () => {
      const user = await openRewards();

      await user.click(screen.getByRole('button', { name: 'Edit Enamel mug' }));
      expect(screen.getByRole('textbox', { name: 'Weight in grams' })).toHaveValue('320');

      await user.click(screen.getByRole('switch', { name: 'Delivered as a file' }));

      // The database refuses a digital item with a weight, so the creator is
      // not made to undo a field whose relevance they cannot see.
      expect(screen.getByRole('textbox', { name: 'Weight in grams' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'Weight in grams' })).toBeDisabled();
    });

    it('names the rewards that stop an item being deleted', async () => {
      const user = await openRewards();
      deleteItemMock.mockRejectedValue(
        new ApiError(409, {
          status: 409,
          detail: 'Remove this item from the rewards that contain it before deleting it.',
          code: 'ITEM_IN_USE',
          meta: { rewardTierIds: ['reward-b'] },
        }),
      );

      await user.click(screen.getByRole('button', { name: 'Delete Enamel mug' }));
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await tick();

      /*
       * The identifiers in `meta` are useless to a creator; the titles are what
       * they can act on. Rendering the raw problem code would be the same
       * refusal with the actionable part removed.
       */
      const alert = screen.getAllByRole('alert').find((node) =>
        node.textContent?.includes('Collector edition'),
      );
      expect(alert).toBeDefined();
    });
  });

  it('duplicates a tier and says where the copy went', async () => {
    const user = await openRewards();
    duplicateRewardMock.mockResolvedValue(reward({ id: 'reward-c', title: 'Early bird', sortOrder: 2 }));

    await user.click(screen.getByRole('button', { name: 'Duplicate Early bird' }));
    await tick();

    expect(duplicateRewardMock).toHaveBeenCalledWith('reward-a');
    const announcements = screen.getAllByRole('status').map((region) => region.textContent);
    expect(announcements).toContain('Early bird was copied to position 3.');
  });

  it('deletes a tier nobody has backed, after asking', async () => {
    const user = await openRewards({ rewards: [FIRST] });
    deleteRewardMock.mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'Delete Early bird' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await tick();

    expect(deleteRewardMock).toHaveBeenCalledWith('reward-a');
    expect(screen.queryByText('Early bird')).not.toBeInTheDocument();
  });

  /*
   * The signal is on the TIER, not on the project. This test used to hand the
   * project `lockedFields: ['price']` and pass — against a body the service
   * cannot produce, because that array is filtered server-side to the campaign's
   * own patch keys and could never name a field of a reward. The control was
   * enabled on every live campaign and the test said otherwise (#183).
   */
  it('disables a price the tier says is locked', async () => {
    const user = await openRewards({
      rewards: [{ ...FIRST, pricingLocked: true }],
    });

    await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));

    expect(screen.getByRole('textbox', { name: 'Price' })).toBeDisabled();
    expect(
      screen.getByText(/The price cannot change once the campaign has launched/),
    ).toBeInTheDocument();
  });

  /*
   * The counterpart, and the regression that mattered: a project whose
   * `lockedFields` names its own frozen fields must not be mistaken for one whose
   * reward prices are frozen, and a tier that says nothing stays editable.
   */
  it('leaves the price editable when the tier does not say it is locked', async () => {
    const user = await openRewards({
      project: { lockedFields: ['goal', 'durationDays'] },
      rewards: [FIRST],
    });

    await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));

    expect(screen.getByRole('textbox', { name: 'Price' })).toBeEnabled();
  });

  describe('when the project cannot be loaded', () => {
    it('says the session has ended rather than showing an empty editor', async () => {
      getProjectEditMock.mockRejectedValue(new ApiError(401, null));
      listItemsMock.mockResolvedValue([]);
      listRewardsMock.mockResolvedValue([]);

      render(<RewardsPanel projectId="project-1" copy={EDITOR_COPY} />);
      await tick();

      expect(screen.getByText('You are signed out')).toBeInTheDocument();
    });

    it('offers a retry when the lists simply failed', async () => {
      getProjectEditMock.mockResolvedValue(PROJECT);
      listItemsMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      listRewardsMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
      render(<RewardsPanel projectId="project-1" copy={EDITOR_COPY} />);
      await tick();
      await tick();

      expect(screen.getByText('The rewards could not be loaded')).toBeInTheDocument();

      listItemsMock.mockResolvedValue([MUG]);
      listRewardsMock.mockResolvedValue([FIRST]);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await tick();
      await tick();

      expect(screen.getByText('Enamel mug')).toBeInTheDocument();
    });
  });
});
