import Decimal from 'decimal.js';
import type { Money } from '@ideanest/money';
import { MONEY_SCALE, isWireAmount } from '@ideanest/money';

/**
 * What arrives over §12.1's socket, and what a page does with it.
 *
 * This module is deliberately pure: no `WebSocket`, no React, no `window`. What it holds is
 * the decisions worth testing — what a message from the server means, what a running total
 * becomes when one arrives, and how long to wait before trying the socket again — and each
 * client's `useCampaignUpdates` is the thin part that owns the connection.
 *
 * <h2>One parser for two clients</h2>
 *
 * It was `apps/web/src/lib/realtime/updates.ts` and moved here with #155, because the app's
 * live counter reads the same frames from the same socket. A frame the browser ignores and
 * the phone adds to the total would leave the two showing different amounts for one campaign;
 * one parser makes that impossible rather than unlikely.
 *
 * <h2>The socket is opt-in, and absent by default</h2>
 *
 * <p>The web's reasoning follows. The app reaches the same answer from the other side: its
 * origin is a build-time variable, `IDEANEST_REALTIME_ORIGIN` in `app.config.ts`, and unset
 * means no socket rather than a guessed host.
 *
 * `next.config.mjs` states that the browser never learns the API's real origin: it talks to
 * this application, and `/v1` is rewritten server-side. **A WebSocket cannot use that
 * rewrite** — Next does not proxy an upgrade — so a live counter needs either an address the
 * browser can reach directly or a proxy in front of both, which is #139's territory.
 *
 * Rather than reverse that decision quietly, the address is a variable that is **unset by
 * default**: with nothing configured no socket is opened, no reconnection is attempted, and
 * the page behaves exactly as it did before #91 — server-rendered numbers that are correct and
 * refresh on navigation. A deployment that has somewhere to point this sets it, and the API's
 * `ideanest.realtime.allowed-origins` is the compensating control on the other side.
 */

/**
 * Where the browser may open a socket, e.g. `wss://api.ideanest.az`.
 *
 * The same name on both clients. On the web it is **not a `NEXT_PUBLIC_` variable**, and the
 * difference is worth stating because the browser
 * does end up with the value either way. It is read on the server, by the campaign page, and
 * handed to the client island as a prop — so it is runtime configuration like
 * `IDEANEST_API_ORIGIN` rather than a string baked into a bundle at build time, and changing it
 * is a restart rather than a rebuild.
 *
 * Unset means the feature is off, which is the default.
 */
export const REALTIME_ORIGIN_VARIABLE = 'IDEANEST_REALTIME_ORIGIN';

/** §12.1's two public channels, as the server names them. */
export function counterChannel(projectId: string): string {
  return `project:${projectId}`;
}

export function commentsChannel(projectId: string): string {
  return `project:${projectId}:comments`;
}

/**
 * The socket address for a channel, or `null` when no origin is configured.
 *
 * `null` rather than a thrown error or a guessed address: an unconfigured deployment is the
 * ordinary state of this feature, not a fault, and a hook that threw would take a public
 * campaign page down over a live counter.
 */
export function realtimeUrl(origin: string | undefined, channel: string): string | null {
  if (origin === undefined || origin.trim() === '') {
    return null;
  }

  const trimmed = origin.trim().replace(/\/+$/, '');
  /*
   * `http` and `https` are accepted and rewritten, because an operator will set this to the
   * same value they set the API origin to and being refused for the scheme would be a
   * configuration error with no symptom other than silence.
   */
  const withScheme = trimmed.startsWith('http://')
    ? `ws://${trimmed.slice('http://'.length)}`
    : trimmed.startsWith('https://')
      ? `wss://${trimmed.slice('https://'.length)}`
      : trimmed;

  if (!withScheme.startsWith('ws://') && !withScheme.startsWith('wss://')) {
    return null;
  }
  return `${withScheme}/v1/realtime?channel=${encodeURIComponent(channel)}`;
}

/**
 * One window's worth of news about a campaign.
 *
 * Every field is optional because the server omits what did not happen — a counter message
 * carries no comment count and a comments message carries no amount. `RealtimeFlusher`
 * explains why that is preferable to sending zeroes a client would have to know to ignore.
 */
export interface CampaignUpdate {
  readonly channel: string;
  /** How many pledges were confirmed in the window. */
  readonly pledges: number;
  /** What they came to, or `null` when the window carried none. */
  readonly amount: Money | null;
  /** How many comments were posted in the window. */
  readonly comments: number;
  /** The newest comment in the window, or `null`. Never its text — see `RealtimeAggregator`. */
  readonly latestCommentId: string | null;
}

/**
 * A message from the server, or `null` when it is not one.
 *
 * **Everything is checked, and nothing is trusted.** This runs on whatever arrived over a
 * socket, and the failure mode of a lenient parse here is a campaign page whose counter shows
 * `NaN` or `undefined` to every reader. `null` is returned rather than thrown for the reason
 * `realtimeUrl` returns one: a bad frame must cost the message, never the page.
 */
export function parseUpdate(raw: string): CampaignUpdate | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const channel = record['channel'];
  if (typeof channel !== 'string' || channel === '') {
    return null;
  }

  return {
    channel,
    pledges: countOf(record['pledges']),
    amount: moneyOf(record['amount']),
    comments: countOf(record['comments']),
    latestCommentId: typeof record['latestCommentId'] === 'string' ? record['latestCommentId'] : null,
  };
}

/**
 * Adds a window's amount to a running total.
 *
 * **`Decimal`, never a number**, which is CLAUDE.md §3 and matters more here than almost
 * anywhere else on the client: this is the one place on the platform where an amount is
 * repeatedly accumulated in a browser, so a float would drift by a hundredth of a manat every
 * few hundred pledges and the page would slowly disagree with the campaign.
 *
 * A window in a different currency is **ignored rather than converted or added**. A campaign
 * has one currency, so a mismatch is a fact that has stopped being true; adding the number
 * anyway would show a total in the wrong unit, and there is nothing here that could convert.
 */
export function addToTotal(total: Money, added: Money | null): Money {
  if (added === null || added.currency !== total.currency) {
    return total;
  }

  const sum = new Decimal(total.amount).plus(new Decimal(added.amount));
  /*
   * `MONEY_SCALE` rather than the scale of whichever operand had more, because money on this
   * platform is `numeric(14,2)` everywhere and the wire form always carries two places. Asking
   * `Decimal` for the scale of `'5000.00'` answers zero — it normalises trailing zeros away —
   * so deriving it would quietly turn a total into `'5025'`.
   */
  return { amount: sum.toFixed(MONEY_SCALE), currency: total.currency };
}

/** A non-negative whole number, or zero. Anything else the server did not send. */
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * `{ amount, currency }` with a string amount, or `null`.
 *
 * A JSON number is rejected rather than coerced, which is the strictest thing in this file and
 * is deliberate: §10.3 says money crosses as a string, so a number here means either a server
 * that has broken that rule or a frame that did not come from one. Accepting it would be
 * accepting the value that has already lost precision.
 */
function moneyOf(value: unknown): Money | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const amount = record['amount'];
  const currency = record['currency'];
  if (typeof amount !== 'string' || typeof currency !== 'string' || currency === '') {
    return null;
  }

  /*
   * `isWireAmount`, not `new Decimal(...)`. The constructor accepts `'1e5'` and `'0x10'`
   * happily, and both would parse into a number nobody pledged and render as one. The regex in
   * `money.ts` is the platform's rule for what an amount looks like, and this is the same rule
   * rather than a second one.
   */
  if (!isWireAmount(amount)) {
    return null;
  }
  return { amount, currency };
}

/* -------------------------------------------------------------------------
 * Reconnecting
 * ---------------------------------------------------------------------- */

/**
 * How a live counter retries a socket that closed — the policy, without the socket.
 *
 * <h2>Reconnection gives up, and that is the point</h2>
 *
 * Backoff doubles from a second towards a minute, and after {@link MAX_RECONNECT_ATTEMPTS}
 * consecutive failures it stops for good. A live counter that reconnected forever would be
 * every abandoned tab — and every phone with the campaign left open in a pocket — holding a
 * connection attempt open against the service, and the page it is on is already correct
 * without it. The reader who wants fresh numbers reloads or pulls to refresh, which is the
 * same action they would take anyway.
 *
 * <p>The count is of <em>consecutive</em> failures: a socket that opens resets it, so a
 * connection that drops once an hour reconnects every time. The web hook and the app's hook
 * both call {@link reconnectDelayMs} rather than restating the arithmetic, because a policy
 * written twice is a policy that drifts the first time somebody tunes one copy.
 */

/** The first wait, doubling up to {@link MAX_BACKOFF_MS}. */
export const BASE_BACKOFF_MS = 1_000;

/** The longest wait between two attempts. */
export const MAX_BACKOFF_MS = 60_000;

/** Consecutive failures before a page stops trying. See the note above. */
export const MAX_RECONNECT_ATTEMPTS = 6;

/**
 * How long to wait before the next attempt, or `null` to stop.
 *
 * @param attempts how many consecutive reconnection attempts have already been made — zero
 *     after a socket opened, or on the first close
 */
export function reconnectDelayMs(attempts: number): number | null {
  /*
   * No guard against a negative or fractional count: both hooks only ever start at zero and add
   * one, and this runs inside the campaign page's client bundle, which has a budget measured in
   * bytes. A count past the cap — the one value a caller can reach — is `null`.
   */
  return attempts >= MAX_RECONNECT_ATTEMPTS ? null : Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}
