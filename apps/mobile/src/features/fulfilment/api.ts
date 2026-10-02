import type { components } from '@ideanest/api-client';
import { api, sendJson } from '../../api/client';

type ShippingAddressResponse = components['schemas']['ShippingAddressResponse'];

export interface PostalAddress {
  readonly recipient: string;
  readonly line1: string;
  readonly line2: string;
  readonly locality: string;
  readonly region: string;
  readonly postcode: string;
  readonly countryCode: string;
  readonly phone: string;
}

export interface StoredAddress {
  readonly address: PostalAddress;
  readonly locked: boolean;
  readonly lockedAt: string | null;
  readonly updatedAt: string | null;
}

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

export async function readShippingAddress(pledgeId: string, signal?: AbortSignal): Promise<StoredAddress | null> {
  const body = (await api().get('/v1/pledges/{pledgeId}/shipping-address', {
    path: { pledgeId },
    ...(signal === undefined ? {} : { signal }),
  })) as ShippingAddressResponse | undefined | null;
  return body === undefined || body === null ? null : storedFrom(body);
}

export async function saveShippingAddress(pledgeId: string, address: PostalAddress): Promise<StoredAddress> {
  const sent = wireAddress(address);
  const body = (await sendJson(
    'PATCH',
    `/v1/pledges/${encodeURIComponent(pledgeId)}/shipping-address`,
    sent,
  )) as ShippingAddressResponse | null;
  return body === null ? { address: sent, locked: false, lockedAt: null, updatedAt: null } : storedFrom(body);
}

export function wireAddress(address: PostalAddress): PostalAddress {
  return {
    recipient: address.recipient.trim(),
    line1: address.line1.trim(),
    line2: address.line2.trim(),
    locality: address.locality.trim(),
    region: address.region.trim(),
    postcode: address.postcode.trim(),
    countryCode: address.countryCode.trim().toUpperCase(),
    phone: address.phone.trim(),
  };
}

function storedFrom(body: ShippingAddressResponse): StoredAddress {
  const address = body.address ?? {};
  return {
    address: {
      recipient: address.recipient ?? '',
      line1: address.line1 ?? '',
      line2: address.line2 ?? '',
      locality: address.locality ?? '',
      region: address.region ?? '',
      postcode: address.postcode ?? '',
      countryCode: address.countryCode ?? '',
      phone: address.phone ?? '',
    },
    locked: body.locked === true,
    lockedAt: body.lockedAt ?? null,
    updatedAt: body.updatedAt ?? null,
  };
}
