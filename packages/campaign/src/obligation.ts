/**
 * §5.5's update obligation, as the client reads it — issue #437, surfaced by #439.
 *
 * <h2>What this is, in one sentence</h2>
 *
 * A creator whose campaign funded owes their backers an update at least monthly until
 * fulfilment is complete, and §22.3 names the consequence: "the creator's project history
 * visible". This module is what makes that fact readable on a page.
 *
 * <h2>The state is the server's, and the client never recomputes it</h2>
 *
 * Every timestamp needed to derive the state is on the response, and the state is on it too.
 * That is deliberate: the boundary between `DUE_SOON` and `LAPSED` is a comparison against a
 * configured lead the browser does not know, and a second implementation of it in TypeScript
 * would disagree with the service on somebody's campaign page — the same argument
 * `CampaignOutcomeNotice` makes about recomputing §5.1 in the browser.
 *
 * The dates are still on the response, and are still rendered. They are what makes the state
 * checkable rather than asserted, and #437 asks for the fact "stated neutrally, with the date
 * of the last update".
 *
 * <h2>Shared since #155</h2>
 *
 * The app's campaign screen draws the same notice, so the vocabulary and the readers moved
 * here from `apps/web/src/lib/obligations/api.ts`, which re-exports them. The fetches stay
 * with each client.
 *
 * <h2>Narrowed, not cast — #323</h2>
 *
 * These reads go through a plain `fetch` against the same origin the generated client uses,
 * following `lib/profiles/server.ts`, so nothing here is type-checked by the compiler against
 * the service. The narrowing below is what stands in for that.
 */

/**
 * The five states, in the order they occur.
 *
 * `NEVER_UPDATED` is separate from `LAPSED` for the reason `FulfilmentProgress` separates
 * `untouched` from `preparing`: "has not posted since the campaign closed" and "posted, and
 * not recently" are the same to nobody reading the page to decide whether to back this creator
 * again. `COMPLETE` is separate from `CURRENT` for the mirror of that reason.
 */
export const OBLIGATION_STATES = [
  'CURRENT',
  'DUE_SOON',
  'NEVER_UPDATED',
  'LAPSED',
  'COMPLETE',
] as const;

export type ObligationState = (typeof OBLIGATION_STATES)[number];

export interface UpdateObligation {
  readonly projectId: string;
  readonly state: ObligationState;
  /** When the campaign closed. The clock starts here. */
  readonly openedAt: string;
  /** `null` when nothing has been published since the campaign closed — not "unknown". */
  readonly lastUpdateAt: string | null;
  readonly dueAt: string;
  /** When a moderator was told, or `null`. Present so the state is checkable rather than asserted. */
  readonly lapsedAt: string | null;
  /** When fulfilment finished, or `null` while it is still running. */
  readonly closedAt: string | null;
}

export interface CreatorObligations {
  /**
   * `null` for a slug nobody holds.
   *
   * The service answers an empty history rather than a 404 there, so that this endpoint cannot
   * be used to tell an unknown slug from a closed account — which is the leak the profile's own
   * 404 exists to prevent. Indistinguishable here too, and nothing renders differently for it.
   */
  readonly creatorId: string | null;
  readonly obligations: readonly UpdateObligation[];
  /**
   * How many of them are late now.
   *
   * Sent by the server rather than counted here, because it is the number the profile leads
   * with and a client that derived it would eventually derive it from a stale list.
   */
  readonly lapsedCount: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalInstant(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isState(value: unknown): value is ObligationState {
  return typeof value === 'string' && (OBLIGATION_STATES as readonly string[]).includes(value);
}

/**
 * One obligation, or `null` when the body is not one.
 *
 * <strong>An unknown state is `null` and not a default.</strong> The vocabulary can grow — a
 * later issue adding a sixth value is a service that ships before the client does — and
 * falling back to `CURRENT` would tell a reader a creator is up to date on the strength of a
 * word this build has never seen. Drawing nothing is the honest failure.
 */
export function readUpdateObligation(body: unknown): UpdateObligation | null {
  if (!isObject(body)) return null;
  if (typeof body.projectId !== 'string' || typeof body.dueAt !== 'string') return null;
  if (typeof body.openedAt !== 'string') return null;
  if (!isState(body.state)) return null;

  return {
    projectId: body.projectId,
    state: body.state,
    openedAt: body.openedAt,
    lastUpdateAt: optionalInstant(body.lastUpdateAt),
    dueAt: body.dueAt,
    lapsedAt: optionalInstant(body.lapsedAt),
    closedAt: optionalInstant(body.closedAt),
  };
}

/**
 * A creator's whole history, or `null`.
 *
 * A row that will not narrow is dropped rather than failing the list: one campaign the client
 * cannot read must not remove the other eleven from a profile. `lapsedCount` is taken from the
 * server even so, because it counts what the server holds rather than what survived narrowing
 * — and a number that silently shrank with the list would be the wrong kind of consistent.
 */
export function readCreatorObligations(body: unknown): CreatorObligations | null {
  if (!isObject(body)) return null;
  if (!Array.isArray(body.obligations)) return null;

  const obligations = body.obligations
    .map((row) => readUpdateObligation(row))
    .filter((row): row is UpdateObligation => row !== null);

  return {
    creatorId: typeof body.creatorId === 'string' ? body.creatorId : null,
    obligations,
    lapsedCount: typeof body.lapsedCount === 'number' ? body.lapsedCount : 0,
  };
}
