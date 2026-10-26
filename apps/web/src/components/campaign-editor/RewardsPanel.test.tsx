import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
  patchItem,
  patchReward,
  reorderRewards,
  replaceShippingRules,
  restoreReward,
  type Item,
  type ProjectEdit,
  type Reward,
} from '../../lib/projects/api';
import { RewardsPanel } from './RewardsPanel';
import { UploadFailed, uploadImage, type UploadedImage } from '../../lib/media/upload';
import { uploadVideo, type UploadedVideo } from '../../lib/media/videoUpload';
import { readVideoDuration } from '../../lib/media/videoDuration';
import { EDITOR_COPY, REWARDS_COPY } from '../../test-editor-copy';

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
  restoreReward: vi.fn(),
}));

/*
 * The upload is mocked for the reason `BasicsPanel.test.tsx` gives for the cover: three
 * requests and a poll that belong to `lib/media/upload.ts`. What the item drawer does with the
 * result — and with a refusal — is what is asserted here (#313).
 */
vi.mock('../../lib/media/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media/upload')>()),
  uploadImage: vi.fn(),
}));

/* The reward's clip, mocked for the reasons `BasicsPanel.test.tsx` gives for the campaign video. */
vi.mock('../../lib/media/videoUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media/videoUpload')>()),
  uploadVideo: vi.fn(),
}));
vi.mock('../../lib/media/videoDuration', () => ({ readVideoDuration: vi.fn() }));

const uploadImageMock = vi.mocked(uploadImage);
const uploadVideoMock = vi.mocked(uploadVideo);
const readVideoDurationMock = vi.mocked(readVideoDuration);
const getProjectEditMock = vi.mocked(getProjectEdit);
const listItemsMock = vi.mocked(listItems);
const listRewardsMock = vi.mocked(listRewards);
const createItemMock = vi.mocked(createItem);
const deleteItemMock = vi.mocked(deleteItem);
const patchItemMock = vi.mocked(patchItem);
const createRewardMock = vi.mocked(createReward);
const patchRewardMock = vi.mocked(patchReward);
const deleteRewardMock = vi.mocked(deleteReward);
const duplicateRewardMock = vi.mocked(duplicateReward);
const reorderRewardsMock = vi.mocked(reorderRewards);
const replaceShippingRulesMock = vi.mocked(replaceShippingRules);
const restoreRewardMock = vi.mocked(restoreReward);

const PROJECT: ProjectEdit = {
  id: 'project-1',
  slug: 'a-field-recorder',
  state: 'DRAFT',
  title: 'A field recorder',
  goal: { amount: '5000.00', currency: 'AZN' },
  durationDays: 30,
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
  render(<RewardsPanel projectId="project-1" copy={EDITOR_COPY} rewards={REWARDS_COPY} />);

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

    render(<RewardsPanel projectId="project-1" copy={EDITOR_COPY} rewards={REWARDS_COPY} />);
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

  describe('a creator who has not made a reward yet (#544)', () => {
    const PIN: Item = { ...MUG, id: 'item-pin', name: 'Enamel pin', weightGrams: null };

    it('offers the first reward before anything about items', async () => {
      await openRewards({ items: [MUG], rewards: [] });

      const rewardsHeading = screen.getByRole('heading', { name: /^Rewards/ });
      const itemsHeading = screen.getByRole('heading', { name: /^Items/ });
      const addFirstReward = screen.getByRole('button', { name: 'Add the first reward' });
      const addItem = screen.getByRole('button', { name: 'Add an item' });

      // DOCUMENT_POSITION_FOLLOWING: the second node comes after the first.
      expect(rewardsHeading.compareDocumentPosition(itemsHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(addFirstReward.compareDocumentPosition(addItem)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('says, in words, that an item no reward contains is not seen by backers', async () => {
      await openRewards({ items: [MUG], rewards: [] });

      expect(screen.getByText('Not in any reward')).toBeInTheDocument();
      expect(
        screen.getByText('Backers do not see it until it is added to a reward.'),
      ).toBeInTheDocument();
    });

    it('marks only the items no reward contains', async () => {
      // SECOND contains the mug; nothing contains the pin.
      await openRewards({ items: [MUG, PIN], rewards: [FIRST, SECOND] });

      const marked = screen.getAllByText('Not in any reward');
      expect(marked).toHaveLength(1);
      expect(marked[0]?.closest('li')).toHaveTextContent('Enamel pin');
    });
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

    describe('its image', () => {
      const UPLOADED: UploadedImage = {
        mediaId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        url: 'https://cdn.example.test/media/3f2504e0.jpg',
        width: 1200,
        height: 1200,
        blurDataUrl: '',
      };

      /** Hands a file to the drawer's drop zone; the input is hidden behind its button. */
      function chooseImage(file = new File(['bytes'], 'mug.jpg', { type: 'image/jpeg' })): void {
        const input = screen.getByRole('dialog').querySelector<HTMLInputElement>('input[type="file"]');
        if (input === null) throw new Error('The item drawer has no file input');
        fireEvent.change(input, { target: { files: [file] } });
      }

      it('uploads one and saves its address with the item, keeping what was typed meanwhile', async () => {
        const user = await openRewards({ items: [] });
        createItemMock.mockResolvedValue({ ...MUG, id: 'item-new', name: 'Poster' });
        let finish: ((image: UploadedImage) => void) | undefined;
        uploadImageMock.mockImplementation((_file, options) => {
          options?.onStage?.('processing');
          return new Promise((resolve) => {
            finish = resolve;
          });
        });

        await user.click(screen.getByRole('button', { name: 'Add the first item' }));
        chooseImage();

        expect(await screen.findByText('Processing the image…')).toBeInTheDocument();
        // Saving now would store the item without the picture being waited for.
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Poster');
        await act(async () => finish?.(UPLOADED));

        expect(screen.getByText('Image uploaded. Save the item to keep it.')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Image address' })).toHaveValue(UPLOADED.url);

        await user.click(screen.getByRole('button', { name: 'Save' }));
        await tick();

        expect(createItemMock).toHaveBeenCalledWith(
          'project-1',
          expect.objectContaining({ name: 'Poster', imageUrl: UPLOADED.url }),
        );
      });

      it.each([
        ['UNSUPPORTED_FORMAT', /not an image this platform can read/],
        ['TOO_LARGE', /The limit is 20 MB/],
        ['TOO_SMALL', /from 320×320 upwards/],
        ['EMPTY', /That file is empty/],
        ['MEDIA_STORAGE_UNREACHABLE', /storage is not answering/],
      ])('explains a refusal with %s, and the item keeps no image', async (code, sentence) => {
        const user = await openRewards({ items: [] });
        createItemMock.mockResolvedValue({ ...MUG, id: 'item-new', name: 'Poster' });
        uploadImageMock.mockRejectedValue(new UploadFailed(code, 'service log sentence'));

        await user.click(screen.getByRole('button', { name: 'Add the first item' }));
        chooseImage();

        const alert = (await screen.findByText('That file was not used')).closest('[role="alert"]');
        expect(alert).toHaveTextContent(sentence);
        expect(alert).not.toHaveTextContent('service log sentence');

        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Poster');
        await user.click(screen.getByRole('button', { name: 'Save' }));
        await tick();
        expect(createItemMock).toHaveBeenCalledWith(
          'project-1',
          expect.objectContaining({ imageUrl: null }),
        );
      });

      it('still takes a typed address, and previews it', async () => {
        const user = await openRewards({ items: [] });
        createItemMock.mockResolvedValue({ ...MUG, id: 'item-new', name: 'Poster' });

        await user.click(screen.getByRole('button', { name: 'Add the first item' }));
        await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Poster');
        await user.type(
          screen.getByRole('textbox', { name: 'Image address' }),
          'https://images.example.com/poster.jpg',
        );
        expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
          'src',
          'https://images.example.com/poster.jpg',
        );

        await user.click(screen.getByRole('button', { name: 'Save' }));
        await tick();

        expect(uploadImageMock).not.toHaveBeenCalled();
        expect(createItemMock).toHaveBeenCalledWith(
          'project-1',
          expect.objectContaining({ imageUrl: 'https://images.example.com/poster.jpg' }),
        );
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

  describe('a tier’s picture and clip', () => {
    const IMAGE: UploadedImage = {
      mediaId: '0b6a4c1e-6f6d-4b5e-9a65-6a1f8d2e7c10',
      url: 'https://cdn.example.test/media/0b6a4c1e.jpg',
      width: 1500,
      height: 1000,
      blurDataUrl: 'data:image/jpeg;base64,AAAA',
    };
    const CLIP: UploadedVideo = {
      mediaId: '7d3e2f10-2c4b-4f8a-8e1d-5b9c0a6e4f21',
      url: 'https://cdn.example.test/media/7d3e2f10.mp4',
      posterUrl: 'https://cdn.example.test/media/7d3e2f10.poster.webp',
      width: 1280,
      height: 720,
      durationMs: 4_800,
      blurDataUrl: null,
    };
    const clip = (): File => new File(['bytes'], 'mug.mp4', { type: 'video/mp4' });

    /** The drawer has two pickers: the picture's takes images, the clip's takes videos. */
    function choose(kind: 'image' | 'video', file: File): void {
      const accept = kind === 'image' ? 'input[type="file"][accept="image/*"]' : 'input[type="file"][accept*="video"]';
      const input = screen.getByRole('dialog').querySelector<HTMLInputElement>(accept);
      if (input === null) throw new Error(`The reward drawer has no ${kind} input`);
      fireEvent.change(input, { target: { files: [file] } });
    }

    it('creates a tier with an uploaded picture and a clip of up to five seconds', async () => {
      const user = await openRewards({ rewards: [] });
      createRewardMock.mockResolvedValue(reward({ id: 'reward-new', title: 'Poster' }));
      uploadImageMock.mockResolvedValue(IMAGE);
      readVideoDurationMock.mockResolvedValue(4_800);
      uploadVideoMock.mockResolvedValue(CLIP);

      await user.click(screen.getByRole('button', { name: 'Add the first reward' }));
      await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Poster');
      await user.type(screen.getByRole('textbox', { name: 'Price' }), '19.99');
      // The clip’s field is fetched when the drawer first draws it.
      expect(await screen.findByText(/A clip of up to 5 seconds/)).toBeInTheDocument();

      choose('image', new File(['bytes'], 'poster.jpg', { type: 'image/jpeg' }));
      expect(await screen.findByText('Image uploaded. Save the reward to keep it.')).toBeInTheDocument();
      choose('video', clip());
      await tick();
      await tick();
      expect(uploadVideoMock).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(createRewardMock).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({ imageMediaId: IMAGE.mediaId, videoMediaId: CLIP.mediaId }),
      );
    });

    it('refuses a clip over five seconds before a byte of it is uploaded', async () => {
      const user = await openRewards({ rewards: [FIRST] });
      readVideoDurationMock.mockResolvedValue(7_000);

      await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));
      await screen.findByText(/A clip of up to 5 seconds/);
      choose('video', clip());
      await tick();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'That video runs 0:07. A reward video is at most 5 seconds — trim it and choose it again.',
      );
      expect(uploadVideoMock).not.toHaveBeenCalled();
    });

    it('takes a picture down on a launched tier, whose price is locked but whose media is not', async () => {
      const withMedia = reward({
        pricingLocked: true,
        image: { ...IMAGE },
        video: { ...CLIP },
      });
      const user = await openRewards({ rewards: [withMedia] });
      patchRewardMock.mockResolvedValue({ ...withMedia, image: null });

      await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));
      expect(screen.getByRole('textbox', { name: 'Price' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Remove image' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      // Only what changed, and `null` is what takes it down.
      expect(patchRewardMock).toHaveBeenCalledWith('reward-a', { imageMediaId: null });
    });

    it('says on the clip’s field when the service measures it as too long', async () => {
      const user = await openRewards({ rewards: [FIRST] });
      readVideoDurationMock.mockResolvedValue(null);
      uploadVideoMock.mockResolvedValue({ ...CLIP, durationMs: 9_000 });
      patchRewardMock.mockRejectedValue(
        new ApiError(422, {
          status: 422,
          detail: 'The reward video is longer than 5 seconds',
          code: 'REWARD_VIDEO_TOO_LONG',
          meta: { field: 'videoMediaId', durationMs: 9_000, maxDurationMs: 5_000 },
        }),
      );

      await user.click(screen.getByRole('button', { name: 'Edit Early bird' }));
      await screen.findByText(/A clip of up to 5 seconds/);
      choose('video', clip());
      await tick();
      await tick();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(patchRewardMock).toHaveBeenCalledWith('reward-a', { videoMediaId: CLIP.mediaId });
      expect(
        screen.getByText('The reward was not saved: its video is longer than 5 seconds. Choose a shorter clip.'),
      ).toBeInTheDocument();
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
  describe('a launched campaign holds every reward change for review (#569)', () => {
    const LIVE: Partial<ProjectEdit> = { state: 'LIVE', launchedAt: '2026-09-01T09:00:00.000Z' };

    it('tells the creator that a new tier is not visible to backers until approved', async () => {
      await openRewards({ project: LIVE, rewards: [FIRST] });

      expect(screen.getByText(/not visible to backers until a moderator approves/)).toBeInTheDocument();
    });

    it('does not say so before launch, when nothing is held', async () => {
      await openRewards({ rewards: [FIRST] });

      expect(screen.queryByText(/not visible to backers until a moderator approves/)).not.toBeInTheDocument();
    });

    it('badges a tier created since launch, in words', async () => {
      await openRewards({ project: LIVE, rewards: [reward({ pending: 'created' })] });

      expect(screen.getByText('New, waiting for review')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Early bird' })).toBeInTheDocument();
    });

    it('badges a changed tier', async () => {
      await openRewards({
        project: LIVE,
        rewards: [reward({ pending: 'changed', revisionChangedFields: ['estimatedDelivery'] })],
      });

      expect(screen.getByText('Changed, waiting for review')).toBeInTheDocument();
    });

    it('badges a tier whose removal waits, and offers Undo instead of the other actions', async () => {
      await openRewards({ project: LIVE, rewards: [reward({ pending: 'deleted' })] });

      expect(screen.getByText('Removal waiting for review')).toBeInTheDocument();
      expect(screen.getByText(/stays on the campaign page until a moderator approves its removal/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Undo the removal of Early bird' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Early bird' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: /Remove Early bird/ })).not.toBeInTheDocument();
    });

    it('shows no badge on a tier nothing is held for', async () => {
      await openRewards({ project: LIVE, rewards: [FIRST] });

      expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument();
    });

    it('reads a delete of an approved tier as Remove on approval, and keeps the tier listed', async () => {
      const user = await openRewards({ project: LIVE, rewards: [FIRST] });
      deleteRewardMock.mockResolvedValue(undefined);
      listRewardsMock.mockResolvedValue([reward({ pending: 'deleted' })]);

      await user.click(screen.getByRole('button', { name: 'Remove Early bird on approval' }));
      await user.click(screen.getByRole('button', { name: 'Remove on approval' }));
      await tick();

      expect(deleteRewardMock).toHaveBeenCalledWith('reward-a');
      expect(screen.getByText('Removal waiting for review')).toBeInTheDocument();
      const announcements = screen.getAllByRole('status').map((region) => region.textContent);
      expect(announcements).toContain(
        'Early bird will be removed once a moderator approves your changes.',
      );
    });

    it('deletes a tier created since launch at once, as before', async () => {
      const user = await openRewards({ project: LIVE, rewards: [reward({ pending: 'created' })] });
      deleteRewardMock.mockResolvedValue(undefined);

      await user.click(screen.getByRole('button', { name: 'Delete Early bird' }));
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await tick();

      expect(screen.queryByText('Early bird')).not.toBeInTheDocument();
    });

    it('undoes a waiting removal through the restore endpoint', async () => {
      const user = await openRewards({ project: LIVE, rewards: [reward({ pending: 'deleted' })] });
      restoreRewardMock.mockResolvedValue(reward({ pending: null }));

      await user.click(screen.getByRole('button', { name: 'Undo the removal of Early bird' }));
      await tick();

      expect(restoreRewardMock).toHaveBeenCalledWith('reward-a');
      expect(screen.queryByText('Removal waiting for review')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Early bird' })).toBeEnabled();
      const announcements = screen.getAllByRole('status').map((region) => region.textContent);
      expect(announcements).toContain('Early bird will stay on the campaign.');
    });

    it('re-reads the campaign after a change so the revision notice follows', async () => {
      const user = await openRewards({ project: LIVE, rewards: [FIRST] });
      duplicateRewardMock.mockResolvedValue(reward({ id: 'reward-c', pending: 'created' }));
      getProjectEditMock.mockClear();

      await user.click(screen.getByRole('button', { name: 'Duplicate Early bird' }));
      await tick();

      expect(getProjectEditMock).toHaveBeenCalledTimes(1);
    });
  });

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
   * The list and the drawer show an item's PROPOSED values once a launched
   * campaign holds them, so the creator must be told that backers still see the
   * approved ones: on the item, at each held field, and after the save that
   * held them (#587).
   */
  describe('a launched campaign holds changes to an item an approved tier contains (#587)', () => {
    const LIVE: Partial<ProjectEdit> = { state: 'LIVE', launchedAt: '2026-09-01T09:00:00.000Z' };
    const HELD: Item = { ...MUG, name: 'Steel mug', revisionChangedFields: ['name', 'isDigital'] };
    const UNHELD: Item = { ...MUG, revisionChangedFields: [] };
    const FIELD_NOTE = 'Waiting for review. Backers still see the approved value.';

    const itemsSection = (): HTMLElement => screen.getByRole('region', { name: /^Items/ });

    it('marks an item whose changes wait, in words and not by colour alone', async () => {
      await openRewards({ project: LIVE, items: [HELD], rewards: [SECOND] });

      const section = within(itemsSection());
      expect(section.getByText('Changed, waiting for review')).toBeInTheDocument();
      expect(
        section.getByText(/Backers still see the approved version of this item until a moderator approves/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Steel mug' })).toBeEnabled();
    });

    it('marks nothing on an item whose list of held fields is empty', async () => {
      await openRewards({ project: LIVE, items: [UNHELD], rewards: [SECOND] });

      expect(within(itemsSection()).queryByText(/waiting for review/)).not.toBeInTheDocument();
      expect(screen.queryByText(/approved version of this item/)).not.toBeInTheDocument();
    });

    it('says in the drawer which fields hold proposed values, as each control’s description', async () => {
      const user = await openRewards({ project: LIVE, items: [HELD], rewards: [SECOND] });

      await user.click(screen.getByRole('button', { name: 'Edit Steel mug' }));

      const drawer = within(screen.getByRole('dialog'));
      expect(drawer.getByText('Some changes wait for review')).toBeInTheDocument();
      // The proposed value, which is what the service answered with.
      const name = drawer.getByRole('textbox', { name: 'Name' });
      expect(name).toHaveValue('Steel mug');
      expect(name).toHaveAccessibleDescription(expect.stringContaining(FIELD_NOTE));
      expect(drawer.getByRole('switch', { name: 'Delivered as a file' })).toHaveAccessibleDescription(
        expect.stringContaining(FIELD_NOTE),
      );
      expect(drawer.getByRole('textbox', { name: 'Description' })).not.toHaveAccessibleDescription(
        expect.stringContaining(FIELD_NOTE),
      );
    });

    it('says nothing of review in the drawer of an item nothing waits for', async () => {
      const user = await openRewards({ project: LIVE, items: [UNHELD], rewards: [SECOND] });

      await user.click(screen.getByRole('button', { name: 'Edit Enamel mug' }));

      const drawer = within(screen.getByRole('dialog'));
      expect(drawer.queryByText('Some changes wait for review')).not.toBeInTheDocument();
      expect(drawer.queryByText(FIELD_NOTE)).not.toBeInTheDocument();
    });

    it('after a save the service holds, says why the public name has not changed', async () => {
      const user = await openRewards({ project: LIVE, items: [MUG], rewards: [SECOND] });
      patchItemMock.mockResolvedValue({ ...MUG, name: 'Steel mug', revisionChangedFields: ['name'] });
      getProjectEditMock.mockClear();

      await user.click(screen.getByRole('button', { name: 'Edit Enamel mug' }));
      const name = screen.getByRole('textbox', { name: 'Name' });
      await user.clear(name);
      await user.type(name, 'Steel mug');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(patchItemMock).toHaveBeenCalledWith('item-mug', { name: 'Steel mug' });
      expect(within(itemsSection()).getByText('Changed, waiting for review')).toBeInTheDocument();
      const announcements = screen.getAllByRole('status').map((region) => region.textContent);
      expect(announcements).toContain(
        'Your changes to Steel mug wait for a moderator. Backers see the approved version until then.',
      );
      // The revision notice above the tab is read again, so it can name the items.
      expect(getProjectEditMock).toHaveBeenCalledTimes(1);
    });

    it('announces nothing about review after a save written at once', async () => {
      const user = await openRewards({ project: LIVE, items: [MUG], rewards: [SECOND] });
      patchItemMock.mockResolvedValue({ ...MUG, sku: 'MUG-01', revisionChangedFields: [] });

      await user.click(screen.getByRole('button', { name: 'Edit Enamel mug' }));
      await user.type(screen.getByRole('textbox', { name: 'Stock code' }), 'MUG-01');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await tick();

      expect(patchItemMock).toHaveBeenCalledWith('item-mug', { sku: 'MUG-01' });
      expect(within(itemsSection()).queryByText(/waiting for review/)).not.toBeInTheDocument();
      const announcements = screen.getAllByRole('status').map((region) => region.textContent);
      expect(announcements.some((text) => text?.includes('wait for a moderator'))).toBe(false);
    });
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

      render(<RewardsPanel projectId="project-1" copy={EDITOR_COPY} rewards={REWARDS_COPY} />);
      await tick();

      expect(screen.getByText('You are signed out')).toBeInTheDocument();
    });

    it('offers a retry when the lists simply failed', async () => {
      getProjectEditMock.mockResolvedValue(PROJECT);
      listItemsMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      listRewardsMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const user = userEvent.setup({ advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });
      render(<RewardsPanel projectId="project-1" copy={EDITOR_COPY} rewards={REWARDS_COPY} />);
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
