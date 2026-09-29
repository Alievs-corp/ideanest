import type { EnvSource } from '../seo/metadata';
import { apiOrigin } from '../seo/metadata-source';
import { PLANS } from '../cache/tags';

/**
 * §22.3's sixth product requirement, read — issue #439.
 *
 * <h2>Why this is derived and not written down</h2>
 *
 * The platform's fee copy used to be a sentence saying that every payment is priced at zero
 * commission. That was *true*, because no schedule is seeded — and it would have become **false
 * the day one was**, silently, because nothing checks a message catalogue against a table.
 *
 * A number a creator can check against the payout they get is a disclosure. A sentence about the
 * platform's intentions is not. So this reads `GET /v1/fees/disclosure`, which resolves the
 * schedule in force, and `FeeDisclosureApiTests` asserts that the answer changes when the
 * schedule does.
 *
 * <h2>`configured: false` is an answer, and it is not zeros</h2>
 *
 * The two are different statements: zeros are a commitment to charge nothing, and an empty
 * table is the platform not having decided. The service is careful to send nulls rather than
 * zeros for exactly that reason, and this module carries the distinction through rather than
 * flattening it — a page that printed "0% platform fee" on the strength of an empty table would
 * be making a promise nobody authorised.
 *
 * <h2>The rates are strings all the way to the screen</h2>
 *
 * CLAUDE.md: money crosses the API as a string, never a number. A rate is worse than money in
 * one respect — it is *multiplied* by money — and a JSON number is an IEEE 754 double in every
 * mainstream parser, so `0.05` would arrive as `0.05000000000000000277…`. Nothing here parses
 * them; formatting is the component's job and does it through `decimal.js`.
 *
 * <h2>Filed under {@link PLANS}</h2>
 *
 * The same tag the subscription catalogue uses, and for the same reason: both are things the
 * platform charges, both change a handful of times a year, and both are written from one
 * console screen. A tag of its own would be one more thing the service has to remember to send
 * when a rate moves.
 */

export interface FeeDisclosure {
  /** Whether the platform has committed to any terms at all. `false` is a real answer. */
  readonly configured: boolean;
  /** §5.2's fee as a fraction — `"0.05000"` is five percent. Null when nothing is configured. */
  readonly platformRate: string | null;
  /** The payment provider's, kept separate from the platform's. See the component. */
  readonly processingRate: string | null;
  readonly processingFixed: string | null;
  /**
   * What a creator keeps of every manat pledged, before the fixed amount.
   *
   * Computed by the service rather than here, because it is the number a creator checks their
   * payout against and three clients deriving it would round it three ways.
   */
  readonly creatorReceivesRate: string | null;
  readonly currency: string | null;
  readonly effectiveFrom: string | null;
}

export interface FeeReadOptions {
  readonly fetchImpl?: typeof fetch;
  readonly env?: EnvSource;
  readonly signal?: AbortSignal;
}

const FEE_REVALIDATE_SECONDS = 3600;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

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

/**
 * The terms in force, platform-wide or for one campaign.
 *
 * <strong>Most-specific-wins when a campaign is named</strong>, exactly as a collection
 * resolves. Quoting the platform rate to somebody backing a campaign on different terms would be
 * the disclosure §22.3 exists to prevent.
 *
 * `null` is a failed read — a refusal, a 5xx, a timeout, a network failure or a body that does
 * not narrow. The component gives it its own sentence (#145): never zeros, and never the
 * unconfigured sentence, which says nothing is being deducted and is true only when the service
 * answered `configured: false`.
 */
export async function fetchFeeDisclosure(
  projectId?: string,
  options: FeeReadOptions = {},
): Promise<FeeDisclosure | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const path =
    projectId === undefined
      ? '/v1/fees/disclosure'
      : `/v1/projects/${encodeURIComponent(projectId)}/fee-disclosure`;

  try {
    const response = await fetchImpl(`${apiOrigin(options.env)}${path}`, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
      next: { revalidate: FEE_REVALIDATE_SECONDS, tags: [PLANS] },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    if (!response.ok) return null;
    return readFeeDisclosure((await response.json()) as unknown);
  } catch {
    return null;
  }
}
