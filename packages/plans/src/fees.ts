/**
 * §22.3's fee disclosure as both clients read it — issue #439, shared for the app in #164.
 *
 * <h2>`configured: false` is an answer, and it is not zeros</h2>
 *
 * Zeros are a commitment to charge nothing; an empty table is the platform not having decided. The
 * service sends nulls rather than zeros for exactly that reason, and this narrowing carries the
 * distinction through rather than flattening it.
 *
 * <h2>The rates are strings all the way to the screen</h2>
 *
 * A rate is *multiplied* by money, and a JSON number is an IEEE 754 double, so `0.05` would arrive
 * as `0.05000000000000000277…`. Nothing here parses them; each client formats them through
 * `decimal.js`.
 *
 * <h2>A failed read is not "nothing configured" (#145)</h2>
 *
 * {@link disclosureStateOf} keeps three answers apart: the service said no schedule is set, the
 * service gave rates, or the page has nothing it can state a rate from. Only the first may say
 * "nothing is being deducted".
 */

export interface FeeDisclosure {
  /** Whether the platform has committed to any terms at all. `false` is a real answer. */
  readonly configured: boolean;
  /** §5.2's fee as a fraction — `"0.05000"` is five percent. Null when nothing is configured. */
  readonly platformRate: string | null;
  /** The payment provider's, kept separate from the platform's. */
  readonly processingRate: string | null;
  readonly processingFixed: string | null;
  /**
   * What a creator keeps of every manat pledged, before the fixed amount. Computed by the service,
   * because it is the number a creator checks their payout against and three clients deriving it
   * would round it three ways.
   */
  readonly creatorReceivesRate: string | null;
  readonly currency: string | null;
  readonly effectiveFrom: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The disclosure, or `null` for a body that does not say whether anything is configured. */
export function readFeeDisclosure(body: unknown): FeeDisclosure | null {
  if (!isObject(body)) return null;
  if (typeof body.configured !== 'boolean') return null;

  return {
    configured: body.configured,
    platformRate: optionalString(body.platformRate),
    processingRate: optionalString(body.processingRate),
    processingFixed: optionalString(body.processingFixed),
    creatorReceivesRate: optionalString(body.creatorReceivesRate),
    currency: optionalString(body.currency),
    effectiveFrom: optionalString(body.effectiveFrom),
  };
}

export type FeeAudience = 'backer' | 'creator';

/**
 * What a disclosure lets a page say to an audience.
 *
 * <ul>
 *   <li>`unconfigured` — the service answered `configured: false`. The only case in which "nothing
 *       is being deducted" is true.</li>
 *   <li>`unavailable` — the read failed (`null`), or the body claims a schedule without the rates
 *       this audience is told. No figure, and no claim about what is charged.</li>
 *   <li>`configured` — the rates, which the page states.</li>
 * </ul>
 *
 * A backer is told the platform and processing rates; a creator is also told what they keep, so a
 * creator's disclosure without `creatorReceivesRate` is one the page cannot read.
 */
export function disclosureStateOf(
  disclosure: FeeDisclosure | null,
  audience: FeeAudience,
): 'unconfigured' | 'unavailable' | 'configured' {
  if (disclosure !== null && !disclosure.configured) return 'unconfigured';
  if (disclosure === null || disclosure.platformRate === null || disclosure.processingRate === null) {
    return 'unavailable';
  }
  if (audience === 'creator' && disclosure.creatorReceivesRate === null) return 'unavailable';
  return 'configured';
}
