import { ApiError, type Problem } from '../api/problem';
import type { PledgeFailureCopy } from '../i18n/checkout-copy';

/**
 * A refusal from the pledge module, in words a backer can act on.
 *
 * <h2>Why the wording is ours here and the service's on Discovery</h2>
 *
 * `DiscoveryView` renders the service's own `title` and `detail` and says why:
 * the endpoint knows which of its rules refused the request and the client does
 * not. Checkout is the other case. Every refusal this surface can meet is named
 * — six on the draft and two on the confirm from the contract, and the four #52
 * added to both (#204) — and each of them has a
 * DIFFERENT RECOVERY: one wants a different tier, one wants a different country,
 * one wants a new reservation, one wants the amount changed, and one wants the
 * backer to go and look at the pledge they already have. A sentence that is
 * accurate but does not say which of those to do is a dead end on the screen
 * where somebody is trying to give money.
 *
 * So the heading is ours, chosen with the recovery, and the service's `detail` is
 * kept underneath it when there is one — it is the half that names the tier, the
 * country, or the amount, and it is written by the code that knows which. Nothing
 * branches on `detail`; `code` is the only thing matched against (§10.4).
 *
 * <h2>The pledge manager reads this table too, and it is still one table</h2>
 *
 * #287 added §4.5's PL-09 edit and PL-10 cancellation, which raise four codes checkout never
 * sees (`PLEDGE_NOT_EDITABLE`, `PLEDGE_NOT_FOUND`, `REWARD_NOT_FOUND`) and re-raise several it
 * does. A second table keyed by endpoint was the alternative and it is the wrong shape: the
 * codes are properties of the pledge module rather than of the screen that met them, and
 * `PROJECT_NOT_LIVE` from a cancellation means precisely what `PROJECT_NOT_LIVE` from a draft
 * means. What did change is one sentence — that entry used to say "nothing was reserved",
 * which is a claim about a request only checkout makes.
 *
 * `CheckoutFailure` keeps its name, because roughly a dozen files import it and renaming a
 * type is a large diff whose only effect is to make a later reader wonder what changed about
 * the error handling. Nothing did.
 *
 * <h2>The words are the caller's and the recoveries are this module's — #91</h2>
 *
 * This table used to hold both. It is a module-level constant, evaluated before any request
 * exists, so it could not read a catalogue and the twenty refusals stayed English on three
 * screens that were otherwise translated — a backer who chose Azerbaijani met a translated
 * form that refused them in English at the moment something went wrong with their money.
 *
 * <p>So what is left here is the half that is behaviour: which recovery belongs to a code,
 * which control it is about, whether the idempotency key must be retired, and whether the
 * refusal means this client is broken. Those are decisions rather than prose and they are the
 * same in four languages. The sentences come in as {@link PledgeFailureCopy}, resolved on the
 * server beside the rest of `checkout` — `lib/dashboard/clock.ts` and `lib/pledges/backer.ts`
 * are the same shape for the same reason.
 */

/** What the interface should offer next. */
export type Recovery =
  /** Reserve again from scratch: the previous reservation is gone. */
  | 'redraft'
  /** The selection has to change before anything can be reserved. */
  | 'change-selection'
  /** Try the same request again; nothing about the selection is wrong. */
  | 'retry'
  /**
   * Wait `retryAfterMs` and send the SAME request, with the SAME key.
   *
   * Not a variety of `retry`, and the difference is the waiting: the request is
   * already being carried out by an attempt that got there first, so trying
   * again immediately earns the same refusal and nothing else. The caller does
   * this without asking, because a backer cannot act on "your own first attempt
   * has not finished" — see `useCheckout`, which also bounds it.
   */
  | 'wait-and-retry'
  /** Nothing on this screen will help. */
  | 'none';

export interface CheckoutFailure {
  /** The stable machine-readable reason, or null when there was no problem body. */
  readonly code: string | null;
  readonly status: number | null;
  readonly title: string;
  /** The service's own sentence when it wrote one, otherwise ours. */
  readonly detail: string;
  readonly recovery: Recovery;
  /**
   * §10.4's `meta.availableAlternatives`: the tiers the service suggests instead
   * of the sold-out one. Ids, which the caller resolves against the reward list
   * it already holds — the service sends ids because a title is prose and this is
   * the same response that says not to branch on prose.
   */
  readonly alternatives: readonly string[];
  /** The control the refusal is about, when it is about one. */
  readonly field: 'contribution' | 'destination' | null;
  /**
   * True when the key that produced this refusal must not be sent again.
   *
   * `RESERVATION_EXPIRED` and `IDEMPOTENCY_KEY_REUSED` only — see
   * `./idempotency`, which explains why replaying a key after an expiry hands
   * back the expired draft and loops.
   */
  readonly retireKey: boolean;
  /**
   * How long the service asked us to wait, in milliseconds, or null when it
   * asked for nothing.
   *
   * From `Retry-After`, which `errorFrom` copies onto the problem. It is
   * reported for every refusal that carries one rather than only for
   * `wait-and-retry`, because a `429` carries it too and a caller that ignored
   * it would spend the rest of the window being refused.
   */
  readonly retryAfterMs: number | null;
  /**
   * True when this refusal means THIS CLIENT is broken, not that the backer or
   * the campaign did anything.
   *
   * The two idempotency-header refusals only. `lib/pledges/idempotency.ts`
   * always sends a `crypto.randomUUID()`, so neither can happen unless a change
   * to this application stopped it from doing that — which makes them a bug
   * report rather than a state a backer can be in. They are worded as one, and
   * they are told apart from the generic fallback so that the interface never
   * offers "try again" for something that will fail identically every time.
   */
  readonly clientBug: boolean;
}

/** Reads `meta.availableAlternatives` without trusting its shape. */
function alternativesIn(problem: Problem | null): readonly string[] {
  const value = problem?.meta?.['availableAlternatives'];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * `retryAfterSeconds` as milliseconds, without trusting its shape.
 *
 * The body is JSON that has been cast, not parsed, so a string or a negative
 * number is possible in the same way any field is; a wait computed from one
 * would be `NaN` and would be handed to `setTimeout`, which treats it as zero
 * and turns a considered pause into a hot loop.
 */
function retryAfterMsIn(problem: Problem | null): number | null {
  const seconds = problem?.retryAfterSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

/** What a code means for the interface. Prose is `checkout.failures.codes` — #91. */
interface Behaviour {
  recovery: Recovery;
  field?: 'contribution' | 'destination';
  retireKey?: boolean;
  clientBug?: boolean;
}

/**
 * The codes this module has a considered answer for.
 *
 * Exported because `lib/i18n/checkout-copy.ts` builds its record of wordings over exactly
 * this list: a code added here without a sentence beside it is a compile error rather than a
 * refusal that renders nothing.
 */
export const PLEDGE_FAILURE_CODES = [
  'REWARD_SOLD_OUT',
  'PLEDGE_ALREADY_EXISTS',
  'IDEMPOTENCY_KEY_REUSED',
  'SHIPPING_DESTINATION_UNPRICED',
  'CONTRIBUTION_BELOW_REWARD_PRICE',
  'PROJECT_NOT_LIVE',
  'PLEDGE_CANNOT_BE_CANCELLED',
  'PLEDGE_DECREASE_NOT_ALLOWED',
  'PLEDGE_NOT_EDITABLE',
  'PLEDGE_NOT_FOUND',
  'REWARD_NOT_FOUND',
  'RESERVATION_EXPIRED',
  'AGREEMENT_REQUIRED',
  'PLEDGE_NOT_DRAFT',
  'IDEMPOTENT_REQUEST_IN_PROGRESS',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_INVALID',
  'PLEDGE_MODIFIED',
] as const;

export type PledgeFailureCode = (typeof PLEDGE_FAILURE_CODES)[number];

/**
 * The contract's codes, each with the recovery that belongs to it.
 *
 * A record rather than a switch so that a code with no entry is obvious — it
 * falls through to the service's own prose, which is the honest answer for a
 * refusal this build has never heard of, rather than to a sentence that guesses.
 *
 * <p>The sentences moved to `checkout.failures.codes` in #91 and the reasoning about WHAT
 * each one says moved with them. What stays here is why the recovery is what it is, which is
 * the decision this module actually makes.
 */
const BEHAVIOUR: Record<PledgeFailureCode, Behaviour> = {
  REWARD_SOLD_OUT: { recovery: 'change-selection' },
  /*
   * The recovery changed with #287: it used to be a dead end, and `/pledges/{id}` is now
   * where a backer changes what they chose, so the refusal points at it. The sentence in the
   * catalogue says so and is the half that has to be kept true if this ever changes back.
   */
  PLEDGE_ALREADY_EXISTS: { recovery: 'none' },
  /*
   * Not the backer's mistake. It means this client sent one key for two different bodies,
   * which is a bug in the client; retiring the key makes the next attempt work rather than
   * loop.
   */
  IDEMPOTENCY_KEY_REUSED: { recovery: 'retry', retireKey: true },
  SHIPPING_DESTINATION_UNPRICED: { recovery: 'change-selection', field: 'destination' },
  CONTRIBUTION_BELOW_REWARD_PRICE: { recovery: 'change-selection', field: 'contribution' },
  /*
   * Reachable from four endpoints since #287 — the draft, the confirm, the edit and the
   * cancel — because `PledgeService#requireEditable` deliberately answers a closed campaign
   * with the code the draft endpoint already gives. Which is why the catalogue's sentence
   * says "nothing has changed" rather than "nothing was reserved": on a cancellation there
   * was never anything to reserve.
   */
  PROJECT_NOT_LIVE: { recovery: 'none' },
  /*
   * IDN-EXT-01 (#35): a backer cannot withdraw a confirmed pledge. The web no longer offers
   * the control, so this is reached from an old tab or another client.
   */
  PLEDGE_CANNOT_BE_CANCELLED: { recovery: 'none' },
  /* IDN-EXT-01 (#35): a confirmed pledge may only go up. */
  PLEDGE_DECREASE_NOT_ALLOWED: { recovery: 'none' },
  /*
   * §4.5's PL-09 and PL-10, refused by the PLEDGE's own state rather than the campaign's —
   * the service is explicit that a closed campaign is `PROJECT_NOT_LIVE` instead, so this
   * code means only the thing it alone can mean. `meta.state` says which state, and the
   * screen prints it separately.
   */
  PLEDGE_NOT_EDITABLE: { recovery: 'none' },
  /*
   * 404 for a pledge that does not exist AND for one belonging to somebody else, deliberately
   * indistinguishable — the endpoint must not be usable to ask whether a pledge id is real.
   * The wording keeps that promise rather than guessing which it was.
   */
  PLEDGE_NOT_FOUND: { recovery: 'none' },
  REWARD_NOT_FOUND: { recovery: 'change-selection' },
  RESERVATION_EXPIRED: { recovery: 'redraft', retireKey: true },
  /*
   * §22.3's acknowledgement, refused — #427. Two ways to arrive and one recovery: either this
   * page showed no risk statement at all, which is a fault in this site, or it showed one that
   * has since been replaced, which is a page left open across a publication. Both are answered
   * by loading the page again.
   *
   * `clientBug` is deliberately NOT set. The common case is the honest one: a checkout tab
   * open while an administrator published a new version, which is nobody's mistake.
   */
  AGREEMENT_REQUIRED: { recovery: 'none' },
  PLEDGE_NOT_DRAFT: { recovery: 'none' },
  /*
   * The four #52 answered that the contract did not specify, and that this client was merged
   * without (#204). All four are reachable from both payment mutations, which is why they are
   * here beside the ones the contract named rather than in a second table keyed by endpoint.
   *
   * What a double-click produces: the first request still holds the claim on the key and the
   * second is told to ask again. Nothing is wrong and the work is already being done — so the
   * caller waits rather than putting a sentence on screen for a state that usually lasts a few
   * hundred milliseconds.
   */
  IDEMPOTENT_REQUEST_IN_PROGRESS: { recovery: 'wait-and-retry' },
  IDEMPOTENCY_KEY_REQUIRED: { recovery: 'none', clientBug: true },
  IDEMPOTENCY_KEY_INVALID: { recovery: 'none', clientBug: true },
  /*
   * §8.4's sweep expiring a draft in the very moment its backer confirms it. The service
   * refuses to report a cause it has inferred rather than observed, so the catalogue's
   * sentence does not claim the hold expired either — and this recovery is right whether the
   * sweep or something else wrote to the pledge.
   */
  PLEDGE_MODIFIED: { recovery: 'redraft' },
};

/** Whether this build has a considered answer for a code the service sent. */
function known(code: string | null): code is PledgeFailureCode {
  return code !== null && code in BEHAVIOUR;
}

/**
 * Anything a checkout request can throw, as something to render.
 *
 * A thrown value that is not an `ApiError` is a failure to reach the service at
 * all — an offline browser, DNS, a proxy — and it is reported as that rather than
 * as a refusal. The distinction matters here more than anywhere: "the campaign
 * refused your pledge" and "your connection dropped" call for opposite next
 * moves, and only one of them is safe to repeat without thinking.
 */
export function describeFailure(cause: unknown, copy: PledgeFailureCopy): CheckoutFailure {
  if (!(cause instanceof ApiError)) {
    return {
      code: null,
      status: null,
      title: copy.unreachable.title,
      detail: copy.unreachable.detail,
      recovery: 'retry',
      alternatives: [],
      field: null,
      retireKey: false,
      retryAfterMs: null,
      clientBug: false,
    };
  }

  const problem = cause.problem;
  const code = problem?.code ?? null;

  if (!known(code)) {
    if (cause.status === 401) {
      return {
        code,
        status: cause.status,
        title: copy.signedOut.title,
        detail: copy.signedOut.detail,
        recovery: 'none',
        alternatives: [],
        field: null,
        retireKey: false,
        retryAfterMs: null,
        clientBug: false,
      };
    }

    return {
      code,
      status: cause.status,
      /*
       * THE SERVICE'S OWN WORDS WHEN IT WROTE ANY, and they are not translated: the endpoint
       * knows which of its rules refused a request this build has never heard of, and a
       * client that replaced that sentence with a generic one of its own would be hiding the
       * only information anybody has. The fallback pair below is what is left when the
       * service sent no problem body at all.
       */
      title: problem?.title ?? copy.unknown.title,
      detail: problem?.detail ?? copy.unknown.detail,
      recovery: 'retry',
      alternatives: alternativesIn(problem),
      field: null,
      retireKey: false,
      retryAfterMs: retryAfterMsIn(problem),
      clientBug: false,
    };
  }

  const behaviour = BEHAVIOUR[code];
  const wording = copy.codes[code];

  return {
    code,
    status: cause.status,
    title: wording.title,
    /*
     * OURS, NOT THE SERVICE'S, FOR THE CODES ABOVE — and this is the one
     * place this repository overrides RFC 9457 prose. The service's sentence
     * states the fact ("the Super Early Bird tier has no remaining places");
     * the screen is already stating that fact, because the tier is marked sold
     * out three centimetres away. What it does not state is what to do next,
     * and on the screen where somebody is trying to give money that is the only
     * half worth the space. An unknown code still falls through to the
     * service's own words above, because there the fact is all anybody has.
     *
     * <p>Since #91 "ours" means the reader's language rather than English, which is what
     * made this override defensible in the first place: a sentence chosen for its recovery
     * is only better than the service's if the person reading it can read it.
     */
    detail: wording.detail,
    recovery: behaviour.recovery,
    alternatives: alternativesIn(problem),
    field: behaviour.field ?? null,
    retireKey: behaviour.retireKey ?? false,
    retryAfterMs: retryAfterMsIn(problem),
    clientBug: behaviour.clientBug ?? false,
  };
}
