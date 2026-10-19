import Decimal from 'decimal.js';

/**
 * What a reward card says besides its price, title and stock — #255, on both clients.
 *
 * <h2>When it arrives and where it can be sent</h2>
 *
 * A backer chooses a reward by when it arrives and whether it can reach them, and before #255
 * both were in the public reward response and on neither campaign page: they appeared for the
 * first time at checkout, one step after the choice they decide. The card now says both: the
 * estimated delivery month, and one line about shipping. The items and the add-ons stay in the
 * checkout, which has the room to list them, so the card stays short.
 *
 * <h2>One reader, two clients</h2>
 *
 * The web reads the generated response on the server and the app reads it through its typed
 * client, so the narrowing is here and the words and the date formatting stay with each client
 * — the app's Azerbaijani dates go through the Hermes bypass the web does not need.
 */

/**
 * The shipping line, decided from `shippingType` and `shippingRates`.
 *
 * `ships` counts the distinct destinations the creator has priced, because those are the
 * places checkout will accept: §4.5 refuses a destination with no rate, so "ships to 12
 * countries" is exactly what a backer can choose from. `lowestRate` is the cheapest first-unit
 * rate as a decimal string in the tier's currency — the price of the reward is the card's, and
 * this is what is added to it — or `null` when there is none to quote.
 *
 * `unpriced` is a shipped tier with no rate at all: there is nowhere it can be sent yet, and
 * the card says nothing rather than "ships to 0 countries".
 */
export type RewardShipping =
  | { readonly kind: 'none' }
  | { readonly kind: 'digital' }
  | { readonly kind: 'pickup' }
  | { readonly kind: 'ships'; readonly countries: number; readonly lowestRate: string | null }
  | { readonly kind: 'unpriced' };

export interface RewardDetails {
  /** `YYYY-MM-DD` as the service stores it, or `null` when the creator gave none. */
  readonly estimatedDelivery: string | null;
  readonly shipping: RewardShipping;
  /**
   * The checkout's two tags, shown on the card too. Early bird is unambiguous because the
   * editor refuses one with neither a closing date nor a limit, and a tier outside its window
   * is not in the response at all; featured is the creator's pick, "shown first".
   */
  readonly earlyBird: boolean;
  readonly featured: boolean;
}

/**
 * `{ month: 'long', year: 'numeric' }`, in UTC.
 *
 * A month, because a month is what a creator can honestly promise — the reward editor's own
 * reasoning. UTC because the service stores a plain date, and formatting it in the reader's
 * zone would move a first-of-the-month delivery into the month before it.
 */
export const DELIVERY_MONTH_OPTIONS: Intl.DateTimeFormatOptions = Object.freeze({
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The card's details from one entry of the public reward list. Never throws. */
export function readRewardDetails(reward: unknown): RewardDetails {
  const source = reward !== null && typeof reward === 'object' ? (reward as Record<string, unknown>) : {};
  return {
    estimatedDelivery: deliveryDate(source['estimatedDelivery']),
    shipping: readShipping(source['shippingType'], source['shippingRates']),
    earlyBird: source['isEarlyBird'] === true,
    featured: source['isFeatured'] === true,
  };
}

function readShipping(type: unknown, rates: unknown): RewardShipping {
  switch (type) {
    case 'NONE':
      return { kind: 'none' };
    case 'DIGITAL':
      return { kind: 'digital' };
    case 'LOCAL_PICKUP':
      return { kind: 'pickup' };
    case 'DOMESTIC':
    case 'INTERNATIONAL':
      return shipped(rates);
    default:
      // A type this build has never heard of says nothing rather than something wrong.
      return { kind: 'unpriced' };
  }
}

function shipped(rates: unknown): RewardShipping {
  const countries = new Set<string>();
  let lowest: Decimal | null = null;

  for (const rate of Array.isArray(rates) ? (rates as readonly unknown[]) : []) {
    if (rate === null || typeof rate !== 'object') continue;
    const row = rate as Record<string, unknown>;
    const country = typeof row['countryCode'] === 'string' ? row['countryCode'].trim().toUpperCase() : '';
    if (country === '') continue;
    countries.add(country);

    const amount = decimal(row['amount']);
    if (amount !== null && (lowest === null || amount.lessThan(lowest))) lowest = amount;
  }

  if (countries.size === 0) return { kind: 'unpriced' };
  return { kind: 'ships', countries: countries.size, lowestRate: lowest === null ? null : lowest.toFixed() };
}

/** Money is a string on the wire; a number, a negative or a malformed one quotes nothing. */
function decimal(value: unknown): Decimal | null {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/u.test(value.trim())) return null;
  return new Decimal(value.trim());
}

/** A plain date the formatter can read, or `null`. */
function deliveryDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) && Number.isFinite(Date.parse(trimmed)) ? trimmed : null;
}

/* -------------------------------------------------------------------------
 * The card's picture and clip
 * ---------------------------------------------------------------------- */

/** A reward's picture on its public card — `PublicRewardResponse.image`. */
export interface RewardCardImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly blurDataUrl: string | null;
}

/**
 * A reward's clip — `PublicRewardResponse.video`: at most five seconds, played muted and looping
 * as a preview, over `posterUrl` until it plays.
 */
export interface RewardCardVideo {
  readonly url: string;
  readonly posterUrl: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly blurDataUrl: string | null;
}

export interface RewardMedia {
  readonly image: RewardCardImage | null;
  readonly video: RewardCardVideo | null;
}

/**
 * The picture and the clip from one entry of the public reward list. Never throws.
 *
 * Either is `null` when it is absent or incomplete: a frame reserves its box from the width
 * and height, so a picture without them is drawn as none rather than as a box of no size.
 */
export function readRewardMedia(reward: unknown): RewardMedia {
  const source = isObject(reward) ? reward : {};
  return { image: readImage(source['image']), video: readVideo(source['video']) };
}

function readImage(raw: unknown): RewardCardImage | null {
  if (!isObject(raw)) return null;
  const url = webUrl(raw['url']);
  const width = dimension(raw['width']);
  const height = dimension(raw['height']);
  if (url === null || width === null || height === null) return null;
  return { url, width, height, blurDataUrl: blur(raw['blurDataUrl']) };
}

function readVideo(raw: unknown): RewardCardVideo | null {
  if (!isObject(raw)) return null;
  const url = webUrl(raw['url']);
  const posterUrl = webUrl(raw['posterUrl']);
  const width = dimension(raw['width']);
  const height = dimension(raw['height']);
  const durationMs = raw['durationMs'];
  if (url === null || posterUrl === null || width === null || height === null) return null;
  return {
    url,
    posterUrl,
    width,
    height,
    durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    blurDataUrl: blur(raw['blurDataUrl']),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function webUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^https?:\/\//iu.test(trimmed) ? trimmed : null;
}

function dimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function blur(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('data:') ? value : null;
}
