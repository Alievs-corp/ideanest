import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * Partners, as the super admin manages them — #206, part of #202.
 *
 * <p>A partner is an account with a percentage and, optionally, two console sections opened
 * to them. Everything here is a thin mirror of `/v1/admin/partners`: the service decides what
 * is allowed and says so, and this file has no rule of its own to get out of step with it.
 *
 * <p>The percentage is a decimal **string**, like money, everywhere it travels. It multiplies
 * money, and a client that parsed `33.33` into a binary double and added a column of them would
 * be producing the rounding error the platform's rule against floating-point money exists to
 * keep out.
 */

/**
 * The console sections that can be opened to a partner. Two, and closed on purpose: every other
 * module shows an individual transaction, a person or an unscaled figure, so the service cannot
 * even spell it. Mirrors `PartnerSection` in the service.
 */
export type PartnerSection = 'CURATION' | 'HEALTH';

export const PARTNER_SECTIONS: readonly PartnerSection[] = ['CURATION', 'HEALTH'];

export interface Partner {
  readonly accountId: string;
  /** Such as `"50.00"`. */
  readonly percentage: string;
  readonly sections: readonly PartnerSection[];
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface PartnerRoster {
  readonly partners: readonly Partner[];
  /** The sum of the percentages, such as `"80.00"`. */
  readonly allocated: string;
  /** 100 minus that: the most a new partner could be given, such as `"20.00"`. */
  readonly remaining: string;
}

/** Every partner, and how much of the whole is unallocated. Needs `ADMINISTER_STAFF`. */
export async function readPartners(signal?: AbortSignal): Promise<PartnerRoster> {
  const response = await authorizedFetch('/v1/admin/partners', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PartnerRoster;
}

export interface SavePartnerRequest {
  readonly accountId: string;
  /** A decimal string in (0, 100] with at most two places. The service names what is wrong with it. */
  readonly percentage: string;
  /** Exactly the sections to open. Sections not listed are closed. */
  readonly sections: readonly PartnerSection[];
  readonly signal?: AbortSignal;
}

/**
 * Makes an account a partner, or changes their percentage and sections.
 *
 * `PUT`: the stored state becomes exactly what is sent, so sending it twice is not an error.
 */
export async function savePartner(request: SavePartnerRequest): Promise<Partner> {
  const response = await authorizedFetch(`/v1/admin/partners/${encodeURIComponent(request.accountId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ percentage: request.percentage, sections: request.sections }),
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Partner;
}

/** Ends a partnership: the profile, its sections and the role. */
export async function removePartner(accountId: string, signal?: AbortSignal): Promise<void> {
  const response = await authorizedFetch(`/v1/admin/partners/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
}
