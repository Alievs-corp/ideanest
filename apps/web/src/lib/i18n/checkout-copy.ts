import { PLEDGE_FAILURE_CODES, type PledgeFailureCode } from '../pledges/failure';

/**
 * Every word the checkout draws — issue #324.
 *
 * <h2>Why the whole of it arrives as one prop</h2>
 *
 * All six components under `components/checkout` are client components, and they have to be:
 * the reservation clock ticks, the amount field validates as it is typed, the summary
 * recomputes on every choice. None of them can call `getTranslations`.
 *
 * `app/[locale]/projects/[id]/back/page.tsx` is a server component and is the single entry
 * point, so it resolves this object once and hands it to `CheckoutView`, which passes each
 * section down. `lib/i18n/shell-copy.ts` carries the measurement behind the pattern — a
 * `NextIntlClientProvider` was tried and cost +24.7 KiB on every route on the site.
 *
 * <h2>The checkout is the one surface where a translation is a money question</h2>
 *
 * "Nothing is charged unless the campaign reaches its goal" is not decoration; it is the
 * promise §5.1 makes and the single fact a first-time backer most often has wrong. A
 * translation that softened it, or that rendered a key name because somebody added a string
 * in English only, would be a page taking a financial commitment while failing to state its
 * terms. `errors` carries the same weight from the other side: a validation message that does
 * not appear leaves a form that refuses to submit and will not say why.
 *
 * That is why the shape is exhaustive and typed rather than an index signature. A missing
 * key is a compile error here, not a `settings.pages.x.y` on the screen where the money is.
 */
export interface CheckoutCopy {
  readonly title: string;
  readonly progress: string;
  readonly steps: {
    readonly choose: string;
    readonly review: string;
    readonly confirmed: string;
  };
  readonly intro: string;
  readonly loading: string;
  readonly expired: string;
  readonly reserveAgain: string;
  readonly tryAgain: string;
  readonly stillAvailable: string;
  readonly reward: {
    readonly legend: string;
    readonly hint: string;
    readonly none: string;
    readonly noneHint: string;
    readonly soldOut: string;
    readonly inPerson: string;
    readonly digital: string;
    readonly earlyBird: string;
    readonly featured: string;
    readonly chooseOne: string;
    readonly digitalItem: string;
    /** Carries `{month}`; filled by `fillPlaceholders` where the date is known. */
    readonly estimatedDelivery: string;
    readonly postedDomestic: string;
    readonly postedWorldwide: string;
  };
  readonly addons: {
    readonly heading: string;
    readonly intro: string;
    readonly soldOut: string;
  };
  readonly destination: {
    readonly label: string;
    readonly hint: string;
    readonly placeholder: string;
  };
  readonly contribution: {
    readonly legend: string;
    /**
     * The same field when nothing was chosen from the reward list.
     *
     * A legend of its own rather than `legend` reused: with no reward there is no price to
     * compare an amount against, so the question is open rather than a top-up, and the two
     * read differently in every language here.
     */
    readonly legendNoReward: string;
    readonly hint: string;
    /** Carries `{amount}`, formatted against the campaign's currency in the browser. */
    readonly rewardHint: string;
  };
  readonly summary: {
    readonly label: string;
    readonly empty: string;
    readonly pending: string;
    readonly pledge: string;
    readonly addons: string;
    readonly bonus: string;
    readonly delivery: string;
    readonly tax: string;
    readonly total: string;
    /** The three the panel prints on its own lines rather than in the review block. */
    readonly noReward: string;
    readonly yourSupport: string;
    readonly rewardLine: string;
  };
  readonly payment: {
    readonly heading: string;
    readonly none: string;
    readonly body: string;
    readonly later: string;
  };
  readonly anonymous: {
    readonly label: string;
    readonly hint: string;
    readonly shown: string;
    readonly yourName: string;
  };
  readonly reserved: string;
  readonly review: {
    readonly heading: string;
    readonly reward: string;
    readonly addon: string;
    readonly noReward: string;
    readonly deliveredTo: string;
    readonly listedAs: string;
    /** IDN-EXT-01 (#44): that the charge happens on the provider's page, and only if finished. */
    readonly charged: string;
    /** IDN-EXT-01 §9: the 80% rule, stated before the pay control. */
    readonly rule: string;
    readonly change: string;
    readonly reserve: string;
    readonly confirm: string;
    readonly confirming: string;
  };
  /**
   * §22.3's risk statement, stated inside the pledge flow — issue #427.
   *
   * <p>Not in the terms and not behind a link: §22.3's requirement is about what a person
   * saw, and a person did not see what was behind a link. It is drawn above the confirm
   * control on the review step, and `confirm` replaces `review.confirm` so that pressing
   * one control is the acknowledgement — a tick is stronger evidence and is also friction
   * on the platform's single most important conversion, and one action that says what it
   * means beats two that can be clicked past.
   */
  readonly risk: {
    readonly heading: string;
    readonly body: string;
    /** The confirm control's own label, which carries the acceptance. */
    readonly confirm: string;
    /** Shown when the version in force moved while this page was open. */
    readonly stale: string;
  };
  readonly done: {
    /** The title shown when the reward's hold ran out on the review step. */
    readonly expired: string;
  };
  /**
   * IDN-EXT-01 (#44): what the pledge page says to a backer the payment provider sent back.
   * The provider's redirect says which page to return to, not what happened; the pledge's
   * state is the answer, so each pair is chosen by that state.
   */
  readonly returned: {
    readonly paidTitle: string;
    readonly paidBody: string;
    readonly waitingTitle: string;
    readonly waitingBody: string;
    readonly failedTitle: string;
    readonly failedBody: string;
  };
  /** IDN-EXT-01 (#44): a backer disputing a paid pledge while the creator's payout is held. */
  readonly dispute: {
    readonly heading: string;
    readonly intro: string;
    readonly reasonLabel: string;
    readonly reasonHint: string;
    readonly submit: string;
    readonly sending: string;
    readonly cancel: string;
    readonly opened: string;
    readonly windowClosed: string;
    readonly nothing: string;
    readonly failed: string;
  };
  readonly errors: {
    readonly amountMissing: string;
    readonly amountPrecision: string;
    readonly amountTooLarge: string;
    readonly amountTooSmall: string;
    readonly destinationMissing: string;
    readonly totalTooSmall: string;
    /*
     * The five below carry a placeholder — `{minimum}`, `{price}`, `{lines}` — and are
     * PLAIN TEMPLATE STRINGS rather than functions of their value.
     *
     * A function cannot cross the server/client boundary: React serialises props into the
     * flight payload and a closure has nothing to serialise, so a `(price) => string` here
     * would fail `next build` and nothing else. These take simple substitution — no plural,
     * no gender, no ordinal — so `fillPlaceholders` does the work where the value is known,
     * which is in the browser.
     */
    readonly amountMissingMinimum: string;
    readonly amountComma: string;
    readonly amountNotANumber: string;
    readonly belowRewardPrice: string;
    readonly destinationUnpriced: string;
  };
  /** What the SERVICE says no with — #91. `lib/pledges/failure.ts` turns a code into one. */
  readonly failures: PledgeFailureCopy;
}

/** A refusal, as the two halves every alert on these screens renders. */
export interface FailureWording {
  readonly title: string;
  readonly detail: string;
}

/**
 * The twenty refusals the pledge module can meet — issue #91, under epic #78.
 *
 * <h2>Why these are the checkout's copy and not the pledge screens' own</h2>
 *
 * One table, three screens. `lib/pledges/failure.ts` explains why the codes belong to the
 * pledge module rather than to the endpoint that raised them — `PROJECT_NOT_LIVE` from a
 * cancellation means what `PROJECT_NOT_LIVE` from a draft means — and the sentences follow
 * the codes. The checkout, the pledge editor and the pledge manager all already hold a
 * {@link CheckoutCopy}, so this is where they can all reach it without a second accessor.
 *
 * <h2>Why a record over the codes rather than an interface</h2>
 *
 * A code added to `PLEDGE_FAILURE_CODES` without a sentence beside it is then a compile
 * error here, not a refusal that renders an empty alert on the screen where the money is.
 * That is the same argument `CheckoutCopy`'s header makes about being exhaustive and typed,
 * and it matters more for these: a validation message that does not appear leaves a form
 * that will not submit, and a refusal that does not appear leaves a backer who cannot tell
 * whether they were charged.
 */
export interface PledgeFailureCopy {
  /** Not a refusal at all: the service was never reached. */
  readonly unreachable: FailureWording;
  readonly signedOut: FailureWording;
  /**
   * For a code this build has never heard of, AND ONLY WHEN THE SERVICE SENT NO PROSE.
   *
   * Its own `title` and `detail` are preferred where it wrote them — see `describeFailure`,
   * which carries the reasoning: an unknown refusal is one where the service knows something
   * the client does not.
   */
  readonly unknown: FailureWording;
  readonly codes: Readonly<Record<PledgeFailureCode, FailureWording>>;
}

/** Every code's pair, read from `checkout.failures.codes`. */
function failureCopyFrom(t: CheckoutTranslator): PledgeFailureCopy {
  const pair = (path: string): FailureWording => ({
    title: t(`${path}.title`),
    detail: t(`${path}.detail`),
  });

  return {
    unreachable: pair('failures.unreachable'),
    signedOut: pair('failures.signedOut'),
    unknown: pair('failures.unknown'),
    codes: Object.fromEntries(
      PLEDGE_FAILURE_CODES.map((code) => [code, pair(`failures.codes.${code}`)]),
    ) as Readonly<Record<PledgeFailureCode, FailureWording>>,
  };
}

/**
 * `{price}` in a template, replaced with the value.
 *
 * Re-exported rather than defined here since #324. The substitution is not the checkout's —
 * the register form echoes an address, the rate limit says how many minutes are left, and
 * every one of them is a server-resolved sentence being finished in the browser. It lives in
 * `lib/i18n/placeholders.ts` now, and the name is kept exported from this module so that the
 * three call sites in `components/checkout` read as they did.
 *
 * It is deliberately not an ICU formatter, and that reasoning has moved with it.
 */
export { fillPlaceholders } from './placeholders';

/**
 * A message lookup, narrowed to what this builder needs.
 *
 * Taking one rather than calling `getTranslations` keeps this module free of
 * `next-intl/server`, so a component test can build the same object out of `messages/*.json`
 * and assert against the words the checkout will actually draw.
 */
export interface CheckoutTranslator {
  (key: string): string;
  /**
   * The message before ICU formatting.
   *
   * REQUIRED FOR THE FIVE TEMPLATES. `t('errors.belowRewardPrice')` asks the formatter to
   * resolve `{price}`, is given no value for it, and throws — so the key that carries a
   * placeholder has to be read raw and filled where the value exists, in the browser.
   */
  raw(key: string): unknown;
}

export function checkoutCopyFrom(t: CheckoutTranslator): CheckoutCopy {
  return {
    title: t('title'),
    progress: t('progress'),
    steps: {
      choose: t('steps.choose'),
      review: t('steps.review'),
      confirmed: t('steps.confirmed'),
    },
    intro: t('intro'),
    loading: t('loading'),
    expired: t('expired'),
    reserveAgain: t('reserveAgain'),
    tryAgain: t('tryAgain'),
    stillAvailable: t('stillAvailable'),
    reward: {
      legend: t('reward.legend'),
      hint: t('reward.hint'),
      none: t('reward.none'),
      noneHint: t('reward.noneHint'),
      soldOut: t('reward.soldOut'),
      inPerson: t('reward.inPerson'),
      digital: t('reward.digital'),
      earlyBird: t('reward.earlyBird'),
      featured: t('reward.featured'),
      chooseOne: t('reward.chooseOne'),
      digitalItem: t('reward.digitalItem'),
      estimatedDelivery: String(t.raw('reward.estimatedDelivery')),
      postedDomestic: t('reward.postedDomestic'),
      postedWorldwide: t('reward.postedWorldwide'),
    },
    addons: {
      heading: t('addons.heading'),
      intro: t('addons.intro'),
      soldOut: t('addons.soldOut'),
    },
    destination: {
      label: t('destination.label'),
      hint: t('destination.hint'),
      placeholder: t('destination.placeholder'),
    },
    contribution: {
      legend: t('contribution.legend'),
      legendNoReward: t('contribution.legendNoReward'),
      hint: t('contribution.hint'),
      rewardHint: String(t.raw('contribution.rewardHint')),
    },
    summary: {
      label: t('summary.label'),
      empty: t('summary.empty'),
      pending: t('summary.pending'),
      pledge: t('summary.pledge'),
      addons: t('summary.addons'),
      bonus: t('summary.bonus'),
      delivery: t('summary.delivery'),
      tax: t('summary.tax'),
      total: t('summary.total'),
      noReward: t('summary.noReward'),
      yourSupport: t('summary.yourSupport'),
      rewardLine: t('summary.rewardLine'),
    },
    payment: {
      heading: t('payment.heading'),
      none: t('payment.none'),
      body: t('payment.body'),
      later: t('payment.later'),
    },
    anonymous: {
      label: t('anonymous.label'),
      hint: t('anonymous.hint'),
      shown: t('anonymous.shown'),
      yourName: t('anonymous.yourName'),
    },
    reserved: t('reserved'),
    review: {
      heading: t('review.heading'),
      reward: t('review.reward'),
      addon: t('review.addon'),
      noReward: t('review.noReward'),
      deliveredTo: t('review.deliveredTo'),
      listedAs: t('review.listedAs'),
      charged: t('review.charged'),
      rule: t('review.rule'),
      change: t('review.change'),
      reserve: t('review.reserve'),
      confirm: t('review.confirm'),
      confirming: t('review.confirming'),
    },
    risk: {
      heading: t('risk.heading'),
      body: t('risk.body'),
      confirm: t('risk.confirm'),
      stale: t('risk.stale'),
    },
    done: {
      expired: t('done.expired'),
    },
    returned: {
      paidTitle: t('returned.paidTitle'),
      paidBody: t('returned.paidBody'),
      waitingTitle: t('returned.waitingTitle'),
      waitingBody: t('returned.waitingBody'),
      failedTitle: t('returned.failedTitle'),
      failedBody: t('returned.failedBody'),
    },
    dispute: {
      heading: t('dispute.heading'),
      intro: t('dispute.intro'),
      reasonLabel: t('dispute.reasonLabel'),
      reasonHint: t('dispute.reasonHint'),
      submit: t('dispute.submit'),
      sending: t('dispute.sending'),
      cancel: t('dispute.cancel'),
      opened: t('dispute.opened'),
      windowClosed: t('dispute.windowClosed'),
      nothing: t('dispute.nothing'),
      failed: t('dispute.failed'),
    },
    errors: {
      amountMissing: t('errors.amountMissing'),
      amountPrecision: t('errors.amountPrecision'),
      amountTooLarge: t('errors.amountTooLarge'),
      amountTooSmall: t('errors.amountTooSmall'),
      destinationMissing: t('errors.destinationMissing'),
      totalTooSmall: t('errors.totalTooSmall'),
      amountMissingMinimum: String(t.raw('errors.amountMissingMinimum')),
      /* No placeholder in these two, but read the same way so the five stay one group. */
      amountComma: t('errors.amountComma'),
      amountNotANumber: t('errors.amountNotANumber'),
      belowRewardPrice: String(t.raw('errors.belowRewardPrice')),
      destinationUnpriced: String(t.raw('errors.destinationUnpriced')),
    },
    failures: failureCopyFrom(t),
  };
}
