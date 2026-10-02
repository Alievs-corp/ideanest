import { api, sendJson } from '../../../api/client';

/**
 * The creator's payout details (#161), the web's `lib/account/payout.ts`: who is paid
 * (`/v1/me/legal-subject`) and the card the money goes to (`/v1/me/payout-destination`).
 *
 * <p>The types are declared here rather than read from `@ideanest/api-client`: both endpoints
 * answer a record the service calls `Mine`, so the generated schema has one `Mine` (the
 * destination's) for both, and the legal subject's read would be typed as a card. Null fields may
 * be absent — the service serialises `non_null`.
 */

export type SubjectKind = 'INDIVIDUAL' | 'LEGAL_ENTITY';

export interface LegalSubject {
  readonly recorded: boolean;
  readonly subjectKind?: SubjectKind | null;
  readonly legalName?: string | null;
  readonly taxId?: string | null;
  readonly registeredAddress?: string | null;
  readonly registrationNumber?: string | null;
  readonly complete?: boolean;
  readonly updatedAt?: string | null;
}

export interface LegalSubjectRequest {
  readonly subjectKind: SubjectKind;
  readonly legalName: string;
  readonly taxId: string | null;
  readonly registeredAddress: string | null;
  readonly registrationNumber: string | null;
}

export type DestinationStanding =
  | 'NONE'
  | 'AWAITING_VERIFICATION'
  | 'VERIFIED'
  | 'WAIVED'
  | 'NAME_MISMATCH'
  | 'REJECTED';

export interface PayoutDestination {
  readonly recorded?: boolean;
  readonly standing?: DestinationStanding;
  readonly provider?: string | null;
  readonly holderName?: string | null;
  readonly displayHint?: string | null;
  readonly updatedAt?: string | null;
}

export interface CardRegistrationRequest {
  readonly language: string;
  readonly successUrl: string;
  readonly errorUrl: string;
}

export interface CardRegistrationPage {
  readonly provider?: string;
  readonly redirectUrl?: string;
}

export async function readLegalSubject(signal?: AbortSignal): Promise<LegalSubject> {
  return (await api().get('/v1/me/legal-subject', { signal })) as unknown as LegalSubject;
}

export async function saveLegalSubject(body: LegalSubjectRequest): Promise<LegalSubject> {
  return (await sendJson('PUT', '/v1/me/legal-subject', body)) as LegalSubject;
}

export async function readPayoutDestination(signal?: AbortSignal): Promise<PayoutDestination> {
  return (await api().get('/v1/me/payout-destination', { signal })) as PayoutDestination;
}

export async function beginCardRegistration(body: CardRegistrationRequest): Promise<CardRegistrationPage> {
  return (await sendJson('POST', '/v1/me/payout-destination/card-registration', body)) as CardRegistrationPage;
}
