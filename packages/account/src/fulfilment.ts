/**
 * §4.8's PM-07 to PM-10 from the backer's side — where a reward is — shared by `apps/web` and
 * `apps/mobile` (#159). Moved here from the web's `lib/fulfilment/describe.ts` (and the row's
 * types from `lib/fulfilment/api.ts`); the endpoints stay with each client's own fetch.
 *
 * <h2>The status names are the creator's, not the backer's</h2>
 *
 * `PREPARING`, `SHIPPED`, `DELIVERED`, `RETURNED` are written from the side that packs the
 * parcel. A backer reading "Preparing" learns nothing about whether anything is wrong, so each
 * one is paired with a sentence that says what it means for them. `RETURNED` is the only status
 * that asks the reader to act.
 */

export type FulfilmentStatus = 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'RETURNED';

export interface Fulfilment {
  readonly pledgeId: string;
  /** Widened so an unknown status from a newer service renders as itself rather than throwing. */
  readonly status: FulfilmentStatus | string;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly trackingUrl: string | null;
  /** ISO-8601 instants, UTC. */
  readonly shippedAt: string | null;
  readonly deliveredAt: string | null;
  readonly updatedAt: string | null;
}

/** One parcel and the campaign it belongs to. The campaign fields are null for a deleted one. */
export interface BackerFulfilment {
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly projectSlug: string | null;
  readonly creatorSlug: string | null;
  readonly fulfilment: Fulfilment;
}

export interface StatusDescription {
  /** The word on the tag. */
  readonly label: string;
  /** What it means for the person waiting. */
  readonly detail: string;
  /**
   * `Tag`'s variant. Never the only carrier — docs/ui-kit.md §9.2 — which is why `label` exists
   * and is beside it.
   */
  readonly tone: 'default' | 'success' | 'warning' | 'danger';
}

/** The two tables `describeStatus` reads: `account.fulfilment.status` and `.statusDetail`. */
export interface StatusCopy {
  readonly status: Readonly<Record<string, string>>;
  readonly statusDetail: Readonly<Record<string, string>>;
}

/**
 * The tone each status is shown in. The tone is a design decision rather than copy: §8.1 reads
 * `--danger` as a state that needs attention, and a parcel that came back is the only one of the
 * four that does.
 */
const TONES: Readonly<Record<FulfilmentStatus, StatusDescription['tone']>> = {
  PREPARING: 'default',
  SHIPPED: 'warning',
  DELIVERED: 'success',
  RETURNED: 'danger',
};

/**
 * The description for a status, or a readable fallback for one this build does not know.
 *
 * A newer service could add a fifth. Showing the raw value is honest — it is at least what the
 * service said — where a blank tag would tell a backer nothing and a guessed one would tell them
 * something wrong about where their parcel is.
 */
export function describeStatus(status: FulfilmentStatus | string, copy: StatusCopy): StatusDescription {
  const tone = TONES[status as FulfilmentStatus];
  const label = copy.status[status];

  if (tone !== undefined && label !== undefined) {
    return { label, detail: copy.statusDetail[status] ?? copy.statusDetail['unknown'] ?? '', tone };
  }

  return { label: status, detail: copy.statusDetail['unknown'] ?? '', tone: 'default' };
}

/**
 * Whether a tracking link may be followed.
 *
 * **The creator types this URL**, so it is untrusted input. Only `http` and `https` are allowed:
 * a `javascript:` URL is script execution, and `data:` is a document of the creator's choosing
 * rendered as though it were ours. Anything else is shown as text rather than being made
 * followable.
 *
 * The scheme is lower-cased before it is compared because React Native's `URL` does not
 * normalise it the way a browser's does, and the value is trimmed because React Native's `URL`
 * does not strip the spaces a browser's parser does — so both platforms answer the same.
 */
export function isFollowableTrackingUrl(url: string | null): boolean {
  if (url === null || url.trim() === '') return false;

  try {
    const protocol = new URL(url.trim()).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
