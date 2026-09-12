import { describe, expect, it } from 'vitest';
import type { Item, Reward } from './api';
import { REWARDS_COPY } from '../../test-editor-copy';
import RU_MESSAGES from '../../../messages/ru.json';

/** The Russian forms, read from the catalogue rather than retyped into the assertion. */
const RU_LIMIT_BELOW_COMMITTED =
  RU_MESSAGES.campaignEditor.rewards.vocabulary.reward.limitBelowCommitted;
import {
  EMPTY_ITEM,
  ITEM_NAME_MAX_CHARACTERS,
  REWARD_TITLE_MAX_CHARACTERS,
  describeStock,
  emptyReward,
  hidePatch,
  isEmptyPatch,
  isHiddenReward,
  isScheduledReward,
  isShippingType,
  itemDraftFrom,
  itemPatchFrom,
  movedTo,
  newItemFrom,
  newRewardFrom,
  rewardDraftFrom,
  rewardPatchFrom,
  shippingRatesChanged,
  shippingRatesFrom,
  showBlockedReason,
  showPatch,
  validateItem,
  validateReward,
  type RewardDraft,
} from './rewards';

/**
 * The rules of docs/architecture.md §5.3 and of `RewardService`, at their
 * boundaries.
 *
 * Money arithmetic and state transitions are not optional to test (CLAUDE.md
 * §3), and this module carries both: a price that must never become a float on
 * its way to the wire, and the quantity rule that decides whether a tier can be
 * oversold. The other half of what is here is the DIFF — a patch that repeats
 * an unchanged price is a 409 waiting for #36 to land, and nothing else in the
 * codebase would notice it had started doing that.
 */

const ITEM: Item = {
  id: 'item-mug',
  projectId: 'project-1',
  name: 'Enamel mug',
  description: 'Chipped by design.',
  imageUrl: null,
  weightGrams: 320,
  isDigital: false,
  sku: 'MUG-01',
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

const REWARD: Reward = {
  id: 'reward-early',
  projectId: 'project-1',
  title: 'Early bird',
  description: 'The first hundred.',
  price: { amount: '19.99', currency: 'AZN' },
  estimatedDelivery: '2027-03-01',
  limitQuantity: 100,
  claimedQuantity: 0,
  reservedQuantity: 0,
  remainingQuantity: 100,
  shippingType: 'DOMESTIC',
  isEarlyBird: true,
  isFeatured: false,
  isSecret: false,
  secretToken: null,
  isAddon: false,
  sortOrder: 0,
  availableFrom: null,
  availableUntil: null,
  items: [{ itemId: 'item-mug', quantity: 1 }],
  shippingRules: [{ countryCode: 'AZ', amount: '5.00', additionalItemAmount: '0.00' }],
  version: 3,
  pricingLocked: false,
  createdAt: '2026-08-15T09:00:00.000Z',
  updatedAt: '2026-08-15T09:00:00.000Z',
};

function draft(overrides: Partial<RewardDraft> = {}): RewardDraft {
  return { ...emptyReward('AZN'), title: 'Early bird', priceAmount: '19.99', ...overrides };
}

describe('an item', () => {
  it('needs a name, because the column is NOT NULL', () => {
    expect(validateItem(EMPTY_ITEM, REWARDS_COPY.vocabulary.item).name).toBe('An item needs a name.');
    expect(validateItem({ ...EMPTY_ITEM, name: '   ' }, REWARDS_COPY.vocabulary.item).name).toBe('An item needs a name.');
  });

  it(`accepts a ${ITEM_NAME_MAX_CHARACTERS}-character name and refuses the next one`, () => {
    expect(validateItem({ ...EMPTY_ITEM, name: 'a'.repeat(120) }, REWARDS_COPY.vocabulary.item).name).toBeUndefined();
    expect(validateItem({ ...EMPTY_ITEM, name: 'a'.repeat(121) }, REWARDS_COPY.vocabulary.item).name).toBe(
      'A name is 120 characters or fewer. Remove 1.',
    );
  });

  /*
   * The database refuses a digital item with a weight outright, so this is not
   * a matter of taste — and the message names both ways out because either is a
   * legitimate thing the creator meant.
   */
  it('refuses a weight on something delivered as a file', () => {
    const errors = validateItem({ ...EMPTY_ITEM, name: 'Wallpaper', isDigital: true, weightGrams: '10' }, REWARDS_COPY.vocabulary.item);
    expect(errors.weightGrams).toContain('A digital item has no shipping weight');
  });

  it.each([
    ['2.5', 'Enter the weight as a whole number of grams.'],
    ['0', 'A weight is more than zero grams.'],
  ])('refuses a weight of %s', (weight, message) => {
    expect(validateItem({ ...EMPTY_ITEM, name: 'Mug', weightGrams: weight }, REWARDS_COPY.vocabulary.item).weightGrams).toBe(
      message,
    );
  });

  it('sends an emptied optional field as null rather than as an empty string', () => {
    // The service stores a blank as null; sending `""` would be refused by the
    // database's own "a description is not zero-length" constraint.
    expect(newItemFrom({ ...EMPTY_ITEM, name: '  Mug  ' })).toEqual({
      name: 'Mug',
      description: null,
      imageUrl: null,
      weightGrams: null,
      isDigital: false,
      sku: null,
    });
  });

  describe('the patch', () => {
    it('is empty when nothing changed, so no request is made at all', () => {
      expect(isEmptyPatch(itemPatchFrom(itemDraftFrom(ITEM), ITEM))).toBe(true);
    });

    it('carries only the field that changed', () => {
      const edited = { ...itemDraftFrom(ITEM), name: 'Enamel mug, second edition' };
      expect(itemPatchFrom(edited, ITEM)).toEqual({ name: 'Enamel mug, second edition' });
    });

    /*
     * The two that describe what the item physically is travel together,
     * because the service applies them together: making an item digital clears
     * its weight, and sending half the pair leaves the server combining a new
     * value with a stale one.
     */
    it('sends the weight with the digital flag whenever either moves', () => {
      const edited = { ...itemDraftFrom(ITEM), isDigital: true, weightGrams: '' };
      expect(itemPatchFrom(edited, ITEM)).toEqual({ isDigital: true, weightGrams: null });
    });
  });
});

describe('a reward tier', () => {
  it('needs a title and a price, which are the two the service requires', () => {
    const errors = validateReward(emptyReward('AZN'), REWARDS_COPY.vocabulary.reward);
    expect(errors.title).toBe('A reward needs a title.');
    expect(errors.price).toBe('A reward needs a price.');
  });

  it(`accepts a ${REWARD_TITLE_MAX_CHARACTERS}-character title and refuses the next one`, () => {
    expect(validateReward(draft({ title: 'a'.repeat(80) }), REWARDS_COPY.vocabulary.reward).title).toBeUndefined();
    expect(validateReward(draft({ title: 'a'.repeat(81) }), REWARDS_COPY.vocabulary.reward).title).toBe(
      'A title is 80 characters or fewer. Remove 1.',
    );
  });

  describe('the price', () => {
    /*
     * §5.3 puts the floor at "the smallest chargeable amount", which is the
     * payment provider's and lives in configuration. Zero and below are not
     * prices at all, which is exactly what `RewardService.requirePrice` says.
     */
    it.each([
      ['0', 'A reward price is more than zero.'],
      ['0.00', 'A reward price is more than zero.'],
      ['19,99', 'Use a full stop for the decimal point, for example 19.99.'],
      ['19.999', 'A price has at most two decimal places.'],
      ['1e5', 'Enter the price in digits, for example 19.99.'],
    ])('refuses %s', (amount, message) => {
      expect(validateReward(draft({ priceAmount: amount }), REWARDS_COPY.vocabulary.reward).price).toBe(message);
    });

    it('crosses the wire as a string, at the scale the column holds', () => {
      const body = newRewardFrom(draft({ priceAmount: '19.9' }));
      expect(body.price).toEqual({ amount: '19.90', currency: 'AZN' });
      expect(typeof body.price.amount).toBe('string');
    });

    it('keeps every digit of an amount a JSON number could not hold', () => {
      const body = newRewardFrom(draft({ priceAmount: '999999999999.99' }));
      expect(body.price.amount).toBe('999999999999.99');
    });
  });

  describe('the number of places', () => {
    it('may be raised freely', () => {
      const errors = validateReward(draft({ limitQuantity: '500' }), REWARDS_COPY.vocabulary.reward, { committedQuantity: 40 });
      expect(errors.limitQuantity).toBeUndefined();
    });

    /*
     * §5.3 permits lowering a quantity only above what is already taken, and a
     * RESERVED place counts: it is somebody entering their card details. The
     * caller adds the two together, which is what `committedQuantity` is.
     */
    it('may be lowered to exactly what is taken, and no further', () => {
      expect(
        validateReward(draft({ limitQuantity: '40' }), REWARDS_COPY.vocabulary.reward, { committedQuantity: 40 }).limitQuantity,
      ).toBeUndefined();

      expect(
        validateReward(draft({ limitQuantity: '39' }), REWARDS_COPY.vocabulary.reward, { committedQuantity: 40 }).limitQuantity,
      ).toContain('below the 40 places already taken');
    });

    it('refuses in the reader’s language, declining the count as that language does', () => {
      /*
       * The English catalogue says "places" for every number above one, so an English
       * assertion cannot tell a working plural rule from a hard-coded "s". Russian can:
       * 1 место, 3 места, 5 мест. This is what `lib/i18n/plurals.ts` is for, and the
       * message was built with an English ternary until #459.
       */
      const russian = { ...REWARDS_COPY.vocabulary.reward, locale: 'ru' as const,
        limitBelowCommitted: RU_LIMIT_BELOW_COMMITTED };

      const refusal = (committedQuantity: number) =>
        validateReward(draft({ limitQuantity: '1' }), russian, {
          committedQuantity,
        }).limitQuantity;

      /*
       * No case for one place taken: to be below it the limit would have to be zero, and
       * `places < 1` is refused a branch earlier. Russian's `one` category is still covered —
       * it is what 21 selects, which is the half of the rule an English "s" gets wrong.
       */
      expect(refusal(3)).toContain('3 уже занятых места');
      expect(refusal(5)).toContain('5 уже занятых мест');
      expect(refusal(21)).toContain('21 уже занятое место');
    });

    it('is a whole number of at least one, or empty for unlimited', () => {
      expect(validateReward(draft({ limitQuantity: '0' }), REWARDS_COPY.vocabulary.reward).limitQuantity).toContain(
        'at least one place',
      );
      expect(validateReward(draft({ limitQuantity: '1.5' }), REWARDS_COPY.vocabulary.reward).limitQuantity).toContain(
        'whole number',
      );
      expect(validateReward(draft({ limitQuantity: '' }), REWARDS_COPY.vocabulary.reward).limitQuantity).toBeUndefined();
      expect(newRewardFrom(draft({ limitQuantity: '' })).limitQuantity).toBeNull();
    });
  });

  describe('the combinations the service refuses', () => {
    it('refuses a tier that is both secret and featured', () => {
      const errors = validateReward(draft({ isSecret: true, isFeatured: true }), REWARDS_COPY.vocabulary.reward);
      expect(errors.isFeatured).toContain('not shown on the page');
    });

    it('refuses an early bird with neither a closing date nor a limit', () => {
      expect(validateReward(draft({ isEarlyBird: true }), REWARDS_COPY.vocabulary.reward).isEarlyBird).toContain(
        'closing date or a limited number of places',
      );
      expect(
        validateReward(draft({ isEarlyBird: true, limitQuantity: '100' }), REWARDS_COPY.vocabulary.reward).isEarlyBird,
      ).toBeUndefined();
      expect(
        validateReward(draft({ isEarlyBird: true, availableUntil: '2027-01-01T10:00' }), REWARDS_COPY.vocabulary.reward).isEarlyBird,
      ).toBeUndefined();
    });

    it('refuses a window that closes before it opens', () => {
      const errors = validateReward(
        draft({ availableFrom: '2027-01-02T10:00', availableUntil: '2027-01-01T10:00' }),
        REWARDS_COPY.vocabulary.reward,
      );
      expect(errors.availableUntil).toBe('A reward closes after it opens, not before.');
    });
  });

  describe('the composition', () => {
    it('refuses a quantity below one', () => {
      const errors = validateReward(draft({ items: [{ itemId: 'item-mug', quantity: '0' }] }), REWARDS_COPY.vocabulary.reward);
      expect(errors.items).toContain('at least one of every item');
    });

    it('refuses the same item on two lines', () => {
      const errors = validateReward(
        draft({
          items: [
            { itemId: 'item-mug', quantity: '1' },
            { itemId: 'item-mug', quantity: '2' },
          ],
        }),
        REWARDS_COPY.vocabulary.reward,
      );
      expect(errors.items).toContain('Each item appears once');
    });

    it('sends quantities as numbers, because that is what the line is', () => {
      const body = newRewardFrom(draft({ items: [{ itemId: 'item-mug', quantity: '3' }] }));
      expect(body.items).toEqual([{ itemId: 'item-mug', quantity: 3 }]);
    });
  });

  describe('the shipping rates', () => {
    it('refuses rates on a tier that is not shipped', () => {
      const errors = validateReward(
        draft({
          shippingType: 'DIGITAL',
          shippingRules: [{ countryCode: 'AZ', amount: '5.00', additionalItemAmount: '0.00' }],
        }),
        REWARDS_COPY.vocabulary.reward,
      );
      expect(errors.rules).toContain('Change the delivery method');
    });

    it('refuses a destination that is not a two-letter country code', () => {
      const errors = validateReward(
        draft({
          shippingType: 'DOMESTIC',
          shippingRules: [{ countryCode: 'AZE', amount: '5.00', additionalItemAmount: '0.00' }],
        }),
        REWARDS_COPY.vocabulary.reward,
      );
      expect(errors.rules).toContain('two-letter country code');
    });

    it('refuses the same destination twice, naming it', () => {
      const errors = validateReward(
        draft({
          shippingType: 'INTERNATIONAL',
          shippingRules: [
            { countryCode: 'az', amount: '5.00', additionalItemAmount: '0.00' },
            { countryCode: 'AZ', amount: '6.00', additionalItemAmount: '0.00' },
          ],
        }),
        REWARDS_COPY.vocabulary.reward,
      );
      expect(errors.rules).toBe('Each destination appears once: AZ is listed twice.');
    });

    /*
     * A rate of zero is free shipping, which is an offer creators make on
     * purpose. It is the one amount on the platform that is legitimately zero.
     */
    it('accepts a rate of zero, and normalises both amounts', () => {
      const rates = shippingRatesFrom(
        draft({
          shippingType: 'DOMESTIC',
          shippingRules: [{ countryCode: 'az', amount: '0', additionalItemAmount: '' }],
        }),
      );
      expect(rates).toEqual([{ countryCode: 'AZ', amount: '0.00', additionalItemAmount: '0.00' }]);
    });

    it('sends nothing at all for a tier that is not shipped', () => {
      expect(
        shippingRatesFrom(
          draft({
            shippingType: 'NONE',
            shippingRules: [{ countryCode: 'AZ', amount: '5.00', additionalItemAmount: '0.00' }],
          }),
        ),
      ).toEqual([]);
    });

    it('knows when the table is unchanged, so the second request is not made', () => {
      expect(shippingRatesChanged(rewardDraftFrom(REWARD), REWARD)).toBe(false);

      const repriced = rewardDraftFrom(REWARD);
      expect(
        shippingRatesChanged(
          { ...repriced, shippingRules: [{ countryCode: 'AZ', amount: '6.00', additionalItemAmount: '0.00' }] },
          REWARD,
        ),
      ).toBe(true);
    });
  });

  describe('the patch', () => {
    it('is empty when nothing changed', () => {
      expect(isEmptyPatch(rewardPatchFrom(rewardDraftFrom(REWARD), REWARD))).toBe(true);
    });

    /*
     * The reason the diff exists. A price is immutable after launch (§5.3) and
     * #36 will refuse it, so a body that repeated the unchanged price would
     * turn every edit of a live campaign's description into a 409 about a field
     * the creator never touched.
     */
    it('leaves the price out when the price did not change', () => {
      const edited = { ...rewardDraftFrom(REWARD), description: 'The first hundred, signed.' };
      expect(rewardPatchFrom(edited, REWARD)).toEqual({
        description: 'The first hundred, signed.',
      });
    });

    it('carries the price when it did, as a string', () => {
      const edited = { ...rewardDraftFrom(REWARD), priceAmount: '24' };
      expect(rewardPatchFrom(edited, REWARD)).toEqual({
        price: { amount: '24.00', currency: 'AZN' },
      });
    });

    it('does not flip a secret tier back and forth, which would rotate its token', () => {
      const unchanged = rewardPatchFrom(rewardDraftFrom({ ...REWARD, isSecret: true }), {
        ...REWARD,
        isSecret: true,
      });
      expect(unchanged.isSecret).toBeUndefined();
    });

    it('replaces the whole composition when any line moves', () => {
      const edited = {
        ...rewardDraftFrom(REWARD),
        items: [{ itemId: 'item-mug', quantity: '2' }],
      };
      expect(rewardPatchFrom(edited, REWARD).items).toEqual([{ itemId: 'item-mug', quantity: 2 }]);
    });

    /*
     * `toDateTimeLocal` drops seconds, so an instant that carried them would
     * never compare equal to itself and the field would look permanently
     * changed — a save that rewrote the window on every unrelated edit.
     */
    it('does not report an availability window as changed when it was not touched', () => {
      const withWindow: Reward = { ...REWARD, availableUntil: '2027-01-01T10:00:30.000Z' };
      expect(rewardPatchFrom(rewardDraftFrom(withWindow), withWindow).availableUntil).toBeUndefined();
    });
  });
});

/*
 * §5.3 forbids deleting a tier with backers and permits hiding it, and the
 * service expresses hidden as `available_until` in the past. That is a good
 * decision in the schema and a terrible sentence to show a creator, so the
 * editor reads the date here and says "hidden" everywhere else.
 */
describe('hiding, which is what deleting becomes once somebody has backed a tier', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('reads a closing date in the past as hidden, and one in the future as not', () => {
    expect(isHiddenReward({ ...REWARD, availableUntil: '2026-08-15T11:00:00.000Z' }, now)).toBe(
      true,
    );
    expect(isHiddenReward({ ...REWARD, availableUntil: '2026-08-16T11:00:00.000Z' }, now)).toBe(
      false,
    );
    expect(isHiddenReward(REWARD, now)).toBe(false);
  });

  it('reads a start date in the future as not yet open', () => {
    expect(isScheduledReward({ ...REWARD, availableFrom: '2026-09-01T00:00:00.000Z' }, now)).toBe(
      true,
    );
    expect(isScheduledReward(REWARD, now)).toBe(false);
  });

  it('closes the tier now', () => {
    expect(hidePatch(REWARD, now)).toEqual({ availableUntil: now.toISOString() });
  });

  /*
   * The service refuses a window that closes before it opens, so a tier
   * scheduled to open next month cannot simply be closed today — and a tier
   * being withdrawn now is not one that is still going to open.
   */
  it('clears a start date that has not arrived, or the service would refuse the hide', () => {
    expect(hidePatch({ ...REWARD, availableFrom: '2026-09-01T00:00:00.000Z' }, now)).toEqual({
      availableUntil: now.toISOString(),
      availableFrom: null,
    });
  });

  it('puts it back on sale by clearing the closing date', () => {
    expect(showPatch()).toEqual({ availableUntil: null });
  });

  /*
   * Showing an early-bird tier again clears its closing date, and an early bird
   * with no closing date and no cap is what `requireConsistent` refuses. Saying
   * so before the request is the difference between fixing one field and
   * reading a 400 about a field nobody touched.
   */
  it('says why an early bird with no limit cannot simply be shown again', () => {
    expect(showBlockedReason({ ...REWARD, isEarlyBird: true, limitQuantity: null }, REWARDS_COPY.vocabulary)).toContain(
      'Set a limit, or turn off early bird',
    );
    expect(showBlockedReason(REWARD, REWARDS_COPY.vocabulary)).toBeNull();
  });
});

describe('the order', () => {
  it('moves one entry and leaves the rest in sequence', () => {
    expect(movedTo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(movedTo(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  /*
   * Off the end is the same list, not a clamp: the controls are disabled at the
   * ends, and a clamp would make "move up" on the first tier a request that
   * reorders nothing while telling the creator it moved.
   */
  it('is the same list when the move goes off either end', () => {
    const list = ['a', 'b', 'c'];
    expect(movedTo(list, 0, -1)).toBe(list);
    expect(movedTo(list, 2, 3)).toBe(list);
    expect(movedTo(list, 1, 1)).toBe(list);
  });
});

describe('the sentences the list needs', () => {
  it('says unlimited rather than showing an empty count', () => {
    expect(describeStock({ ...REWARD, limitQuantity: null, remainingQuantity: null }, REWARDS_COPY.vocabulary)).toBe(
      'Unlimited places',
    );
  });

  it('says how many places are left of how many', () => {
    expect(
      describeStock({
        ...REWARD,
        limitQuantity: 100,
        claimedQuantity: 8,
        reservedQuantity: 2,
        remainingQuantity: 90,
      }, REWARDS_COPY.vocabulary),
    ).toBe('90 of 100 places left');
  });
});

describe('the shipping scope', () => {
  it('accepts only the five the service defines', () => {
    expect(isShippingType('INTERNATIONAL')).toBe(true);
    expect(isShippingType('EVERYWHERE')).toBe(false);
    expect(isShippingType('')).toBe(false);
  });
});
