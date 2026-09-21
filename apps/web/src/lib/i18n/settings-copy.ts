import { type AuthFailuresCopy, type AuthTranslator, authFailuresCopyFrom } from './auth-copy';
import type { PluralForms } from './plurals';

/**
 * The two credential panels under `/settings` — issue #324.
 *
 * <h2>Why these two and not the other eleven</h2>
 *
 * `EmailChangePanel` and `PasswordChangePanel` are the panels that call
 * `describeAuthFailure`, and #324 made its fallback vocabulary a required argument rather than
 * an optional one — a screen that quietly answered in English at the moment somebody is locked
 * out is the defect that change exists to prevent. Threading the failures alone would have
 * left two panels whose refusal is Azerbaijani and whose field labels are English, which is a
 * worse page than either. So both are taken whole.
 *
 * The rest of the account panels are still English literals; `apps/web/README.md` records
 * which, and each is the same shape of work.
 *
 * <h2>Two translators, and the second one is not an accident</h2>
 *
 * The builders take the panel's own namespace and `auth` as well. Two sentences belong to the
 * authentication vocabulary rather than to a settings screen: the password policy hint, which
 * `RegisterForm` and `/reset-password/confirm` print in the same words, and the refusal
 * vocabulary. Copying either into `settings.panels` would give the catalogue two spellings of
 * one fact and no way to notice when they drifted.
 */

export interface EmailChangePanelCopy {
  readonly heading: string;
  /** Carries `{address}`. */
  readonly signInWith: string;
  /** Carries `{address}`. */
  readonly signInWithUnverified: string;
  readonly alertTitle: string;
  readonly alertBody: string;
  readonly currentPassword: string;
  readonly currentPasswordHint: string;
  readonly newEmail: string;
  readonly emailPlaceholder: string;
  readonly submit: string;
  readonly submitting: string;
  /** Carries `{address}`. */
  readonly sentIntro: string;
  readonly nothingChanged: string;
  /** Carries `{address}`. */
  readonly stillSignIn: string;
  readonly stillSignInUnknown: string;
  readonly alsoWrote: string;
  readonly askDifferent: string;
  readonly failures: AuthFailuresCopy;
}

export interface PasswordChangePanelCopy {
  readonly heading: string;
  readonly alertTitle: string;
  readonly alertBody: string;
  readonly currentPassword: string;
  readonly currentPasswordHint: string;
  readonly newPassword: string;
  readonly newPasswordHint: string;
  readonly repeat: string;
  readonly repeatHint: string;
  readonly submit: string;
  readonly submitting: string;
  readonly mismatchTitle: string;
  readonly mismatchDetail: string;
  readonly mismatchField: string;
  readonly failures: AuthFailuresCopy;
}

export function emailChangePanelCopyFrom(
  t: AuthTranslator,
  auth: AuthTranslator,
): EmailChangePanelCopy {
  return {
    heading: t('emailChange.heading'),
    signInWith: String(t.raw('emailChange.signInWith')),
    signInWithUnverified: String(t.raw('emailChange.signInWithUnverified')),
    alertTitle: t('emailChange.alertTitle'),
    alertBody: t('emailChange.alertBody'),
    currentPassword: t('emailChange.currentPassword'),
    currentPasswordHint: t('emailChange.currentPasswordHint'),
    newEmail: t('emailChange.newEmail'),
    emailPlaceholder: auth('fields.emailPlaceholder'),
    submit: t('emailChange.submit'),
    submitting: t('emailChange.submitting'),
    sentIntro: String(t.raw('emailChange.sentIntro')),
    nothingChanged: t('emailChange.nothingChanged'),
    stillSignIn: String(t.raw('emailChange.stillSignIn')),
    stillSignInUnknown: t('emailChange.stillSignInUnknown'),
    alsoWrote: t('emailChange.alsoWrote'),
    askDifferent: t('emailChange.askDifferent'),
    failures: authFailuresCopyFrom(auth),
  };
}

export function passwordChangePanelCopyFrom(
  t: AuthTranslator,
  auth: AuthTranslator,
): PasswordChangePanelCopy {
  return {
    heading: t('passwordChange.heading'),
    alertTitle: t('passwordChange.alertTitle'),
    alertBody: t('passwordChange.alertBody'),
    currentPassword: t('passwordChange.currentPassword'),
    currentPasswordHint: t('passwordChange.currentPasswordHint'),
    newPassword: t('passwordChange.newPassword'),
    /* The policy sentence, shared with the register form and the reset — see the file note. */
    newPasswordHint: auth('fields.passwordHint'),
    repeat: t('passwordChange.repeat'),
    repeatHint: t('passwordChange.repeatHint'),
    submit: t('passwordChange.submit'),
    submitting: t('passwordChange.submitting'),
    mismatchTitle: t('passwordChange.mismatchTitle'),
    mismatchDetail: t('passwordChange.mismatchDetail'),
    mismatchField: t('passwordChange.mismatchField'),
    failures: authFailuresCopyFrom(auth),
  };
}

/* -------------------------------------------------------------------------
 * The three panels somebody secures or closes an account with — issue #80, epic #78
 *
 * <h2>Why these arrived after the other two, and why they look the same</h2>
 *
 * `EmailChangePanel` and `PasswordChangePanel` were translated alongside the authentication
 * screens because they call `describeAuthFailure` and #324 made its vocabulary required. The
 * three below were left, which meant `/settings/security` and `/settings/privacy` drew an
 * Azerbaijani heading over an English panel. They take the same pair of translators for the
 * same reason: the refusals they share with the six authentication routes — "That did not
 * work", "The service could not be reached" — have one spelling in `auth.failures`, and a
 * second copy under `settings.panels` would be two sentences that agree until one is edited.
 *
 * <h2>This is the highest-consequence group in the epic, and not the largest</h2>
 *
 * "This is the only time these are shown" is the sentence standing between somebody and a
 * permanently locked account: there is no re-issue endpoint for a recovery code, so a reader
 * who cannot read that warning closes the panel and loses the codes. The closure panel is the
 * same thing from the other side — an irreversible action, and the grace period before it.
 * Both are worth the extra keys that keep their emphasis in place rather than splitting a
 * sentence in half around a `<strong>`.
 * ---------------------------------------------------------------------- */

/** §4.1's A-07 — enrolling, seeing the recovery codes once, and switching it off. */
export interface TwoFactorPanelCopy {
  readonly heading: string;
  readonly passwordHeading: string;
  readonly scanHeading: string;
  readonly codesHeading: string;
  readonly disableHeading: string;
  /** Titles the alert carrying the service's own sentence. */
  readonly fromService: string;
  /** Carries `{emphasis}`, which is drawn as its own element. */
  readonly intro: string;
  readonly introEmphasis: string;
  readonly setUp: string;
  readonly turnOff: string;
  readonly bothOffered: string;
  readonly passwordIntro: string;
  readonly currentPassword: string;
  readonly checking: string;
  readonly continue: string;
  readonly cancel: string;
  /** Carries `{emphasis}`. */
  readonly scanIntro: string;
  readonly scanIntroEmphasis: string;
  readonly onThisDevice: string;
  readonly openApp: string;
  readonly byHand: string;
  /** Carries `{digits}`, `{seconds}` and `{algorithm}`, all read off the enrolment. */
  readonly parameters: string;
  readonly codeLabel: string;
  readonly codePlaceholder: string;
  readonly confirming: string;
  readonly switchOn: string;
  readonly codesWarningTitle: string;
  readonly codesWarningBody: string;
  readonly acknowledge: string;
  readonly done: string;
  readonly enabledNotice: string;
  /** Carries `{emphasis}`. */
  readonly disableIntro: string;
  readonly disableIntroEmphasis: string;
  readonly recoveryLabel: string;
  readonly recoveryHint: string;
  readonly turningOff: string;
  /**
   * What the panel says when the service refuses an enrolment that is already confirmed.
   *
   * The service's own sentence for this is an English literal in
   * `TwoFactorEnrolmentService`, not a key in its message bundle, so printing what arrived
   * would put one English sentence inside a translated panel. `TwoFactorPanel` records how
   * it recognises the refusal, and why that recognition is prose rather than a `code`.
   */
  readonly alreadyEnabled: string;
  readonly disabledNotice: string;
  readonly failures: AuthFailuresCopy;
}

export function twoFactorPanelCopyFrom(
  t: AuthTranslator,
  auth: AuthTranslator,
): TwoFactorPanelCopy {
  return {
    heading: t('twoFactor.heading'),
    passwordHeading: t('twoFactor.passwordHeading'),
    scanHeading: t('twoFactor.scanHeading'),
    codesHeading: t('twoFactor.codesHeading'),
    disableHeading: t('twoFactor.disableHeading'),
    fromService: t('twoFactor.fromService'),
    intro: String(t.raw('twoFactor.intro')),
    introEmphasis: t('twoFactor.introEmphasis'),
    setUp: t('twoFactor.setUp'),
    turnOff: t('twoFactor.turnOff'),
    bothOffered: t('twoFactor.bothOffered'),
    passwordIntro: t('twoFactor.passwordIntro'),
    currentPassword: t('twoFactor.currentPassword'),
    checking: t('twoFactor.checking'),
    continue: t('twoFactor.continue'),
    cancel: t('twoFactor.cancel'),
    scanIntro: String(t.raw('twoFactor.scanIntro')),
    scanIntroEmphasis: t('twoFactor.scanIntroEmphasis'),
    onThisDevice: t('twoFactor.onThisDevice'),
    openApp: t('twoFactor.openApp'),
    byHand: t('twoFactor.byHand'),
    parameters: String(t.raw('twoFactor.parameters')),
    codeLabel: t('twoFactor.codeLabel'),
    codePlaceholder: t('twoFactor.codePlaceholder'),
    confirming: t('twoFactor.confirming'),
    switchOn: t('twoFactor.switchOn'),
    codesWarningTitle: t('twoFactor.codesWarningTitle'),
    codesWarningBody: t('twoFactor.codesWarningBody'),
    acknowledge: t('twoFactor.acknowledge'),
    done: t('twoFactor.done'),
    enabledNotice: t('twoFactor.enabledNotice'),
    disableIntro: String(t.raw('twoFactor.disableIntro')),
    disableIntroEmphasis: t('twoFactor.disableIntroEmphasis'),
    recoveryLabel: t('twoFactor.recoveryLabel'),
    recoveryHint: t('twoFactor.recoveryHint'),
    turningOff: t('twoFactor.turningOff'),
    alreadyEnabled: t('twoFactor.alreadyEnabled'),
    disabledNotice: t('twoFactor.disabledNotice'),
    failures: authFailuresCopyFrom(auth),
  };
}

/** §4.1's A-10 — closing an account, with the thirty-day delay stated as a date. */
export interface AccountClosurePanelCopy {
  readonly heading: string;
  readonly goneTitle: string;
  readonly goneBody: string;
  readonly scheduledTitle: string;
  /** Carries `{date}`, which is a `<strong>` rather than a string. */
  readonly scheduledBody: string;
  readonly cancelling: string;
  readonly keep: string;
  readonly notImmediate: string;
  readonly recordsKept: string;
  readonly currentPassword: string;
  readonly understood: string;
  readonly scheduling: string;
  readonly close: string;
  readonly rateLimited: string;
  readonly failures: AuthFailuresCopy;
}

export function accountClosurePanelCopyFrom(
  t: AuthTranslator,
  auth: AuthTranslator,
): AccountClosurePanelCopy {
  return {
    heading: t('closure.heading'),
    goneTitle: t('closure.goneTitle'),
    goneBody: t('closure.goneBody'),
    scheduledTitle: t('closure.scheduledTitle'),
    scheduledBody: String(t.raw('closure.scheduledBody')),
    cancelling: t('closure.cancelling'),
    keep: t('closure.keep'),
    notImmediate: t('closure.notImmediate'),
    recordsKept: t('closure.recordsKept'),
    currentPassword: t('closure.currentPassword'),
    understood: t('closure.understood'),
    scheduling: t('closure.scheduling'),
    close: t('closure.close'),
    rateLimited: t('closure.rateLimited'),
    failures: authFailuresCopyFrom(auth),
  };
}

/** §4.1's A-11 — a machine-readable copy of the account. */
export interface DataExportPanelCopy {
  readonly heading: string;
  readonly intro: string;
  readonly errorTitle: string;
  readonly rateLimited: string;
  readonly refused: string;
  readonly savedTitle: string;
  /** Carries `{filename}`, which is drawn as `<code>`. */
  readonly savedBody: string;
  readonly preparing: string;
  readonly download: string;
  readonly failures: AuthFailuresCopy;
}

export function dataExportPanelCopyFrom(
  t: AuthTranslator,
  auth: AuthTranslator,
): DataExportPanelCopy {
  return {
    heading: t('export.heading'),
    intro: t('export.intro'),
    errorTitle: t('export.errorTitle'),
    rateLimited: t('export.rateLimited'),
    refused: t('export.refused'),
    savedTitle: t('export.savedTitle'),
    savedBody: String(t.raw('export.savedBody')),
    preparing: t('export.preparing'),
    download: t('export.download'),
    failures: authFailuresCopyFrom(auth),
  };
}

/** One device in the list. Its own object, because `SessionRow` is rendered without the panel. */
export interface SessionRowCopy {
  readonly thisDevice: string;
  /** What a session with neither a label nor a recognisable agent is called. */
  readonly unknownDevice: string;
  /** Carries {browser} and {platform}. The preposition two of the four languages invert. */
  readonly onPlatform: string;
  readonly noDetails: string;
  /** Carries `{seen}` and `{created}`, both `<time>` elements. */
  readonly lastActive: string;
  readonly signOut: string;
  readonly signingOut: string;
  /** Carries `{device}`. The accessible name — the visible label is the same on every row. */
  readonly signOutLabel: string;
  /** Carries `{device}`. */
  readonly signingOutLabel: string;
  readonly signOutThisLabel: string;
  readonly signingOutThisLabel: string;
}

/** §4.1's A-09 — the device list, and the two ways out of it. */
export interface SessionsPanelCopy {
  readonly signedOutTitle: string;
  readonly signedOutBody: string;
  readonly heading: string;
  readonly signOutEverywhere: string;
  readonly errorTitle: string;
  readonly loading: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly tryAgain: string;
  readonly confirmTitle: string;
  /** Carries `{devices}`, already counted. */
  readonly confirmDescription: string;
  readonly confirmBody: string;
  readonly cancel: string;
  readonly signingOutAll: string;
  /** Carries `{devices}`. */
  readonly signOutCount: string;
  /** Carries `{count}`. Every counted sentence above is filled from this one. */
  readonly devices: PluralForms;
  /** Carries `{name}`. */
  readonly signedOutDevice: string;
  /** Carries `{devices}`. */
  readonly signedOutDevices: string;
  /** Carries `{done}` and `{failed}`, both counted. */
  readonly signedOutPartly: string;
  readonly deletionScheduled: string;
  readonly failures: AuthFailuresCopy;
  readonly row: SessionRowCopy;
}

export function sessionsPanelCopyFrom(t: AuthTranslator, auth: AuthTranslator): SessionsPanelCopy {
  return {
    signedOutTitle: t('sessions.signedOutTitle'),
    signedOutBody: t('sessions.signedOutBody'),
    heading: t('sessions.heading'),
    signOutEverywhere: t('sessions.signOutEverywhere'),
    errorTitle: t('sessions.errorTitle'),
    loading: t('sessions.loading'),
    emptyTitle: t('sessions.emptyTitle'),
    emptyBody: t('sessions.emptyBody'),
    tryAgain: t('sessions.tryAgain'),
    confirmTitle: t('sessions.confirmTitle'),
    confirmDescription: String(t.raw('sessions.confirmDescription')),
    confirmBody: t('sessions.confirmBody'),
    cancel: t('sessions.cancel'),
    signingOutAll: t('sessions.signingOutAll'),
    signOutCount: String(t.raw('sessions.signOutCount')),
    devices: t.raw('sessions.devices') as PluralForms,
    signedOutDevice: String(t.raw('sessions.signedOutDevice')),
    signedOutDevices: String(t.raw('sessions.signedOutDevices')),
    signedOutPartly: String(t.raw('sessions.signedOutPartly')),
    deletionScheduled: t('sessions.deletionScheduled'),
    failures: authFailuresCopyFrom(auth),
    row: {
      thisDevice: t('sessions.row.thisDevice'),
      unknownDevice: t('sessions.row.unknownDevice'),
      onPlatform: String(t.raw('sessions.row.onPlatform')),
      noDetails: t('sessions.row.noDetails'),
      lastActive: String(t.raw('sessions.row.lastActive')),
      signOut: t('sessions.row.signOut'),
      signingOut: t('sessions.row.signingOut'),
      signOutLabel: String(t.raw('sessions.row.signOutLabel')),
      signingOutLabel: String(t.raw('sessions.row.signingOutLabel')),
      signOutThisLabel: t('sessions.row.signOutThisLabel'),
      signingOutThisLabel: t('sessions.row.signingOutThisLabel'),
    },
  };
}
