import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { ConsoleSubscription } from './plans';
import type { SubscriptionPayment } from './revenue';

/**
 * ONE MODULE, ONE PLACE for everything the account directory asks the service.
 *
 * §4.11's AD-04 (#104). Five endpoints on one resource: the list, one account, what that
 * account has backed (#404), the ban, and the way back from it.
 *
 * Every one of them returns an email address, which almost nothing else on this
 * platform does — the service audits each read for that reason and answers
 * `no-store`. Nothing here caches a response, and nothing here holds one outside
 * the component that asked for it.
 *
 * `POST .../reinstate` is not in docs/architecture.md §10.2's list and exists
 * because a ban with no reversal makes the first mistaken one permanent. A
 * campaign's suspension is terminal because its funding window has moved on; an
 * account has no window.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** What `users.suspension_reason` may hold — the `@Size` the request body carries. */
export const REASON_MAX_CHARACTERS = 2000;

/**
 * One account as staff see it.
 *
 * `suspendedBy` is an account id and not a name: there is no endpoint that turns
 * one into a person, so this screen shows the identifier and says that is what it
 * is — the same choice the moderation queue makes about `moderatorId`.
 */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  slug: string;
  emailVerified: boolean;
  /** ISO-8601 instant, UTC, or null when the address has never been proven. */
  emailVerifiedAt: string | null;
  suspended: boolean;
  suspendedAt: string | null;
  suspendedBy: string | null;
  suspensionReason: string | null;
  /** V5's grace period. Present because an account may be both suspended and leaving. */
  deletionScheduledAt: string | null;
  createdAt: string;
}

/**
 * A page, and where the next one starts.
 *
 * `nextCursor` is keyset rather than an offset: accounts are created underneath
 * the reader, and an offset would drift a moderator past the account they are
 * paging towards. Null means this page is the end.
 */
export interface AdminUserPage {
  users: AdminUser[];
  nextCursor: string | null;
}

export interface DirectoryRequest {
  /** Matched against address, display name and profile slug. Blank is unfiltered. */
  readonly query?: string;
  /** The "who is stopped" list. */
  readonly suspendedOnly?: boolean;
  /** The previous page's `nextCursor`. */
  readonly after?: string | null;
  readonly signal?: AbortSignal;
}

/** The service's own default; sent explicitly so the cursor and the page agree. */
export const DIRECTORY_PAGE_SIZE = 25;

function directoryQuery(request: DirectoryRequest): string {
  const parameters = new URLSearchParams();
  const term = request.query?.trim() ?? '';

  if (term !== '') parameters.set('query', term);
  if (request.suspendedOnly === true) parameters.set('suspended', 'true');
  if (request.after != null && request.after !== '') parameters.set('after', request.after);
  parameters.set('limit', String(DIRECTORY_PAGE_SIZE));

  return parameters.toString();
}

/** AD-04's search. Audited by the service, which is why nothing here retries it in a loop. */
export async function listUsers(request: DirectoryRequest = {}): Promise<AdminUserPage> {
  const response = await authorizedFetch(`/v1/admin/users?${directoryQuery(request)}`, {
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminUserPage;
}

/**
 * One account, on its own — the read behind `/admin/users/{id}` (issue #404).
 *
 * <p>The service has answered this since #104 and nothing called it: the directory listed
 * accounts and the only control on a row was "suspend", so a moderator decided whether to
 * stop somebody from a name, an address and two tags. The screen's own copy told them that
 * suspending "changes nothing about the campaigns they created or the pledges they made" —
 * which is exactly the context needed, and none of it was reachable.
 *
 * <p>Audited by the service like the list, and for a sharper version of its reason: a
 * targeted read of one person by somebody with no relationship to them is the read an
 * investigation into a leak is most interested in.
 */
export async function readUser(id: string, signal?: AbortSignal): Promise<AdminUser> {
  const response = await authorizedFetch(`/v1/admin/users/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminUser;
}

/**
 * One of an account's pledges, as the console lists it — issue #404.
 *
 * <p>The service answers with the same body `GET /v1/me/pledges` serves, which is deliberate
 * and not an economy: a moderator deciding about somebody's account should be looking at what
 * that person is looking at, and a staff-shaped summary beside it would be a second
 * description free to disagree with the first.
 *
 * <p>Narrower here than on the wire. The response carries the amounts broken into six lines,
 * a cover image and a reward tier, because a backer's own list renders all of that; this
 * screen renders a total, a state, and which campaign — the questions "should I stop this
 * account" is actually asked with. What is dropped is dropped by not being read, so the
 * screen cannot come to depend on a field it does not draw.
 */
export interface AdminUserPledge {
  pledgeId: string;
  /** One of §6.2's twelve. All twelve appear: a cancelled pledge is a fact about the person. */
  state: string;
  /** The generated column, never a sum computed here. §10.3 makes it a string. */
  amounts: { total: { amount: string; currency: string } };
  /** ISO-8601 instant, or absent on a pledge that was never confirmed. */
  confirmedAt?: string | null;
  canceledAt?: string | null;
  /** Absent when the campaign row is gone. The pledge is still the person's money. */
  project?: {
    id: string;
    title: string;
    slug: string;
    creatorSlug: string;
    /** One of §6.1's sixteen, and not only the nine public ones. */
    state: string;
  } | null;
}

export interface AdminUserPledgePage {
  pledges: AdminUserPledge[];
  /** Opaque. Hand it back unchanged as `cursor`. Null at the end of the list. */
  nextCursor: string | null;
}

/** How many pledges one read asks for. The service's own default. */
export const PLEDGE_PAGE_SIZE = 20;

/**
 * What one account has backed, newest first.
 *
 * <p>404 for an identifier that names nothing or a deleted account, rather than an empty
 * page: "has backed nothing" and "is not a person" are different answers, and a moderator
 * acting on the first when the second is true is acting on a typo.
 */
export async function readUserPledges(
  id: string,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<AdminUserPledgePage> {
  const parameters = new URLSearchParams({ limit: String(PLEDGE_PAGE_SIZE) });
  if (cursor != null && cursor !== '') parameters.set('cursor', cursor);

  const response = await authorizedFetch(
    `/v1/admin/users/${encodeURIComponent(id)}/pledges?${parameters}`,
    { signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminUserPledgePage;
}

/**
 * AD-04's ban.
 *
 * The reason is required by the service and by this signature: the person is told
 * it, and an appeal is answered from it.
 */
export async function banUser(id: string, reason: string, signal?: AbortSignal): Promise<AdminUser> {
  const response = await authorizedFetch(`/v1/admin/users/${encodeURIComponent(id)}/ban`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ reason }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminUser;
}

/** The way back. Sessions are not restored — the person signs in again. */
export async function reinstateUser(id: string, signal?: AbortSignal): Promise<AdminUser> {
  const response = await authorizedFetch(`/v1/admin/users/${encodeURIComponent(id)}/reinstate`, {
    method: 'POST',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminUser;
}

/**
 * What one account has held and paid — #23, for the account page.
 *
 * Two lists rather than payments nested under subscriptions, because they do not line up one
 * to one: a lapsed plan bought again is two subscriptions, a reversal is a second payment
 * against one, and a payment outlives a subscription row that was removed with a closed
 * account. Each row carries the identifiers that join them where a join exists.
 */
export interface AdminAccountSubscriptions {
  /** Newest first, every state. Branch on `entitled`, never on `state` alone. */
  readonly subscriptions: readonly ConsoleSubscription[];
  /** Newest first by when the money arrived. Signed: a reversal is negative. */
  readonly payments: readonly SubscriptionPayment[];
}

/**
 * One account's subscriptions and payments. Unpaged — a monthly plan is twelve of each a year.
 *
 * <p>Any member of staff may read it, as with the account's pledges, and the service records
 * that it was read. 404 for an identifier that names nothing or a deleted account, the same
 * answer the page's other reads give.
 */
export async function readAccountSubscriptions(
  id: string,
  signal?: AbortSignal,
): Promise<AdminAccountSubscriptions> {
  const response = await authorizedFetch(`/v1/admin/users/${encodeURIComponent(id)}/subscriptions`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as AdminAccountSubscriptions;
}
