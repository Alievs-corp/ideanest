import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.11's role model in the browser — issue #295.
 *
 * <h2>What this replaces</h2>
 *
 * Until #295 the console had one question it could ask about the reader — none — and one
 * answer it could render: whatever the last endpoint refused with. Every screen was drawn,
 * every screen made a request, and a moderator who had no business with the ledger found
 * that out by opening it and reading a 403.
 *
 * `GET /v1/admin/me` is the endpoint that ends that. It is the only route under
 * `/v1/admin` that refuses nobody: a signed-in visitor who opens `/admin` out of curiosity
 * gets `staff: false` and a page that says so, where a 403 would leave the console unable
 * to tell "you do not work here" from "the service is down".
 *
 * <h2>The route is still not a gate</h2>
 *
 * <strong>Nothing here decides whether a page may be reached.</strong> The service refuses
 * every read behind every screen, and that check is the one that matters; this decides
 * what the console *offers*, which is a different question with a much lower cost of being
 * wrong.
 *
 * That is not a shortcut. `lib/api/access-token.ts` keeps the access token in a module
 * variable and the refresh token in a `SameSite=Strict` `HttpOnly` cookie that rotates on
 * every use — so a Server Component could only authenticate by spending that cookie, which
 * would invalidate the token the browser is holding and end the session it was checking. A
 * layout gate would therefore be a second, weaker copy of a check the service already makes
 * correctly, and the dangerous direction is the one where the browser says yes.
 * `AdminArea` has carried that argument since #294 and #295 does not reverse it.
 */

/**
 * What a member of staff may do, as the service names them.
 *
 * The same nineteen as `shared.access.StaffCapability`, in the service's own order, and
 * deliberately a union of string literals rather than an enum: they are compared against
 * strings that arrive over the wire, and `@ideanest/api-client` generates exactly this shape
 * from `openapi.json`.
 *
 * <p><strong>It said twelve until the rail started reading it.</strong> The service had grown
 * seven more — the legal documents, the two acceptance reads, identity review, the document
 * itself, a payout destination, and a compliance waiver — and the catalogue had a sentence for
 * every one of them on `/admin/staff` while this union had eleven of nineteen. Nothing broke,
 * because the only thing anybody did with a capability was print it. A rail that hides an
 * entry the reader cannot open is the thing that would have broken, silently and in the
 * direction where somebody loses a screen that is theirs.
 */
export type StaffCapability =
  | 'MODERATE_CONTENT'
  | 'ADMINISTER_ACCOUNTS'
  | 'CURATE'
  | 'VIEW_FINANCE'
  | 'ISSUE_REFUND'
  | 'MANAGE_DISPUTES'
  | 'APPROVE_PAYOUT'
  | 'HANDLE_SUPPORT'
  | 'CONFIGURE_PLATFORM'
  | 'VIEW_AUDIT'
  | 'VIEW_HEALTH'
  | 'PUBLISH_LEGAL_DOCUMENT'
  | 'READ_ACCEPTANCE_RECORD'
  | 'READ_SIGNED_AGREEMENT'
  | 'REVIEW_IDENTITY_VERIFICATION'
  | 'OPEN_IDENTITY_DOCUMENT'
  | 'VERIFY_PAYOUT_DESTINATION'
  | 'GRANT_COMPLIANCE_OVERRIDE'
  | 'ADMINISTER_STAFF';

/**
 * The five kinds of person who work here.
 *
 * <p>`COMPLIANCE` is the one this type was missing: §22's identity review is its own authority
 * in the service and on `/admin/staff`, and a compliance officer arriving here as a role no
 * type admitted was a reader the console could not describe.
 */
export type StaffRole = 'MODERATOR' | 'CURATOR' | 'FINANCE' | 'COMPLIANCE' | 'ADMINISTRATOR';

/**
 * What the console is told about whoever is reading it.
 *
 * `roles` and `capabilities` both travel because they answer different questions:
 * capabilities decide what is drawn, and roles are what somebody is told when they ask why
 * a screen is missing. Deriving one from the other here would put the service's policy in
 * two places.
 */
export interface StaffMembership {
  accountId: string;
  /** Whether this account works here at all. */
  staff: boolean;
  /**
   * Staff by configuration rather than by a grant.
   *
   * Rendered as a warning on `/admin/staff`: an administrator who exists only in an
   * environment variable is one nobody can withdraw through the platform.
   */
  bootstrapped: boolean;
  roles: StaffRole[];
  capabilities: StaffCapability[];
}

/** One grant, as the staff screen lists it. */
export interface StaffGrant {
  accountId: string;
  role: StaffRole;
  grantedAt: string;
  grantedBy: string;
  note?: string | null;
}

export interface StaffRoster {
  grants: StaffGrant[];
}

/** What the caller may do. The one console read that refuses nobody. */
export async function readMembership(signal?: AbortSignal): Promise<StaffMembership> {
  const response = await authorizedFetch('/v1/admin/me', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as StaffMembership;
}

/** Who holds what. Needs `ADMINISTER_STAFF`. */
export async function readRoster(signal?: AbortSignal): Promise<StaffRoster> {
  const response = await authorizedFetch('/v1/admin/staff', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as StaffRoster;
}

/**
 * Gives an account a role.
 *
 * `PUT`, because holding a role is a state rather than an event — granting one twice leaves
 * the same row, and the service's `ON CONFLICT DO NOTHING` means the second call has done
 * nothing rather than something invisible.
 */
export async function grantRole(
  accountId: string,
  role: StaffRole,
  note: string | null,
  signal?: AbortSignal,
): Promise<StaffMembership> {
  const response = await authorizedFetch(
    `/v1/admin/staff/${encodeURIComponent(accountId)}/roles/${role}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
      signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as StaffMembership;
}

/** Takes a role away. Withdrawing one the account does not hold is not an error. */
export async function revokeRole(
  accountId: string,
  role: StaffRole,
  signal?: AbortSignal,
): Promise<StaffMembership> {
  const response = await authorizedFetch(
    `/v1/admin/staff/${encodeURIComponent(accountId)}/roles/${role}`,
    { method: 'DELETE', signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as StaffMembership;
}

/**
 * The twelve capabilities, as values.
 *
 * <p>What each one is <em>for</em> lives in `admin.screens.staff.capability` since #324. The
 * sentence a person reads on a grant screen is copy, and it was the one table of English prose
 * in a module otherwise made of identifiers the service and the client agree on.
 *
 * <p>This list stays because {@link ROLE_CAPABILITIES} needs it: an administrator holds all
 * twelve, and deriving that from a catalogue would make the role model depend on which words
 * somebody had translated.
 */
export const STAFF_CAPABILITIES: readonly StaffCapability[] = Object.freeze([
  'MODERATE_CONTENT',
  'ADMINISTER_ACCOUNTS',
  'CURATE',
  'VIEW_FINANCE',
  'ISSUE_REFUND',
  'MANAGE_DISPUTES',
  'APPROVE_PAYOUT',
  'HANDLE_SUPPORT',
  'CONFIGURE_PLATFORM',
  'VIEW_AUDIT',
  'VIEW_HEALTH',
  'PUBLISH_LEGAL_DOCUMENT',
  'READ_ACCEPTANCE_RECORD',
  'READ_SIGNED_AGREEMENT',
  'REVIEW_IDENTITY_VERIFICATION',
  'OPEN_IDENTITY_DOCUMENT',
  'VERIFY_PAYOUT_DESTINATION',
  'GRANT_COMPLIANCE_OVERRIDE',
  'ADMINISTER_STAFF',
]);

/** What holding each role confers, mirroring `StaffRole` in the service. */
export const ROLE_CAPABILITIES: Readonly<Record<StaffRole, readonly StaffCapability[]>> =
  Object.freeze({
    MODERATOR: ['MODERATE_CONTENT', 'ADMINISTER_ACCOUNTS', 'HANDLE_SUPPORT', 'VIEW_AUDIT'],
    CURATOR: ['CURATE', 'VIEW_AUDIT'],
    FINANCE: [
      'VIEW_FINANCE',
      'ISSUE_REFUND',
      'MANAGE_DISPUTES',
      'HANDLE_SUPPORT',
      'VIEW_AUDIT',
    ],
    /*
     * §22's own role, and narrow on purpose. It holds neither MODERATE_CONTENT nor
     * VIEW_FINANCE: opening somebody's identity document is not moderation, and confirming
     * that a payout destination belongs to its creator is not a finance decision — the
     * service's `StaffRole` makes both arguments at length and this mirrors them rather
     * than restating them.
     */
    COMPLIANCE: [
      'REVIEW_IDENTITY_VERIFICATION',
      'OPEN_IDENTITY_DOCUMENT',
      'VERIFY_PAYOUT_DESTINATION',
      'READ_ACCEPTANCE_RECORD',
      'READ_SIGNED_AGREEMENT',
      'VIEW_AUDIT',
    ],
    ADMINISTRATOR: STAFF_CAPABILITIES,
  });

/**
 * Whether a membership holds a capability.
 *
 * A function rather than a `Set` on the membership, because the membership arrives as JSON
 * and a client that rebuilt it into a `Set` would have two representations of the same fact
 * to keep in step. Twelve string comparisons is not a cost worth optimising.
 */
export function holds(
  membership: StaffMembership | null,
  capability: StaffCapability,
): boolean {
  return membership?.capabilities.includes(capability) ?? false;
}

/**
 * Whether a membership holds any of several capabilities — issue #295's rail, #4xx.
 *
 * <p>`CONSOLE_LINK_CAPABILITIES` needs it and {@link holds} could not answer it: a couple of
 * console screens are one page over two reads that the service guards separately — the
 * chargeback console is `VIEW_FINANCE` for the queue and `MANAGE_DISPUTES` for the decision —
 * and an entry worth showing to somebody who can work half of it is an entry that has to be
 * shown to somebody who holds either. The alternative is hiding a screen from the person whose
 * job it is.
 */
export function holdsAny(
  membership: StaffMembership | null,
  capabilities: readonly StaffCapability[],
): boolean {
  return capabilities.some((capability) => holds(membership, capability));
}
