import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import { localeOrDefault, type Locale } from '../i18n/locale';

/**
 * The creator's payout details — IDN-EXT-01 (#44): who is paid, and the card the money goes to.
 *
 * Three existing endpoints and one new one. `/v1/me/legal-subject` holds the legal name and the
 * VÖEN (#430); `/v1/me/payout-destination` reads the card on file and its verification standing
 * (#432); `/v1/me/payout-destination/card-registration` opens the payment provider's page where the
 * business card is entered. A card is never typed into IdeaNest.
 *
 * Null fields may be absent rather than null — the service serialises `non_null` — so every optional
 * field is `?: T | null`, the convention `lib/pledges/api.ts` states.
 */

export type SubjectKind = 'INDIVIDUAL' | 'LEGAL_ENTITY';

export interface LegalSubject {
  recorded: boolean;
  subjectKind?: SubjectKind | null;
  legalName?: string | null;
  taxId?: string | null;
  registeredAddress?: string | null;
  registrationNumber?: string | null;
  complete: boolean;
  updatedAt?: string | null;
}

export interface LegalSubjectRequest {
  subjectKind: SubjectKind;
  legalName: string;
  taxId?: string | null;
  registeredAddress?: string | null;
  registrationNumber?: string | null;
}

export type DestinationStanding =
  | 'NONE'
  | 'AWAITING_VERIFICATION'
  | 'VERIFIED'
  | 'WAIVED'
  | 'NAME_MISMATCH'
  | 'REJECTED';

export interface PayoutDestination {
  recorded: boolean;
  standing: DestinationStanding;
  provider?: string | null;
  holderName?: string | null;
  displayHint?: string | null;
  updatedAt?: string | null;
}

export interface CardRegistrationRequest {
  language: string;
  successUrl: string;
  errorUrl: string;
}

export interface CardRegistrationPage {
  provider: string;
  redirectUrl: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

export async function getMyLegalSubject(signal?: AbortSignal): Promise<LegalSubject> {
  return read(await authorizedFetch('/v1/me/legal-subject', { cache: 'no-store', signal }));
}

export async function saveMyLegalSubject(body: LegalSubjectRequest, signal?: AbortSignal): Promise<LegalSubject> {
  return read(
    await authorizedFetch('/v1/me/legal-subject', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      signal,
    }),
  );
}

export async function getMyPayoutDestination(signal?: AbortSignal): Promise<PayoutDestination> {
  return read(await authorizedFetch('/v1/me/payout-destination', { cache: 'no-store', signal }));
}

export async function beginPayoutCardRegistration(
  body: CardRegistrationRequest,
  signal?: AbortSignal,
): Promise<CardRegistrationPage> {
  return read(
    await authorizedFetch('/v1/me/payout-destination/card-registration', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      signal,
    }),
  );
}

/**
 * Where the provider returns the creator: this page, in its language, with `?card=` saying which
 * door. The word is a hint — the provider's callback is what files the card — so the page re-reads
 * the destination rather than believing it. `localePrefix` is `always`, so the first path segment is
 * the locale.
 */
export function cardReturnFor(
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
): { readonly language: Locale; readonly successUrl: string; readonly errorUrl: string } {
  const language = localeOrDefault(location.pathname.split('/')[1]);
  const page = `${location.origin}/${language}/settings/payout`;
  return { language, successUrl: `${page}?card=returned`, errorUrl: `${page}?card=failed` };
}

export type CardReturnHint = 'returned' | 'failed';

export function cardReturnHint(search: string): CardReturnHint | null {
  const value = new URLSearchParams(search).get('card');
  return value === 'returned' || value === 'failed' ? value : null;
}
