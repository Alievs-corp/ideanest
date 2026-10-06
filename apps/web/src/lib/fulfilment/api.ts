import type { BackerFulfilment, Fulfilment, FulfilmentStatus } from '@ideanest/account/fulfilment';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.8's PM-07 to PM-10, from the backer's side — where a reward is, and where it is going.
 *
 * <h2>Two things a backer can be told about a parcel</h2>
 *
 * `GET /v1/me/fulfilments` is the tracking: one row per pledge, carrying a status, a carrier
 * and a tracking number when the creator has recorded one. `GET|PATCH
 * /v1/pledges/{id}/shipping-address` is the address that parcel is going to. They are the
 * same screen's two halves, which is why they are one module.
 *
 * <h2>The address is replaced whole, and the PATCH is not a merge</h2>
 *
 * `ShippingAddressController` is explicit and the shape matters: the body replaces the
 * address entirely, so an omitted `line2` **clears** it. Merging a partial address is how
 * somebody who moved house ends up with the old flat number on the new street. The form
 * therefore sends every field on every save, including the empty ones.
 *
 * <h2>A locked address is not an error to recover from</h2>
 *
 * PM-08 lets a creator freeze every address before printing labels. A locked row still reads
 * — somebody has to be able to see where their parcel is going — and refuses the write. The
 * screen renders it read-only rather than offering a form that will 409.
 */

/* The row's shape is shared with the app (#159), so it lives in `@ideanest/account/fulfilment`. */
export type { BackerFulfilment, Fulfilment, FulfilmentStatus };

/** Every parcel owed to this account — `GET /v1/me/fulfilments`. */
export async function listMyFulfilments(signal?: AbortSignal): Promise<readonly BackerFulfilment[]> {
  const response = await authorizedFetch('/v1/me/fulfilments', { signal });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as { readonly fulfilments?: readonly BackerFulfilment[] };
  return body.fulfilments ?? [];
}

export interface PostalAddress {
  readonly recipient: string;
  readonly line1: string;
  readonly line2: string;
  readonly locality: string;
  readonly region: string;
  readonly postcode: string;
  /** ISO 3166-1 alpha-2, upper case. The service stores it beside the encrypted envelope. */
  readonly countryCode: string;
  readonly phone: string;
}

export interface StoredAddress {
  readonly pledgeId: string;
  readonly address: PostalAddress;
  readonly locked: boolean;
  readonly lockedAt: string | null;
  readonly updatedAt: string | null;
}

/** An address with every field present and empty — what a form starts from. */
export const EMPTY_ADDRESS: PostalAddress = Object.freeze({
  recipient: '',
  line1: '',
  line2: '',
  locality: '',
  region: '',
  postcode: '',
  countryCode: '',
  phone: '',
});

/**
 * The address on one of the caller's own pledges — `GET /v1/pledges/{id}/shipping-address`.
 *
 * **204 means the pledge exists and the address does not**, which the controller calls out as
 * a different fact from "no such pledge" and the one a form needs in order to render itself
 * blank. It is returned as `null` rather than as an empty `StoredAddress`, so a caller cannot
 * mistake "not given yet" for "given, and empty".
 */
export async function readShippingAddress(
  pledgeId: string,
  signal?: AbortSignal,
): Promise<StoredAddress | null> {
  const response = await authorizedFetch(
    `/v1/pledges/${encodeURIComponent(pledgeId)}/shipping-address`,
    { signal },
  );

  if (response.status === 204) return null;
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as StoredAddress;
}

/**
 * Records where this pledge's reward goes — `PATCH /v1/pledges/{id}/shipping-address`.
 *
 * Every field, every time, for the reason at the top of this module. Whitespace is trimmed
 * and the country code upper-cased here rather than in the form, so the one place that talks
 * to the endpoint is the one place that decides what a field means.
 */
export async function saveShippingAddress(
  pledgeId: string,
  address: PostalAddress,
): Promise<StoredAddress> {
  const response = await authorizedFetch(
    `/v1/pledges/${encodeURIComponent(pledgeId)}/shipping-address`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: address.recipient.trim(),
        line1: address.line1.trim(),
        line2: address.line2.trim(),
        locality: address.locality.trim(),
        region: address.region.trim(),
        postcode: address.postcode.trim(),
        countryCode: address.countryCode.trim().toUpperCase(),
        phone: address.phone.trim(),
      }),
    },
  );

  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as StoredAddress;
}
