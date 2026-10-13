import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.11's AD-10: support conversations with the account context they are about — issue #310.
 *
 * <h2>Why the platform has its own rather than a shared mailbox</h2>
 *
 * §4.11 asks for "tickets with user context and action history", and the second half is what
 * a mail client cannot do. A conversation about a pledge is read beside that pledge, the
 * account's standing, and every other ticket the same person has raised — so the subject has
 * to be a column rather than a sentence somebody pasted, and the history has to come back
 * with the ticket.
 *
 * <h2>Internal notes are in the thread and are never shown to the requester</h2>
 *
 * A note staff leave for each other is read in sequence with the rest of the conversation —
 * that is the point of it — so it is a flag on a message rather than a separate list. The
 * service filters; `readRequesterThread` is what a person uses to check what the other side
 * actually has in front of them before replying.
 */

export type TicketState = 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';

/** Set by staff, never by the requester — a priority anybody could choose is URGENT within a week. */
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type TicketSubjectType = 'NONE' | 'PROJECT' | 'PLEDGE' | 'ACCOUNT';

export type TicketSide = 'REQUESTER' | 'STAFF';

export interface Ticket {
  id: string;
  requesterId: string;
  subject: string;
  subjectType: TicketSubjectType;
  subjectRef?: string | null;
  state: TicketState;
  priority: TicketPriority;
  /** Null is the queue. There is deliberately no separate queue table. */
  assigneeId?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

export interface TicketMessage {
  id: string;
  authorId: string;
  authorSide: TicketSide;
  body: string;
  /** Staff-only. The service refuses one attributed to the requester. */
  internal: boolean;
  createdAt: string;
}

export interface TicketFile {
  ticket: Ticket;
  messages: TicketMessage[];
}

/** A ticket, its thread, and everything else this person has asked. */
export interface TicketContext {
  file: TicketFile;
  /** Includes the ticket itself — a list of "their other tickets" that omitted one would be miscounted. */
  history: Ticket[];
}

export interface TicketPage {
  tickets: Ticket[];
  page: number;
  hasMore: boolean;
}

/** How urgent each level is, in order. The service sorts by the enum, so this order matters. */
export const TICKET_PRIORITIES: readonly TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export const TICKET_STATES: readonly TicketState[] = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'];

/** The queue: most urgent first, oldest first within a priority. */
export async function readTicketQueue(page = 0, signal?: AbortSignal): Promise<TicketPage> {
  const response = await authorizedFetch(`/v1/admin/tickets/queue?page=${page}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as TicketPage;
}

/**
 * What the list may be narrowed by — issue #404.
 *
 * <p>The three things every row already displayed and none of which could be filtered:
 * §4.11's four states, the four priorities staff set, and who is handling it. The screen's own
 * copy explains that priority is a decision staff take, which nobody could then act on.
 *
 * <p>`unassigned` is separate from `assigneeId` rather than being a null one, because a null
 * assignee already means "anybody's" and one value cannot also mean "nobody's". Sent together
 * they are a contradiction, and the service answers it with nothing — which is the honest
 * answer to "assigned to Ayan and to no one".
 */
export interface TicketFilter {
  readonly state?: TicketState | null;
  readonly priority?: TicketPriority | null;
  readonly assigneeId?: string | null;
  readonly unassigned?: boolean;
}

/** Whether a filter narrows anything, which decides what an empty list means. */
export function narrows(filter: TicketFilter): boolean {
  return (
    filter.state != null ||
    filter.priority != null ||
    (filter.assigneeId != null && filter.assigneeId !== '') ||
    filter.unassigned === true
  );
}

/**
 * Everything, newest first, narrowed by the filter.
 *
 * <p>Not the queue. `readTicketQueue` answers "what is still somebody's work", most urgent
 * first; this is ordered by when a ticket arrived, and narrowing it is what #404 asked for. A
 * queue that grew filters would be a queue whose order stopped meaning "work from the front".
 */
export async function listTickets(
  filter: TicketFilter = {},
  page = 0,
  signal?: AbortSignal,
): Promise<TicketPage> {
  const parameters = new URLSearchParams({ page: String(page) });
  if (filter.state != null) parameters.set('state', filter.state);
  if (filter.priority != null) parameters.set('priority', filter.priority);
  if (filter.assigneeId != null && filter.assigneeId !== '')
    parameters.set('assigneeId', filter.assigneeId);
  if (filter.unassigned === true) parameters.set('unassigned', 'true');

  const response = await authorizedFetch(`/v1/admin/tickets?${parameters}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as TicketPage;
}

/** One ticket, its thread, and the rest of this person's history. */
export async function readTicket(ticketId: string, signal?: AbortSignal): Promise<TicketContext> {
  const response = await authorizedFetch(`/v1/admin/tickets/${encodeURIComponent(ticketId)}`, {
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as TicketContext;
}

/** The thread as the requester sees it — no internal notes. */
export async function readRequesterThread(
  ticketId: string,
  signal?: AbortSignal,
): Promise<{ messages: TicketMessage[] }> {
  const response = await authorizedFetch(
    `/v1/admin/tickets/${encodeURIComponent(ticketId)}/thread`,
    { signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as { messages: TicketMessage[] };
}

export interface RaiseTicketRequest {
  /** Null only on a `PLEDGE` ticket, which the service then raises for the pledge's backer (#416). */
  readonly requesterId: string | null;
  readonly subject: string;
  readonly subjectType: TicketSubjectType;
  readonly subjectRef: string | null;
  readonly priority: TicketPriority;
  readonly body: string;
  readonly signal?: AbortSignal;
}

/**
 * Records a conversation against somebody's account.
 *
 * Staff-only, and there is no public form behind it. That is a limit of #310 rather than an
 * oversight: a public "contact us" is a different surface with its own rate limiting and an
 * open question about senders who have no account.
 */
export async function raiseTicket(request: RaiseTicketRequest): Promise<TicketFile> {
  const response = await authorizedFetch('/v1/admin/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requesterId: request.requesterId,
      subject: request.subject,
      subjectType: request.subjectType,
      subjectRef: request.subjectRef,
      priority: request.priority,
      body: request.body,
    }),
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as TicketFile;
}

export interface RaiseBackerTicketRequest {
  readonly pledgeId: string;
  readonly subject: string;
  readonly body: string;
  readonly priority?: TicketPriority;
  readonly signal?: AbortSignal;
}

/**
 * Records a conversation a backer had about their pledge somewhere else — WhatsApp, email, a
 * call — as a ticket in their name — issue #416.
 *
 * <p>No requester is sent: the service raises a `PLEDGE` ticket that names none for whoever made
 * the pledge, so support starts from the reference the backer quoted rather than from a
 * directory search that might find the wrong person. That ticket is what a refund's bank account
 * is recorded from. Refused with 404 `PLEDGE_NOT_FOUND` for a pledge that does not exist.
 */
export async function raiseBackerTicket(request: RaiseBackerTicketRequest): Promise<TicketFile> {
  return raiseTicket({
    requesterId: null,
    subject: request.subject,
    subjectType: 'PLEDGE',
    subjectRef: request.pledgeId,
    priority: request.priority ?? 'NORMAL',
    body: request.body,
    signal: request.signal,
  });
}

/** Answers a ticket, or leaves a note. A note does not move it — they are still waiting. */
export async function replyToTicket(
  ticketId: string,
  body: string,
  internal: boolean,
  signal?: AbortSignal,
): Promise<TicketFile> {
  const response = await authorizedFetch(
    `/v1/admin/tickets/${encodeURIComponent(ticketId)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, internal }),
      signal,
    },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as TicketFile;
}

export interface TicketUpdate {
  readonly assigneeId?: string | null;
  /**
   * Puts it back in the queue.
   *
   * A flag rather than a null assignee, because JSON cannot tell "absent" from "null" — and
   * treating an omitted assignee as an unassignment would empty the queue every time
   * somebody changed a priority.
   */
  readonly unassign?: boolean;
  readonly priority?: TicketPriority;
  readonly state?: TicketState;
}

/** Changes the assignee, the priority, the state, or any combination. */
export async function updateTicket(
  ticketId: string,
  update: TicketUpdate,
  signal?: AbortSignal,
): Promise<Ticket> {
  const response = await authorizedFetch(`/v1/admin/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assigneeId: update.assigneeId ?? null,
      unassign: update.unassign ?? false,
      priority: update.priority ?? null,
      state: update.state ?? null,
    }),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as Ticket;
}
