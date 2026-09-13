import { ApiError, type Problem } from '../api/problem';

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

interface Wording {
  title: string;
  detail: string;
  recovery: Recovery;
  field?: 'contribution' | 'destination';
  retireKey?: boolean;
  clientBug?: boolean;
}

/**
 * The contract's codes, each with the recovery that belongs to it.
 *
 * A record rather than a switch so that a code with no entry is obvious — it
 * falls through to the service's own prose, which is the honest answer for a
 * refusal this build has never heard of, rather than to a sentence that guesses.
 */
const WORDING: Record<string, Wording> = {
  REWARD_SOLD_OUT: {
    title: 'That reward has just gone',
    detail: 'Somebody took the last one while you were choosing. Nothing has been reserved.',
    recovery: 'change-selection',
  },
  PLEDGE_ALREADY_EXISTS: {
    /*
     * The recovery changed with #287 and the sentence changed with it. It used to end "which
     * is not something this build can do yet", which was true while the pledge manager did
     * not exist; `/pledges/{id}` is now where a backer changes what they chose, so the
     * refusal points at it instead of at a dead end.
     */
    title: 'You are already backing this campaign',
    detail:
      'One pledge per campaign. To change what you chose, open the pledge you already have and edit it.',
    recovery: 'none',
  },
  IDEMPOTENCY_KEY_REUSED: {
    // Not the backer's mistake, and the wording does not imply it is. It means
    // this client sent one key for two different bodies, which is a bug in the
    // client; retiring the key makes the next attempt work rather than loop.
    title: 'That request did not match the one before it',
    detail: 'Nothing was reserved. Try again.',
    recovery: 'retry',
    retireKey: true,
  },
  SHIPPING_DESTINATION_UNPRICED: {
    title: 'The creator does not post to that destination',
    detail:
      'They have not set a delivery cost for it, so there is no honest amount to charge you. Choose somewhere else, or drop the item that is posted.',
    recovery: 'change-selection',
    field: 'destination',
  },
  CONTRIBUTION_BELOW_REWARD_PRICE: {
    title: 'That is less than the reward costs',
    detail: 'Give at least the price of the tier you chose, or choose a cheaper one.',
    recovery: 'change-selection',
    field: 'contribution',
  },
  PROJECT_NOT_LIVE: {
    /*
     * Reachable from four endpoints since #287 — the draft, the confirm, the edit and the
     * cancel — because `PledgeService#requireEditable` deliberately answers a closed campaign
     * with the code the draft endpoint already gives. So the sentence says "nothing has
     * changed" rather than "nothing was reserved": on a cancellation there was never anything
     * to reserve, and a message about a reservation on that screen would be about a request
     * the backer did not make.
     */
    title: 'This campaign is not taking pledges',
    detail: 'It may have closed, or it may not have opened yet. Nothing has changed.',
    recovery: 'none',
  },
  PLEDGE_CANNOT_BE_CANCELLED: {
    /*
     * IDN-EXT-01 (#35): a backer cannot withdraw a confirmed pledge. The web no longer offers
     * the control, so this is reached from an old tab or another client. The sentence names
     * the two things that are still true — it can be raised, and refunds are campaign-level —
     * because "no" alone would read as a fault.
     */
    title: 'A confirmed pledge cannot be withdrawn',
    detail:
      'You can raise this pledge, but not cancel it. Nothing has changed. If the campaign ends below its success threshold, is suspended, or is cancelled, every backer is refunded.',
    recovery: 'none',
  },
  PLEDGE_DECREASE_NOT_ALLOWED: {
    /*
     * IDN-EXT-01 (#35): a confirmed pledge may only go up. `meta.current` and
     * `meta.requested` carry the two totals; this sentence is true without them.
     */
    title: 'A confirmed pledge can only be raised',
    detail:
      'This change would lower your pledge, and a confirmed pledge can only go up. Nothing has changed.',
    recovery: 'none',
  },
  PLEDGE_NOT_EDITABLE: {
    /*
     * §4.5's PL-09 and PL-10, refused by the PLEDGE's own state rather than the campaign's —
     * the service is explicit that a closed campaign is `PROJECT_NOT_LIVE` instead, so this
     * code means only the thing it alone can mean.
     *
     * `meta.state` says which state, and the screen prints it separately: an EXPIRED draft and
     * a COLLECTED pledge are the same refusal and completely different next moves, and this
     * sentence is deliberately the half that is true of both.
     */
    title: 'This pledge can no longer be changed',
    detail:
      'It has moved past the point where a backer can edit or withdraw it. Nothing has changed. If something about it is wrong, the campaign’s creator is who to ask.',
    recovery: 'none',
  },
  PLEDGE_NOT_FOUND: {
    /*
     * 404 for a pledge that does not exist AND for one belonging to somebody else,
     * deliberately indistinguishable — the endpoint must not be usable to ask whether a
     * pledge id is real. The wording keeps that promise rather than guessing which it was.
     */
    title: 'That pledge is not here',
    detail:
      'It may have been cancelled, or the link may be wrong. Your own pledges are listed on your pledges page.',
    recovery: 'none',
  },
  REWARD_NOT_FOUND: {
    title: 'That reward is no longer offered',
    detail:
      'The creator has removed the tier you chose. Pick another one, or continue without a reward. Nothing has changed.',
    recovery: 'change-selection',
  },
  RESERVATION_EXPIRED: {
    title: 'Your reward was only held for five minutes',
    detail:
      'The hold has ended and the stock has gone back to the campaign. Nothing was confirmed and no card was involved. Reserve it again to carry on.',
    recovery: 'redraft',
    retireKey: true,
  },
  AGREEMENT_REQUIRED: {
    /*
     * §22.3's acknowledgement, refused — #427. Two ways to arrive and one recovery, which is
     * why they share a descriptor: either this page showed no risk statement at all, which
     * is a fault in this site, or it showed one that has since been replaced, which is a
     * page left open across a publication. Both are answered by loading the page again, and
     * the sentence says the true thing about both — nothing was confirmed.
     *
     * `clientBug` is deliberately NOT set. The common case is the honest one: a checkout tab
     * open while an administrator published a new version, which is nobody's mistake.
     */
    title: 'What backing means has changed',
    detail:
      'This page was showing an older statement of what a pledge is and is not. Nothing was confirmed and no card was involved. Load the page again, read it, and confirm.',
    recovery: 'none',
  },
  PLEDGE_NOT_DRAFT: {
    title: 'This pledge has already been dealt with',
    detail: 'It is confirmed or cancelled, so there is nothing left to confirm.',
    recovery: 'none',
  },
  /*
   * The four #52 answered that the contract did not specify, and that this
   * client was merged without (#204). All four are reachable from both payment
   * mutations, which is why they are here beside the ones the contract named
   * rather than in a second table keyed by endpoint.
   */
  IDEMPOTENT_REQUEST_IN_PROGRESS: {
    // What a double-click produces: the first request still holds the claim on
    // the key and the second is told to ask again. Nothing is wrong, nothing is
    // duplicated, and the work the backer asked for is already being done — so
    // this is worded as a wait rather than as a failure, and the caller does the
    // waiting rather than putting the sentence on the screen for a state that
    // usually lasts a few hundred milliseconds.
    title: 'Your first attempt is still going',
    detail:
      'The same request is already being carried out. Nothing has been pledged twice, and waiting a moment and asking again is safe.',
    recovery: 'wait-and-retry',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    title: 'This page sent an incomplete request',
    detail:
      'A header this request needs was missing, which is a fault in this site rather than anything you did. Nothing was reserved and no card was involved. Reloading the page is the only thing that will help.',
    recovery: 'none',
    clientBug: true,
  },
  IDEMPOTENCY_KEY_INVALID: {
    title: 'This page sent a malformed request',
    detail:
      'A header this request needs was not in the form the service accepts, which is a fault in this site rather than anything you did. Nothing was reserved and no card was involved. Reloading the page is the only thing that will help.',
    recovery: 'none',
    clientBug: true,
  },
  PLEDGE_MODIFIED: {
    /*
     * §8.4's sweep expiring a draft in the very moment its backer confirms it.
     * The service refuses to report a cause it has inferred rather than
     * observed, so this wording does not claim the hold expired either — it says
     * what is certainly true, and offers the recovery that is right whether the
     * sweep or something else wrote to the pledge.
     */
    title: 'This pledge changed while you were confirming it',
    detail:
      'Something else wrote to it first — most often the five-minute hold running out as you confirmed. Nothing was confirmed and no card was involved. Reserve it again to carry on.',
    recovery: 'redraft',
  },
};

/**
 * Anything a checkout request can throw, as something to render.
 *
 * A thrown value that is not an `ApiError` is a failure to reach the service at
 * all — an offline browser, DNS, a proxy — and it is reported as that rather than
 * as a refusal. The distinction matters here more than anywhere: "the campaign
 * refused your pledge" and "your connection dropped" call for opposite next
 * moves, and only one of them is safe to repeat without thinking.
 */
export function describeFailure(cause: unknown): CheckoutFailure {
  if (!(cause instanceof ApiError)) {
    return {
      code: null,
      status: null,
      title: 'The service could not be reached',
      detail:
        'Nothing was sent, or nothing came back. Check your connection and try again — trying again is safe, and cannot pledge twice.',
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
  const wording = code === null ? undefined : WORDING[code];

  if (wording === undefined) {
    if (cause.status === 401) {
      return {
        code,
        status: cause.status,
        title: 'You are not signed in',
        detail: 'Sign in and start again. Nothing was reserved.',
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
      title: problem?.title ?? 'That did not work',
      detail:
        problem?.detail ??
        'The service refused the request and did not say why. Nothing was reserved.',
      recovery: 'retry',
      alternatives: alternativesIn(problem),
      field: null,
      retireKey: false,
      retryAfterMs: retryAfterMsIn(problem),
      clientBug: false,
    };
  }

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
     */
    detail: wording.detail,
    recovery: wording.recovery,
    alternatives: alternativesIn(problem),
    field: wording.field ?? null,
    retireKey: wording.retireKey ?? false,
    retryAfterMs: retryAfterMsIn(problem),
    clientBug: wording.clientBug ?? false,
  };
}
