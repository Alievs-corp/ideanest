/**
 * Every word the pricing page draws.
 *
 * <h2>Why the whole of it arrives as one prop</h2>
 *
 * `PlanChooser` is a client component and has to be: it reads what this visitor holds after
 * hydration, and buying a plan is a request it makes. It therefore cannot call
 * `getTranslations`. The page is a server component and is the single entry point, so it
 * resolves this object once and hands it down — `lib/i18n/shell-copy.ts` carries the
 * measurement behind the pattern, and a `NextIntlClientProvider` was tried and cost +24.7 KiB
 * on every route in the group.
 *
 * <h2>The exhaustive shape is not ceremony on this page</h2>
 *
 * Two of these strings are the difference between a creator understanding what they bought
 * and not. `pending.body` is the only place anybody is told that a paid plan waits for the
 * platform to record a transfer, and `limits.campaigns` is what says why a submission was
 * refused. A missing key renders its own dotted path in production, so an index signature
 * here would put `pricing.pending.body` on the screen where somebody has just paid money.
 */

/** What one plan card says about a bound. `null` on the wire means no bound at all. */
export interface PlanLimitsCopy {
  /** Carries `{count}`. */
  readonly campaigns: string;
  readonly campaignsUnlimited: string;
  /** Carries `{amount}`, already formatted as money. */
  readonly goalCeiling: string;
  readonly goalUnlimited: string;
}

/** The banner a creator meets when a refused submission sent them here. */
export interface FromSubmitCopy {
  readonly title: string;
  readonly body: string;
  readonly back: string;
  /**
   * The same banner once the plan entitles them, which is the half that was missing.
   *
   * A creator arrives here from a refused submission, chooses a plan, and is then holding
   * everything they came for while still looking at a price list. Saying so and offering the
   * way back is the whole of it — the alternative is a reader who has paid and has to work
   * out for themselves that the thing they were doing is now possible.
   */
  readonly ready: string;
  readonly resume: string;
}

/** What the page says about the plan this visitor already holds. */
export interface HeldCopy {
  readonly heading: string;
  /** Carries `{plan}` and `{date}`. */
  readonly activeUntil: string;
  /** Carries `{plan}`. */
  readonly pendingTitle: string;
  readonly pendingBody: string;
  readonly pendingChange: string;
  /** Carries `{plan}` and `{date}`. */
  readonly endingOn: string;
  /** Carries `{plan}` and `{date}`. */
  readonly lapsed: string;
  readonly cancel: string;
  readonly cancelling: string;
  readonly withdraw: string;
  readonly currentTag: string;
}

/** What the page says on the way back from the payment provider — #451. */
export interface PlanPaymentReturnCopy {
  readonly waitingTitle: string;
  readonly waitingBody: string;
  readonly paidTitle: string;
  /** Carries `{plan}` and `{date}`. */
  readonly paidBody: string;
  readonly unconfirmedTitle: string;
  readonly unconfirmedBody: string;
  readonly failedTitle: string;
  readonly failedBody: string;
}

/** Paying for a plan by card, and renewing one — #451. */
export interface PlanPaymentCopy {
  /** Carries `{price}`, already formatted as money. */
  readonly payByCard: string;
  /** Carries `{price}`, already formatted as money. */
  readonly renew: string;
  readonly opening: string;
  readonly cardBody: string;
  /** Carries `{plan}` and `{date}`. */
  readonly renewalTitle: string;
  readonly renewalBody: string;
  readonly renewalCancelled: string;
  /** Carries `{date}`. */
  readonly renewsFrom: string;
  readonly returned: PlanPaymentReturnCopy;
}

export interface PricingCopy {
  readonly title: string;
  readonly intro: string;
  readonly loading: string;
  readonly unavailable: string;
  readonly empty: string;
  readonly perMonth: string;
  readonly perYear: string;
  readonly free: string;
  readonly choose: string;
  readonly choosing: string;
  readonly signedOut: string;
  readonly signIn: string;
  readonly limits: PlanLimitsCopy;
  readonly fromSubmit: FromSubmitCopy;
  readonly held: HeldCopy;
  readonly payment: PlanPaymentCopy;
  readonly errors: {
    readonly alreadySubscribed: string;
    readonly notOnSale: string;
    readonly signedOut: string;
    readonly generic: string;
    readonly freePlan: string;
    readonly renewalNotOpen: string;
    readonly lapsed: string;
    readonly notDue: string;
    readonly paymentUnavailable: string;
  };
}

/**
 * The subset of `next-intl`'s translator this module uses.
 *
 * Declared structurally rather than imported, following every other copy module here: the
 * tests build one from a plain object, and depending on the library's own type would make
 * that a cast.
 */
export interface PricingTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

export function pricingCopyFrom(t: PricingTranslator): PricingCopy {
  return {
    title: t('title'),
    intro: t('intro'),
    loading: t('loading'),
    unavailable: t('unavailable'),
    empty: t('empty'),
    perMonth: t('perMonth'),
    perYear: t('perYear'),
    free: t('free'),
    choose: t('choose'),
    choosing: t('choosing'),
    signedOut: t('signedOut'),
    signIn: t('signIn'),
    limits: {
      // `t.raw` for the templates, because `t('key')` on a message holding a placeholder
      // renders the key's own path — `test-copy.ts` refuses it, and this is the four places
      // on the page where a number is filled in.
      campaigns: String(t.raw('limits.campaigns')),
      campaignsUnlimited: t('limits.campaignsUnlimited'),
      goalCeiling: String(t.raw('limits.goalCeiling')),
      goalUnlimited: t('limits.goalUnlimited'),
    },
    fromSubmit: {
      title: t('fromSubmit.title'),
      body: t('fromSubmit.body'),
      back: t('fromSubmit.back'),
      ready: t('fromSubmit.ready'),
      resume: t('fromSubmit.resume'),
    },
    held: {
      heading: t('held.heading'),
      activeUntil: String(t.raw('held.activeUntil')),
      pendingTitle: String(t.raw('held.pendingTitle')),
      pendingBody: t('held.pendingBody'),
      pendingChange: t('held.pendingChange'),
      endingOn: String(t.raw('held.endingOn')),
      lapsed: String(t.raw('held.lapsed')),
      cancel: t('held.cancel'),
      cancelling: t('held.cancelling'),
      withdraw: t('held.withdraw'),
      currentTag: t('held.currentTag'),
    },
    payment: {
      payByCard: String(t.raw('payment.payByCard')),
      renew: String(t.raw('payment.renew')),
      opening: t('payment.opening'),
      cardBody: t('payment.cardBody'),
      renewalTitle: String(t.raw('payment.renewalTitle')),
      renewalBody: t('payment.renewalBody'),
      renewalCancelled: t('payment.renewalCancelled'),
      renewsFrom: String(t.raw('payment.renewsFrom')),
      returned: {
        waitingTitle: t('payment.returned.waitingTitle'),
        waitingBody: t('payment.returned.waitingBody'),
        paidTitle: t('payment.returned.paidTitle'),
        paidBody: String(t.raw('payment.returned.paidBody')),
        unconfirmedTitle: t('payment.returned.unconfirmedTitle'),
        unconfirmedBody: t('payment.returned.unconfirmedBody'),
        failedTitle: t('payment.returned.failedTitle'),
        failedBody: t('payment.returned.failedBody'),
      },
    },
    errors: {
      alreadySubscribed: t('errors.alreadySubscribed'),
      notOnSale: t('errors.notOnSale'),
      signedOut: t('errors.signedOut'),
      generic: t('errors.generic'),
      freePlan: t('errors.freePlan'),
      renewalNotOpen: t('errors.renewalNotOpen'),
      lapsed: t('errors.lapsed'),
      notDue: t('errors.notDue'),
      paymentUnavailable: t('errors.paymentUnavailable'),
    },
  };
}
