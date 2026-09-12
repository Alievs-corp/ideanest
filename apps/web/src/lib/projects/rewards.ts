import { parseAmount, toMoney, toWireAmount, type AmountRejection } from '../money';
import {
  characterCount,
  fromDateTimeLocal,
  toDateTimeLocal,
} from './basics';
import type {
  AmountMessagesCopy,
  ItemValidationCopy,
  RewardValidationCopy,
  RewardsVocabularyCopy,
} from '../i18n/campaign-editor-copy';
import { fillPlaceholders } from '../i18n/placeholders';
import { pluralise } from '../i18n/plurals';
import type {
  Item,
  ItemPatch,
  NewItem,
  NewReward,
  Reward,
  RewardItemLine,
  RewardPatch,
  ShippingRate,
  ShippingType,
} from './api';

/**
 * The rewards tab, as data: what the creator has typed, what is wrong with it,
 * and what that turns into on the wire.
 *
 * Kept out of the components for the reason `basics.ts` gives — these are the
 * rules of docs/architecture.md §5.3 and of `RewardService`, and rules that live
 * inside a form are rules nobody can test at their boundaries. Eighty
 * characters, a hundred tiers, a price of zero, and a limit one below what is
 * claimed are exactly where this fails, so they are exactly what the tests
 * drive.
 *
 * <h3>THE CLIENT VALIDATES WHAT IS WRONG, NOT WHAT IS MISSING</h3>
 *
 * The same rule the basics tab follows. §5.3 is a list of SUBMISSION
 * requirements and a draft is by definition incomplete, so "too long", "not a
 * number", "below what is already taken" and "two settings that contradict each
 * other" are errors here; "not filled in yet" is not. The two exceptions are a
 * tier's title and its price, because neither is optional at the endpoint: a
 * tier with no price is not something a backer can select, and the service
 * refuses both outright.
 *
 * <h3>THE SERVER IS STILL THE AUTHORITY</h3>
 *
 * Everything below is duplicated in `RewardService`, deliberately. This copy
 * exists so a creator gets a specific message beside the input instead of a
 * round trip; it is not the enforcement. Where the two disagree the server
 * wins, which is why every form here renders the refusal it gets back as well
 * as the check it ran first.
 */

/* -------------------------------------------------------------------------
 * The boundaries, in one place
 * ---------------------------------------------------------------------- */

/** `RewardService.TITLE_MAX`. A tier title is a label, not a paragraph. */
export const REWARD_TITLE_MAX_CHARACTERS = 80;

/** §5.3: a campaign offers between zero and a hundred tiers. */
export const MAX_REWARD_TIERS = 100;

/** `ItemService.NAME_MAX`. Long enough for "Hardcover, signed by the illustrator". */
export const ITEM_NAME_MAX_CHARACTERS = 120;

/** `ItemService.SKU_MAX`. A warehouse code, not a description. */
export const ITEM_SKU_MAX_CHARACTERS = 64;

/**
 * Integers only. `"2.5"` and `"2 items"` are both refusals, and both are things
 * a numeric-looking field cheerfully accepts if nobody checks.
 */
const WHOLE_NUMBER = /^\d+$/;

/** ISO 3166-1 alpha-2, which is what `ShippingRule` stores and re-checks. */
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/**
 * The five shipping scopes, with the sentence that says what each one means for
 * a backer.
 *
 * The hint matters more here than in most selects: the difference between
 * `NONE` and `DIGITAL` is invisible from the words alone, and choosing wrongly
 * decides whether a backer is asked for a postal address at all.
 */
/**
 * The delivery scopes §5.3 recognises, in the order they are offered.
 *
 * NO `label` AND NO `hint` ANY MORE — issue #324. The words are catalogue copy, read as
 * `copy.scopes[scope]`, for the reason `tabs.ts` gives about its own sections: a spelling
 * here as well would be the second declaration, and the second is the one nobody updates.
 * What stays is the list, which is what the guard below and the option order need.
 */
export const SHIPPING_SCOPES: readonly ShippingType[] = [
  'NONE',
  'DIGITAL',
  'LOCAL_PICKUP',
  'DOMESTIC',
  'INTERNATIONAL',
];

/**
 * Narrows what a `<select>` hands back.
 *
 * `event.target.value` is a `string`, and a cast to the union would be a
 * promise the compiler cannot check — the one place where a value the DOM
 * produced becomes a domain type is exactly where a cast is worth least.
 * `SHIPPING_SCOPES` is the list the options are rendered from, so the guard
 * cannot fall out of step with what is offered.
 */
export function isShippingType(value: string): value is ShippingType {
  return SHIPPING_SCOPES.some((scope) => scope === value);
}

/** Whether a per-country rate means anything for this scope. `ShippingType.isShipped`. */
export function isShippedScope(scope: ShippingType): boolean {
  return scope === 'DOMESTIC' || scope === 'INTERNATIONAL';
}

export function shippingScopeLabel(
  scope: ShippingType,
  copy: Readonly<Record<ShippingType, { label: string }>>,
): string {
  return copy[scope]?.label ?? scope;
}

/* -------------------------------------------------------------------------
 * Items
 * ---------------------------------------------------------------------- */

/**
 * The item form's own state.
 *
 * Every field is the string the control holds, not the parsed value — the same
 * reasoning as `BasicsDraft`. A field that stores a number cannot hold `"12"`
 * on its way to `"120"` without briefly being the number twelve, and on a
 * weight that is merely wrong; on a price it would be a different product.
 */
export interface ItemDraft {
  name: string;
  description: string;
  imageUrl: string;
  weightGrams: string;
  isDigital: boolean;
  sku: string;
}

export const EMPTY_ITEM: ItemDraft = {
  name: '',
  description: '',
  imageUrl: '',
  weightGrams: '',
  isDigital: false,
  sku: '',
};

export function itemDraftFrom(item: Item): ItemDraft {
  return {
    name: item.name,
    description: item.description ?? '',
    imageUrl: item.imageUrl ?? '',
    weightGrams: item.weightGrams == null ? '' : String(item.weightGrams),
    isDigital: item.isDigital,
    sku: item.sku ?? '',
  };
}

/**
 * Field names as the API names them, because a refusal is keyed by them — a 400
 * from bean validation puts them in `errors`, and one from `ItemService` puts
 * one of them in `meta.field`. A message that cannot be matched to a control
 * ends up in a banner over a form with six of them.
 */
export type ItemField = 'name' | 'description' | 'imageUrl' | 'weightGrams' | 'isDigital' | 'sku';

export const ITEM_FIELDS: readonly ItemField[] = [
  'name',
  'description',
  'imageUrl',
  'weightGrams',
  'isDigital',
  'sku',
];

export function isItemField(value: string): value is ItemField {
  return (ITEM_FIELDS as readonly string[]).includes(value);
}

export type ItemErrors = Partial<Record<ItemField, string>>;

/** THE COPY IS AN ARGUMENT, for the reason `validateBasics` states: this runs per keystroke. */
export function validateItem(draft: ItemDraft, copy: ItemValidationCopy): ItemErrors {
  const errors: ItemErrors = {};

  const nameLength = characterCount(draft.name.trim());
  if (nameLength === 0) {
    // Not "not filled in yet": `items.name` is NOT NULL and the service refuses
    // a blank one, so an empty name is a save that cannot succeed.
    errors.name = copy.nameRequired;
  } else if (nameLength > ITEM_NAME_MAX_CHARACTERS) {
    errors.name = fillPlaceholders(copy.nameTooLong, {
      max: String(ITEM_NAME_MAX_CHARACTERS),
      over: String(nameLength - ITEM_NAME_MAX_CHARACTERS),
    });
  }

  if (characterCount(draft.sku.trim()) > ITEM_SKU_MAX_CHARACTERS) {
    errors.sku = fillPlaceholders(copy.skuTooLong, { max: String(ITEM_SKU_MAX_CHARACTERS) });
  }

  const weight = draft.weightGrams.trim();
  if (weight !== '') {
    if (draft.isDigital) {
      /*
       * The database refuses the combination outright, so this is not a matter
       * of taste. It is worded as two ways out rather than one because either
       * is a legitimate thing the creator meant.
       */
      errors.weightGrams = copy.weightOnDigital;
    } else if (!WHOLE_NUMBER.test(weight)) {
      errors.weightGrams = copy.weightNotWhole;
    } else if (Number.parseInt(weight, 10) <= 0) {
      errors.weightGrams = copy.weightNotPositive;
    }
  }

  return errors;
}

/** An emptied text input means "no value", which the service stores as null. */
function blankAsNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function weightOf(draft: ItemDraft): number | null {
  const weight = draft.weightGrams.trim();
  if (draft.isDigital || weight === '' || !WHOLE_NUMBER.test(weight)) return null;
  return Number.parseInt(weight, 10);
}

/** The body that creates the item. Call it only with a draft `validateItem` accepted. */
export function newItemFrom(draft: ItemDraft): NewItem {
  return {
    name: draft.name.trim(),
    description: blankAsNull(draft.description),
    imageUrl: blankAsNull(draft.imageUrl),
    weightGrams: weightOf(draft),
    isDigital: draft.isDigital,
    sku: blankAsNull(draft.sku),
  };
}

/**
 * The fields that actually changed, and no others.
 *
 * ONLY WHAT CHANGED, even though the form holds all of it. The endpoint has
 * merge-patch semantics, so every key present is written — and a body that
 * repeats an unchanged field is a body that overwrites whatever another tab
 * wrote to it, and that will be refused outright once #36 locks fields after
 * launch. An empty patch means there is nothing to send, and the caller checks
 * for one rather than making a request that changes nothing.
 */
export function itemPatchFrom(draft: ItemDraft, original: Item): ItemPatch {
  const patch: ItemPatch = {};
  const name = draft.name.trim();
  if (name !== original.name) patch.name = name;

  const description = blankAsNull(draft.description);
  if (description !== (original.description ?? null)) patch.description = description;

  const imageUrl = blankAsNull(draft.imageUrl);
  if (imageUrl !== (original.imageUrl ?? null)) patch.imageUrl = imageUrl;

  const sku = blankAsNull(draft.sku);
  if (sku !== (original.sku ?? null)) patch.sku = sku;

  /*
   * The two that describe what the item physically is travel together, because
   * the service applies them together: making an item digital clears its
   * weight, and sending only half of the pair leaves the server to combine a
   * new value with a stale one.
   */
  const weight = weightOf(draft);
  if (draft.isDigital !== original.isDigital || weight !== (original.weightGrams ?? null)) {
    patch.isDigital = draft.isDigital;
    patch.weightGrams = weight;
  }

  return patch;
}

export function isEmptyPatch(patch: object): boolean {
  return Object.keys(patch).length === 0;
}

/* -------------------------------------------------------------------------
 * Reward tiers
 * ---------------------------------------------------------------------- */

/** One line of the composition, as the form holds it. */
export interface RewardLineDraft {
  itemId: string;
  /** A string, so a half-typed quantity is a state the field can be in. */
  quantity: string;
}

/** One destination's rate, as the form holds it. Both amounts are strings. */
export interface ShippingRateDraft {
  countryCode: string;
  amount: string;
  additionalItemAmount: string;
}

export interface RewardDraft {
  title: string;
  description: string;
  priceAmount: string;
  currency: string;
  /** The `date` control's value, `yyyy-mm-dd`, which is what the column holds. */
  estimatedDelivery: string;
  /** Empty is unlimited. */
  limitQuantity: string;
  shippingType: ShippingType;
  isEarlyBird: boolean;
  isFeatured: boolean;
  isSecret: boolean;
  isAddon: boolean;
  /** The `datetime-local` value: local wall-clock time, no offset. */
  availableFrom: string;
  availableUntil: string;
  items: readonly RewardLineDraft[];
  shippingRules: readonly ShippingRateDraft[];
}

/**
 * A blank tier, priced in the campaign's currency.
 *
 * The currency is passed in rather than defaulted here: a tier has to be priced
 * in the campaign's currency or the service refuses it, and hard-coding the one
 * currency the platform collects in today would be a second place to change
 * when there are two.
 */
export function emptyReward(currency: string): RewardDraft {
  return {
    title: '',
    description: '',
    priceAmount: '',
    currency,
    estimatedDelivery: '',
    limitQuantity: '',
    shippingType: 'NONE',
    isEarlyBird: false,
    isFeatured: false,
    isSecret: false,
    isAddon: false,
    availableFrom: '',
    availableUntil: '',
    items: [],
    shippingRules: [],
  };
}

export function rewardDraftFrom(reward: Reward): RewardDraft {
  return {
    title: reward.title,
    description: reward.description ?? '',
    priceAmount: reward.price.amount,
    currency: reward.price.currency,
    estimatedDelivery: reward.estimatedDelivery ?? '',
    limitQuantity: reward.limitQuantity == null ? '' : String(reward.limitQuantity),
    shippingType: reward.shippingType,
    isEarlyBird: reward.isEarlyBird,
    isFeatured: reward.isFeatured,
    isSecret: reward.isSecret,
    isAddon: reward.isAddon,
    availableFrom: toDateTimeLocal(reward.availableFrom),
    availableUntil: toDateTimeLocal(reward.availableUntil),
    items: reward.items.map((line) => ({ itemId: line.itemId, quantity: String(line.quantity) })),
    shippingRules: reward.shippingRules.map((rule) => ({
      countryCode: rule.countryCode,
      amount: rule.amount,
      additionalItemAmount: rule.additionalItemAmount,
    })),
  };
}

/**
 * Field names as the API names them.
 *
 * `rules` is the odd one: the rate table is written through a different
 * endpoint, and `RewardService` names its refusals about it `rules` rather than
 * `shippingRules`. Matching the server means a refusal lands on the table
 * without a translation table in between.
 */
export type RewardField =
  | 'title'
  | 'description'
  | 'price'
  | 'estimatedDelivery'
  | 'limitQuantity'
  | 'shippingType'
  | 'isEarlyBird'
  | 'isFeatured'
  | 'isSecret'
  | 'isAddon'
  | 'availableFrom'
  | 'availableUntil'
  | 'items'
  | 'rules';

export const REWARD_FIELDS: readonly RewardField[] = [
  'title',
  'description',
  'price',
  'estimatedDelivery',
  'limitQuantity',
  'shippingType',
  'isEarlyBird',
  'isFeatured',
  'isSecret',
  'isAddon',
  'availableFrom',
  'availableUntil',
  'items',
  'rules',
];

export function isRewardField(value: string): value is RewardField {
  return (REWARD_FIELDS as readonly string[]).includes(value);
}

export type RewardErrors = Partial<Record<RewardField, string>>;

/**
 * Worded for a reward price rather than for a funding goal.
 *
 * `parseAmount` returns a reason and not a sentence exactly so that the two can
 * differ: "Enter the goal in digits" is wrong on a field labelled Price, and a
 * creator reading it wonders which field the message is about.
 */
function amountMessage(copy: AmountMessagesCopy, reason: AmountRejection): string {
  const messages: Record<AmountRejection, string> = {
    empty: copy.empty,
    'not-a-number': copy.notANumber,
    comma: copy.comma,
    'too-many-decimals': copy.tooManyDecimals,
    'too-large': copy.tooLarge,
    'not-positive': copy.notPositive,
  };
  return messages[reason];
}



export interface RewardValidationContext {
  /**
   * Places already claimed plus places reserved, from the tier being edited.
   *
   * §5.3 permits raising a quantity freely and lowering it only above what is
   * already taken, and a reservation counts as taken: it is somebody entering
   * their card details. Zero for a tier that does not exist yet.
   */
  committedQuantity?: number;
}

export function validateReward(
  draft: RewardDraft,
  copy: RewardValidationCopy,
  context: RewardValidationContext = {},
): RewardErrors {
  const errors: RewardErrors = {};
  const committed = context.committedQuantity ?? 0;

  const titleLength = characterCount(draft.title.trim());
  if (titleLength === 0) {
    errors.title = copy.titleRequired;
  } else if (titleLength > REWARD_TITLE_MAX_CHARACTERS) {
    errors.title = fillPlaceholders(copy.titleTooLong, {
      max: String(REWARD_TITLE_MAX_CHARACTERS),
      over: String(titleLength - REWARD_TITLE_MAX_CHARACTERS),
    });
  }

  const price = parseAmount(draft.priceAmount);
  if (!price.ok) errors.price = amountMessage(copy.price, price.reason);

  const limit = draft.limitQuantity.trim();
  if (limit !== '') {
    if (!WHOLE_NUMBER.test(limit)) {
      errors.limitQuantity = copy.limitNotWhole;
    } else {
      const places = Number.parseInt(limit, 10);
      if (places < 1) {
        errors.limitQuantity = copy.limitBelowOne;
      } else if (places < committed) {
        errors.limitQuantity = pluralise(copy.locale, copy.limitBelowCommitted, committed);
      }
    }
  }

  if (draft.isSecret && draft.isFeatured) {
    // Featured means shown first; secret means not shown at all. A tier
    // claiming both leaves the campaign page to guess, and the service refuses
    // it on this field.
    errors.isFeatured = copy.secretAndFeatured;
  }

  if (draft.isEarlyBird && draft.availableUntil.trim() === '' && limit === '') {
    // An early bird is early because it runs out. Without a closing date or a
    // cap it is an ordinary tier with a label that hurries a backer for nothing.
    errors.isEarlyBird = copy.earlyBirdNeedsLimit;
  }

  const from = draft.availableFrom.trim() === '' ? null : fromDateTimeLocal(draft.availableFrom);
  const until = draft.availableUntil.trim() === '' ? null : fromDateTimeLocal(draft.availableUntil);
  if (draft.availableFrom.trim() !== '' && from === null) {
    errors.availableFrom = copy.dateInvalid;
  }
  if (draft.availableUntil.trim() !== '' && until === null) {
    errors.availableUntil = copy.dateInvalid;
  }
  if (from !== null && until !== null && new Date(until).getTime() <= new Date(from).getTime()) {
    errors.availableUntil = copy.closesBeforeOpens;
  }

  const seenItems = new Set<string>();
  for (const line of draft.items) {
    if (seenItems.has(line.itemId)) {
      // Two lines for one item would have to be summed to be read, and one of
      // the two would eventually be edited alone.
      errors.items = copy.itemsDuplicate;
      break;
    }
    seenItems.add(line.itemId);

    const quantity = line.quantity.trim();
    if (!WHOLE_NUMBER.test(quantity) || Number.parseInt(quantity, 10) < 1) {
      errors.items = copy.itemsQuantity;
      break;
    }
  }

  const rulesProblem = validateShippingRates(draft, copy);
  if (rulesProblem !== null) errors.rules = rulesProblem;

  return errors;
}

/**
 * The rate table's own problems, as one message.
 *
 * One message rather than one per row because the table is written and refused
 * as a whole — `PUT /v1/rewards/{id}/shipping-rules` replaces all of it, and
 * `RewardService` reports the first row it cannot accept. Naming the
 * destination in the message is what makes a single message enough to act on.
 */
function validateShippingRates(draft: RewardDraft, copy: RewardValidationCopy): string | null {
  if (draft.shippingRules.length === 0) return null;

  if (!isShippedScope(draft.shippingType)) {
    return copy.rates.notShipped;
  }

  const seen = new Set<string>();
  for (const rule of draft.shippingRules) {
    const code = rule.countryCode.trim().toUpperCase();
    if (!COUNTRY_CODE.test(code)) {
      return copy.rates.badCountryCode;
    }
    if (seen.has(code)) {
      return fillPlaceholders(copy.rates.duplicateDestination, { code });
    }
    seen.add(code);

    const amount = parseAmount(rule.amount, { allowZero: true });
    if (!amount.ok) {
      return fillPlaceholders(copy.rates.prefixed, {
        code,
        message: amountMessage(copy.rate, amount.reason),
      });
    }

    const additional = parseAmount(rule.additionalItemAmount.trim() === '' ? '0' : rule.additionalItemAmount, {
      allowZero: true,
    });
    if (!additional.ok) {
      return fillPlaceholders(copy.rates.prefixed, {
        code,
        message: amountMessage(copy.rate, additional.reason),
      });
    }
  }

  return null;
}

function limitOf(draft: RewardDraft): number | null {
  const limit = draft.limitQuantity.trim();
  if (limit === '' || !WHOLE_NUMBER.test(limit)) return null;
  return Number.parseInt(limit, 10);
}

function linesOf(draft: RewardDraft): RewardItemLine[] {
  return draft.items
    .filter((line) => WHOLE_NUMBER.test(line.quantity.trim()))
    .map((line) => ({ itemId: line.itemId, quantity: Number.parseInt(line.quantity.trim(), 10) }));
}

/**
 * The body that creates the tier. Call it only with a draft `validateReward`
 * accepted — an unparseable price would otherwise become a price of zero,
 * which the service refuses and nobody meant.
 *
 * The rates are NOT here. They are a second request, because the endpoint that
 * replaces them needs the identifier the creation is about to produce.
 */
export function newRewardFrom(draft: RewardDraft): NewReward {
  const price = parseAmount(draft.priceAmount);

  return {
    title: draft.title.trim(),
    description: blankAsNull(draft.description),
    // `toMoney` formats through `Decimal.toFixed`, so what the service receives
    // is what the creator typed at the scale the column holds. It has never
    // been a JavaScript number.
    price: price.ok
      ? toMoney(price.value, draft.currency)
      : { amount: draft.priceAmount.trim(), currency: draft.currency },
    estimatedDelivery: blankAsNull(draft.estimatedDelivery),
    limitQuantity: limitOf(draft),
    shippingType: draft.shippingType,
    isEarlyBird: draft.isEarlyBird,
    isFeatured: draft.isFeatured,
    isSecret: draft.isSecret,
    isAddon: draft.isAddon,
    availableFrom: fromDateTimeLocal(draft.availableFrom),
    availableUntil: fromDateTimeLocal(draft.availableUntil),
    items: linesOf(draft),
  };
}

/**
 * The fields that actually changed, and no others.
 *
 * THE SAME RULE AS EVERYWHERE ELSE IN THIS EDITOR, and it matters more here
 * than on an item. `price` is immutable after launch (§5.3) and #36 will refuse
 * it; a body that repeated the unchanged price on every save would turn every
 * edit of a live campaign's description into a 409 about a field the creator
 * never touched.
 *
 * `items` is compared as a set of item-and-quantity pairs rather than as a
 * list, because the composition has no order — the service stores lines, not a
 * sequence — and re-sending an unchanged composition would rewrite rows for
 * nothing.
 *
 * The availability window is compared in the control's own local-time form
 * rather than as instants. `toDateTimeLocal` drops seconds, so an instant that
 * carried them would never compare equal to itself and the field would look
 * permanently changed.
 */
export function rewardPatchFrom(draft: RewardDraft, original: Reward): RewardPatch {
  const patch: RewardPatch = {};

  const title = draft.title.trim();
  if (title !== original.title) patch.title = title;

  const description = blankAsNull(draft.description);
  if (description !== (original.description ?? null)) patch.description = description;

  const price = parseAmount(draft.priceAmount);
  if (price.ok) {
    const amount = toWireAmount(price.value);
    if (amount !== original.price.amount || draft.currency !== original.price.currency) {
      patch.price = toMoney(price.value, draft.currency);
    }
  }

  const delivery = blankAsNull(draft.estimatedDelivery);
  if (delivery !== (original.estimatedDelivery ?? null)) patch.estimatedDelivery = delivery;

  const limit = limitOf(draft);
  if (limit !== (original.limitQuantity ?? null)) patch.limitQuantity = limit;

  if (draft.shippingType !== original.shippingType) patch.shippingType = draft.shippingType;
  if (draft.isEarlyBird !== original.isEarlyBird) patch.isEarlyBird = draft.isEarlyBird;
  if (draft.isFeatured !== original.isFeatured) patch.isFeatured = draft.isFeatured;
  if (draft.isAddon !== original.isAddon) patch.isAddon = draft.isAddon;

  /*
   * `isSecret` is only sent when it flips. Sending `true` on a tier that is
   * already secret is a no-op server-side today, and relying on that is how a
   * later change to token rotation would silently invalidate a private link the
   * creator had already sent out.
   */
  if (draft.isSecret !== original.isSecret) patch.isSecret = draft.isSecret;

  if (draft.availableFrom !== toDateTimeLocal(original.availableFrom)) {
    patch.availableFrom = fromDateTimeLocal(draft.availableFrom);
  }
  if (draft.availableUntil !== toDateTimeLocal(original.availableUntil)) {
    patch.availableUntil = fromDateTimeLocal(draft.availableUntil);
  }

  const lines = linesOf(draft);
  if (compositionChanged(lines, original.items)) patch.items = lines;

  return patch;
}

function compositionChanged(
  lines: readonly RewardItemLine[],
  original: readonly RewardItemLine[],
): boolean {
  if (lines.length !== original.length) return true;

  const before = new Map(original.map((line) => [line.itemId, line.quantity]));
  return lines.some((line) => before.get(line.itemId) !== line.quantity);
}

/**
 * The rate table as the wire carries it: uppercase destinations, both amounts
 * at the scale the column holds.
 *
 * An omitted additional-item rate becomes `"0.00"` rather than being left out.
 * The server reads an absent one as free, which is the same thing — but a
 * response always carries `"0.00"`, and sending what will be read back means a
 * creator who saves twice is not told the value changed.
 */
export function shippingRatesFrom(draft: RewardDraft): ShippingRate[] {
  if (!isShippedScope(draft.shippingType)) return [];

  return draft.shippingRules.map((rule) => {
    const amount = parseAmount(rule.amount, { allowZero: true });
    const additional = parseAmount(
      rule.additionalItemAmount.trim() === '' ? '0' : rule.additionalItemAmount,
      { allowZero: true },
    );

    return {
      countryCode: rule.countryCode.trim().toUpperCase(),
      amount: amount.ok ? toWireAmount(amount.value) : rule.amount.trim(),
      additionalItemAmount: additional.ok ? toWireAmount(additional.value) : '0.00',
    };
  });
}

/**
 * Whether the rate table needs a second request at all.
 *
 * `PUT` on an unchanged table would be a write that rewrites every row of it,
 * and — worse — it is refused outright on a tier that has just stopped being
 * shipped, which would turn "I changed the delivery method" into a save that
 * reports failure after having already succeeded.
 */
export function shippingRatesChanged(draft: RewardDraft, original: Reward): boolean {
  const next = shippingRatesFrom(draft);
  const before = original.shippingRules;

  if (next.length !== before.length) return true;

  const existing = new Map(before.map((rule) => [rule.countryCode, rule]));
  return next.some((rule) => {
    const stored = existing.get(rule.countryCode);
    return (
      stored === undefined ||
      stored.amount !== rule.amount ||
      stored.additionalItemAmount !== rule.additionalItemAmount
    );
  });
}

/* -------------------------------------------------------------------------
 * Hiding, which is what deleting becomes once somebody has backed a tier
 * ---------------------------------------------------------------------- */

/**
 * Whether the tier has been withdrawn from sale.
 *
 * THE STORAGE IS A DATE; THE IDEA IS A SWITCH. §5.3 forbids deleting a tier
 * with backers and permits hiding it, and the service expresses hidden as
 * `available_until` in the past — no extra column, and the campaign page's
 * existing "is this selectable now" check does the work. That is a good
 * decision in the schema and a terrible sentence to put in front of a creator,
 * so the editor reads the date here and says "hidden" everywhere else.
 */
export function isHiddenReward(reward: Reward, now: Date = new Date()): boolean {
  if (reward.availableUntil == null) return false;

  const closes = new Date(reward.availableUntil).getTime();
  return Number.isFinite(closes) && closes <= now.getTime();
}

/** Whether the tier is waiting for a start date that has not arrived. */
export function isScheduledReward(reward: Reward, now: Date = new Date()): boolean {
  if (reward.availableFrom == null) return false;

  const opens = new Date(reward.availableFrom).getTime();
  return Number.isFinite(opens) && opens > now.getTime();
}

/**
 * The patch that hides a tier.
 *
 * It clears a start date that has not arrived as well as closing the tier,
 * because the service refuses a window that closes before it opens — and a tier
 * being withdrawn now is not a tier that is still scheduled to open next month.
 */
export function hidePatch(reward: Reward, now: Date = new Date()): RewardPatch {
  const patch: RewardPatch = { availableUntil: now.toISOString() };
  if (isScheduledReward(reward, now)) patch.availableFrom = null;
  return patch;
}

/** The patch that puts a hidden tier back on sale. */
export function showPatch(): RewardPatch {
  return { availableUntil: null };
}

/**
 * Why the tier cannot be put back on sale as it stands, or null.
 *
 * Showing it again clears the closing date, and an early-bird tier with no
 * closing date and no cap is exactly what `RewardService.requireConsistent`
 * refuses. Saying so before the request is the difference between a creator
 * fixing one field and a creator reading a 400 about a field they did not
 * touch.
 */
export function showBlockedReason(reward: Reward, copy: RewardsVocabularyCopy): string | null {
  if (reward.isEarlyBird && reward.limitQuantity == null) {
    return copy.showBlockedEarlyBird;
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Order
 * ---------------------------------------------------------------------- */

/**
 * The list with one entry moved, or the same list when the move is off the end.
 *
 * Returning the same list unchanged rather than clamping: the buttons that call
 * this are disabled at the ends, and a clamp would make "move up" on the first
 * tier a request that reorders nothing while telling the creator it moved.
 */
export function movedTo<T>(list: readonly T[], from: number, to: number): readonly T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;

  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list;

  next.splice(to, 0, moved);
  return next;
}

/* -------------------------------------------------------------------------
 * Sentences the list needs
 * ---------------------------------------------------------------------- */

/**
 * How many places are left, in words.
 *
 * A sentence rather than a bar or a colour, because this number is the one a
 * creator checks before changing a limit and the one §5.3 refuses a lowering
 * against. "Unlimited" is a real state and by far the commonest, so it is said
 * rather than shown as an empty count.
 */
export function describeStock(reward: Reward, copy: RewardsVocabularyCopy): string {
  if (reward.limitQuantity == null) return copy.stock.unlimited;

  const taken = reward.claimedQuantity + reward.reservedQuantity;
  const remaining = reward.remainingQuantity ?? reward.limitQuantity - taken;

  return fillPlaceholders(copy.stock.remaining, {
    remaining: String(remaining),
    limit: String(reward.limitQuantity),
  });
}
