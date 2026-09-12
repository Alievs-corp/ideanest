/**
 * Every word the authentication screens draw — issue #324, docs/architecture.md §21.1.
 *
 * <h2>Why the copy arrives as a prop rather than a hook</h2>
 *
 * All eight components under `components/auth` are client components and have to be: they
 * hold a password in state, they read `?next=`, they swap a form for a challenge, they run an
 * effect that spends a single-use token exactly once. None of them can call `getTranslations`.
 *
 * `useTranslations` would need a `NextIntlClientProvider` above them, and `lib/i18n/shell-copy.ts`
 * carries what this repository measured that to cost — up to **27.4 KiB on every route in a
 * group**, paid by routes that render none of the words. So the six pages under
 * `app/[locale]/(auth)` resolve the copy on the server, once, and hand each component a plain
 * object. `lib/i18n/checkout-copy.ts` is the same move for the checkout and states the same
 * measurement.
 *
 * <h2>The failure vocabulary is separate, and every screen carries it</h2>
 *
 * `lib/auth/failures.ts` turns a refusal into a heading and a sentence, and it is reached from
 * eight components including the two credential panels in `components/settings`. It is a pure
 * function of an error and cannot look a message up, so its **fallbacks arrive as an argument**
 * — see `AuthFailuresCopy`. Making that argument required rather than optional is deliberate:
 * an optional one would leave a screen quietly answering in English, in the one place where
 * somebody is already stuck.
 *
 * The refusals themselves are still the service's own sentences wherever it wrote one (§10.4).
 * What is here is what the client says when the service said nothing — a network that never
 * reached it, a body that was not the JSON it claimed to be, a status with no problem
 * document.
 *
 * <h2>The shapes are exhaustive rather than an index signature</h2>
 *
 * `checkout-copy.ts` gives the reason and it holds here: a missing key should be a compile
 * error, not a `auth.signIn.submit` printed on the button somebody has to press to get into
 * their account.
 */

/**
 * A message lookup rooted at `auth`, narrowed to what these builders need.
 *
 * `raw` is next-intl's escape hatch for a message that is not to be formatted here, and the
 * builders below use it for every sentence carrying a placeholder. `t('x')` on such a message
 * is a formatting error — next-intl has no value for the argument, calls `onError` and renders
 * the key's own path — so a template is read raw and `fillPlaceholders` fills it in the
 * component, where the address or the number of minutes is actually known.
 */
export interface AuthTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/* -------------------------------------------------------------------------
 * Shared vocabularies
 * ---------------------------------------------------------------------- */

/**
 * What a refusal is called when the service did not name it — `lib/auth/failures.ts`.
 *
 * `retryAfter`, `waitUnderMinute`, `waitOneMinute` and `waitMinutes` build one sentence
 * between them, and they are four keys rather than one because §17.3's rate limit is reported
 * as a number of seconds that only the browser has. `{minutes}` and `{wait}` are filled by
 * `fillPlaceholders`.
 */
export interface AuthFailuresCopy {
  readonly unexpectedTitle: string;
  readonly unexpectedDetail: string;
  readonly unreachableTitle: string;
  readonly unreachableDetail: string;
  readonly suspendedTitle: string;
  readonly suspendedDetail: string;
  readonly rateLimitedTitle: string;
  readonly rateLimitedDetail: string;
  readonly rateLimitedShort: string;
  /** Carries `{detail}` and `{wait}`. */
  readonly retryAfter: string;
  readonly waitUnderMinute: string;
  readonly waitOneMinute: string;
  /** Carries `{minutes}`. */
  readonly waitMinutes: string;
  readonly refusedTitle: string;
  readonly refusedDetail: string;
}

/**
 * The three fields more than one of these forms asks for.
 *
 * `showPassword` and `hidePassword` are the reveal toggle's accessible name in each of its
 * two states. They live here rather than in the component because `@ideanest/ui` carries no
 * catalogue — its English defaults are there so the component works standing alone, not so
 * that an Azerbaijani sign-in form announces a button in English.
 */
export interface AuthFieldsCopy {
  readonly email: string;
  readonly emailPlaceholder: string;
  readonly password: string;
  readonly passwordHint: string;
  readonly showPassword: string;
  readonly hidePassword: string;
}

/** §4.1's A-04 and A-05 — the Google and Apple controls. */
export interface ProvidersCopy {
  readonly separatorLabel: string;
  readonly or: string;
  readonly appleSignIn: string;
  readonly appleRegister: string;
  readonly failures: AuthFailuresCopy;
}

/** §4.1's A-07 and A-08 — the step between a password and a session. */
export interface TwoFactorCopy {
  readonly expiredTitle: string;
  readonly expiredDetail: string;
  readonly signInAgain: string;
  readonly acceptedTitle: string;
  readonly acceptedDetail: string;
  readonly codeLabel: string;
  readonly codePlaceholder: string;
  readonly cannotReach: string;
  readonly recoveryLabel: string;
  readonly recoveryHint: string;
  readonly submit: string;
  readonly submitting: string;
  readonly differentAccount: string;
  readonly failures: AuthFailuresCopy;
}

/* -------------------------------------------------------------------------
 * One shape per screen
 * ---------------------------------------------------------------------- */

export interface SignInCopy {
  readonly title: string;
  readonly intro: string;
  readonly submit: string;
  readonly submitting: string;
  readonly forgot: string;
  readonly noAccount: string;
  readonly createOne: string;
  readonly passwordChangedTitle: string;
  readonly passwordChangedDetail: string;
  readonly fields: AuthFieldsCopy;
  readonly failures: AuthFailuresCopy;
  readonly providers: ProvidersCopy;
  readonly twoFactor: TwoFactorCopy;
}

export interface RegisterCopy {
  readonly title: string;
  readonly intro: string;
  readonly name: string;
  readonly nameHint: string;
  readonly submit: string;
  readonly submitting: string;
  readonly haveAccount: string;
  readonly signIn: string;
  readonly twoFactorTitle: string;
  readonly twoFactorIntro: string;
  readonly sentTitle: string;
  /** Carries `{address}`; the reader's own, echoed because a typo is why nothing arrives. */
  readonly sentIntro: string;
  readonly sentLifetime: string;
  readonly sentExisting: string;
  readonly verified: string;
  readonly fields: AuthFieldsCopy;
  readonly failures: AuthFailuresCopy;
  readonly providers: ProvidersCopy;
  readonly twoFactor: TwoFactorCopy;
}

export interface PasswordResetCopy {
  readonly title: string;
  readonly intro: string;
  readonly submit: string;
  readonly submitting: string;
  readonly remembered: string;
  readonly signIn: string;
  readonly sentTitle: string;
  /** Carries `{address}`. */
  readonly sentIntro: string;
  /** Carries `{lifetime}`. */
  readonly sentLifetime: string;
  /** Carries `{retry}`, which is a control rather than a word — `fillNodes` fills it. */
  readonly sentRetry: string;
  readonly tryAnother: string;
  readonly backToSignIn: string;
  readonly lifetime: string;
  readonly fields: AuthFieldsCopy;
  readonly failures: AuthFailuresCopy;
}

export interface PasswordResetConfirmCopy {
  readonly title: string;
  /** Carries `{lifetime}`. */
  readonly intro: string;
  readonly newPassword: string;
  readonly repeat: string;
  readonly repeatHint: string;
  readonly submit: string;
  readonly submitting: string;
  readonly mismatchTitle: string;
  readonly mismatchDetail: string;
  readonly mismatchField: string;
  readonly refusedPassword: string;
  readonly noTokenTitle: string;
  readonly noTokenIntro: string;
  readonly askForLink: string;
  readonly deadTitle: string;
  readonly deadAlertTitle: string;
  readonly deadFallback: string;
  /** Carries `{lifetime}`. */
  readonly deadExplain: string;
  readonly askNewLink: string;
  readonly askNewInstead: string;
  readonly doneTitle: string;
  readonly doneIntro: string;
  readonly signIn: string;
  readonly lifetime: string;
  readonly passwordHint: string;
  readonly failures: AuthFailuresCopy;
}

export interface VerifyEmailCopy {
  readonly statusVerifying: string;
  readonly statusVerified: string;
  readonly statusFailed: string;
  readonly idleTitle: string;
  readonly idleIntro: string;
  readonly verifyingTitle: string;
  readonly verifyingIntro: string;
  readonly verifiedTitle: string;
  readonly verifiedIntro: string;
  readonly failedTitle: string;
  readonly failedExplain: string;
  readonly signIn: string;
  readonly createAccount: string;
  readonly home: string;
  readonly failures: AuthFailuresCopy;
}

export interface EmailChangeCopy {
  readonly statusConfirming: string;
  readonly statusConfirmed: string;
  readonly statusTaken: string;
  readonly statusRefused: string;
  readonly idleTitle: string;
  readonly idleIntro: string;
  readonly confirmingTitle: string;
  readonly confirmingIntro: string;
  readonly confirmedTitle: string;
  readonly confirmedIntro: string;
  readonly goToAccount: string;
  readonly takenTitle: string;
  readonly takenAlertTitle: string;
  readonly takenFallback: string;
  readonly takenExplain: string;
  readonly takenNotSpent: string;
  readonly refusedTitle: string;
  readonly refusedAlertTitle: string;
  readonly refusedFallback: string;
  readonly refusedExplain: string;
  readonly emailSettings: string;
  readonly signIn: string;
  readonly failures: AuthFailuresCopy;
}

/* -------------------------------------------------------------------------
 * The builders
 * ---------------------------------------------------------------------- */

export function authFailuresCopyFrom(t: AuthTranslator): AuthFailuresCopy {
  return {
    unexpectedTitle: t('failures.unexpectedTitle'),
    unexpectedDetail: t('failures.unexpectedDetail'),
    unreachableTitle: t('failures.unreachableTitle'),
    unreachableDetail: t('failures.unreachableDetail'),
    suspendedTitle: t('failures.suspendedTitle'),
    suspendedDetail: t('failures.suspendedDetail'),
    rateLimitedTitle: t('failures.rateLimitedTitle'),
    rateLimitedDetail: t('failures.rateLimitedDetail'),
    rateLimitedShort: t('failures.rateLimitedShort'),
    retryAfter: String(t.raw('failures.retryAfter')),
    waitUnderMinute: t('failures.waitUnderMinute'),
    waitOneMinute: t('failures.waitOneMinute'),
    waitMinutes: String(t.raw('failures.waitMinutes')),
    refusedTitle: t('failures.refusedTitle'),
    refusedDetail: t('failures.refusedDetail'),
  };
}

function fieldsCopyFrom(t: AuthTranslator): AuthFieldsCopy {
  return {
    email: t('fields.email'),
    emailPlaceholder: t('fields.emailPlaceholder'),
    password: t('fields.password'),
    passwordHint: t('fields.passwordHint'),
    showPassword: t('fields.showPassword'),
    hidePassword: t('fields.hidePassword'),
  };
}

export function providersCopyFrom(t: AuthTranslator): ProvidersCopy {
  return {
    separatorLabel: t('providers.separatorLabel'),
    or: t('providers.or'),
    appleSignIn: t('providers.appleSignIn'),
    appleRegister: t('providers.appleRegister'),
    failures: authFailuresCopyFrom(t),
  };
}

export function twoFactorCopyFrom(t: AuthTranslator): TwoFactorCopy {
  return {
    expiredTitle: t('twoFactor.expiredTitle'),
    expiredDetail: t('twoFactor.expiredDetail'),
    signInAgain: t('twoFactor.signInAgain'),
    acceptedTitle: t('twoFactor.acceptedTitle'),
    acceptedDetail: t('twoFactor.acceptedDetail'),
    codeLabel: t('twoFactor.codeLabel'),
    codePlaceholder: t('twoFactor.codePlaceholder'),
    cannotReach: t('twoFactor.cannotReach'),
    recoveryLabel: t('twoFactor.recoveryLabel'),
    recoveryHint: t('twoFactor.recoveryHint'),
    submit: t('twoFactor.submit'),
    submitting: t('twoFactor.submitting'),
    differentAccount: t('twoFactor.differentAccount'),
    failures: authFailuresCopyFrom(t),
  };
}

export function signInCopyFrom(t: AuthTranslator): SignInCopy {
  return {
    title: t('signIn.title'),
    intro: t('signIn.intro'),
    submit: t('signIn.submit'),
    submitting: t('signIn.submitting'),
    forgot: t('signIn.forgot'),
    noAccount: t('signIn.noAccount'),
    createOne: t('signIn.createOne'),
    passwordChangedTitle: t('signIn.passwordChangedTitle'),
    passwordChangedDetail: t('signIn.passwordChangedDetail'),
    fields: fieldsCopyFrom(t),
    failures: authFailuresCopyFrom(t),
    providers: providersCopyFrom(t),
    twoFactor: twoFactorCopyFrom(t),
  };
}

export function registerCopyFrom(t: AuthTranslator): RegisterCopy {
  return {
    title: t('register.title'),
    intro: t('register.intro'),
    name: t('register.name'),
    nameHint: t('register.nameHint'),
    submit: t('register.submit'),
    submitting: t('register.submitting'),
    haveAccount: t('register.haveAccount'),
    signIn: t('register.signIn'),
    twoFactorTitle: t('register.twoFactorTitle'),
    twoFactorIntro: t('register.twoFactorIntro'),
    sentTitle: t('register.sentTitle'),
    sentIntro: String(t.raw('register.sentIntro')),
    sentLifetime: t('register.sentLifetime'),
    sentExisting: t('register.sentExisting'),
    verified: t('register.verified'),
    fields: fieldsCopyFrom(t),
    failures: authFailuresCopyFrom(t),
    providers: providersCopyFrom(t),
    twoFactor: twoFactorCopyFrom(t),
  };
}

export function passwordResetCopyFrom(t: AuthTranslator): PasswordResetCopy {
  return {
    title: t('reset.title'),
    intro: t('reset.intro'),
    submit: t('reset.submit'),
    submitting: t('reset.submitting'),
    remembered: t('reset.remembered'),
    signIn: t('reset.signIn'),
    sentTitle: t('reset.sentTitle'),
    sentIntro: String(t.raw('reset.sentIntro')),
    sentLifetime: String(t.raw('reset.sentLifetime')),
    sentRetry: String(t.raw('reset.sentRetry')),
    tryAnother: t('reset.tryAnother'),
    backToSignIn: t('reset.backToSignIn'),
    lifetime: t('reset.lifetime'),
    fields: fieldsCopyFrom(t),
    failures: authFailuresCopyFrom(t),
  };
}

export function passwordResetConfirmCopyFrom(t: AuthTranslator): PasswordResetConfirmCopy {
  return {
    title: t('resetConfirm.title'),
    intro: String(t.raw('resetConfirm.intro')),
    newPassword: t('resetConfirm.newPassword'),
    repeat: t('resetConfirm.repeat'),
    repeatHint: t('resetConfirm.repeatHint'),
    submit: t('resetConfirm.submit'),
    submitting: t('resetConfirm.submitting'),
    mismatchTitle: t('resetConfirm.mismatchTitle'),
    mismatchDetail: t('resetConfirm.mismatchDetail'),
    mismatchField: t('resetConfirm.mismatchField'),
    refusedPassword: t('resetConfirm.refusedPassword'),
    noTokenTitle: t('resetConfirm.noTokenTitle'),
    noTokenIntro: t('resetConfirm.noTokenIntro'),
    askForLink: t('resetConfirm.askForLink'),
    deadTitle: t('resetConfirm.deadTitle'),
    deadAlertTitle: t('resetConfirm.deadAlertTitle'),
    deadFallback: t('resetConfirm.deadFallback'),
    deadExplain: String(t.raw('resetConfirm.deadExplain')),
    askNewLink: t('resetConfirm.askNewLink'),
    askNewInstead: t('resetConfirm.askNewInstead'),
    doneTitle: t('resetConfirm.doneTitle'),
    doneIntro: t('resetConfirm.doneIntro'),
    signIn: t('resetConfirm.signIn'),
    /*
     * The lifetime is read from `reset` rather than restated here. It is one fact about one
     * link, said on two screens, and `lib/auth/passwordReset.ts` kept it as a single constant
     * for exactly that reason before the catalogue existed.
     */
    lifetime: t('reset.lifetime'),
    passwordHint: t('fields.passwordHint'),
    failures: authFailuresCopyFrom(t),
  };
}

export function verifyEmailCopyFrom(t: AuthTranslator): VerifyEmailCopy {
  return {
    statusVerifying: t('verifyEmail.statusVerifying'),
    statusVerified: t('verifyEmail.statusVerified'),
    statusFailed: t('verifyEmail.statusFailed'),
    idleTitle: t('verifyEmail.idleTitle'),
    idleIntro: t('verifyEmail.idleIntro'),
    verifyingTitle: t('verifyEmail.verifyingTitle'),
    verifyingIntro: t('verifyEmail.verifyingIntro'),
    verifiedTitle: t('verifyEmail.verifiedTitle'),
    verifiedIntro: t('verifyEmail.verifiedIntro'),
    failedTitle: t('verifyEmail.failedTitle'),
    failedExplain: t('verifyEmail.failedExplain'),
    signIn: t('verifyEmail.signIn'),
    createAccount: t('verifyEmail.createAccount'),
    home: t('verifyEmail.home'),
    failures: authFailuresCopyFrom(t),
  };
}

export function emailChangeCopyFrom(t: AuthTranslator): EmailChangeCopy {
  return {
    statusConfirming: t('emailChange.statusConfirming'),
    statusConfirmed: t('emailChange.statusConfirmed'),
    statusTaken: t('emailChange.statusTaken'),
    statusRefused: t('emailChange.statusRefused'),
    idleTitle: t('emailChange.idleTitle'),
    idleIntro: t('emailChange.idleIntro'),
    confirmingTitle: t('emailChange.confirmingTitle'),
    confirmingIntro: t('emailChange.confirmingIntro'),
    confirmedTitle: t('emailChange.confirmedTitle'),
    confirmedIntro: t('emailChange.confirmedIntro'),
    goToAccount: t('emailChange.goToAccount'),
    takenTitle: t('emailChange.takenTitle'),
    takenAlertTitle: t('emailChange.takenAlertTitle'),
    takenFallback: t('emailChange.takenFallback'),
    takenExplain: t('emailChange.takenExplain'),
    takenNotSpent: t('emailChange.takenNotSpent'),
    refusedTitle: t('emailChange.refusedTitle'),
    refusedAlertTitle: t('emailChange.refusedAlertTitle'),
    refusedFallback: t('emailChange.refusedFallback'),
    refusedExplain: t('emailChange.refusedExplain'),
    emailSettings: t('emailChange.emailSettings'),
    signIn: t('emailChange.signIn'),
    failures: authFailuresCopyFrom(t),
  };
}
