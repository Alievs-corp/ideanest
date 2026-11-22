import type { StudentSubmissionRefusal, StudentVerificationState } from '@ideanest/plans/student';

/**
 * Every word `/account/student` draws — issue #655.
 *
 * <p>Resolved on the server and handed to the panel as one prop, for the reason
 * `components/account/AccountArea.tsx` records: a `NextIntlClientProvider` in the account area
 * put next-intl's client runtime into every route under it.
 */
export interface StudentVerificationCopy {
  readonly loading: string;
  readonly unavailable: string;
  readonly tryAgain: string;

  readonly statusHeading: string;
  /** One sentence per state: where the reader stands. */
  readonly state: Readonly<Record<StudentVerificationState, string>>;
  /** What that means and what happens next. */
  readonly stateBody: Readonly<Record<StudentVerificationState, string>>;
  readonly institutionLabel: string;
  readonly cardNumberLabel: string;
  readonly submittedLabel: string;
  readonly validUntilLabel: string;
  readonly reasonLabel: string;
  readonly toPricing: string;

  readonly formHeading: string;
  /** Why a selfie, and that one card belongs to one account. One short sentence each. */
  readonly why: string;
  readonly institutionField: string;
  readonly institutionHint: string;
  readonly cardNumberField: string;
  readonly cardNumberHint: string;
  readonly studentCardField: string;
  /** Carries `{megabytes}`. */
  readonly studentCardHint: string;
  readonly selfieField: string;
  /** Carries `{megabytes}`. */
  readonly selfieHint: string;
  /** Carries `{name}`: a chosen PDF, which has no thumbnail. */
  readonly pdfChosen: string;
  readonly studentCardPreview: string;
  readonly selfiePreview: string;
  readonly institutionMissing: string;
  readonly cardNumberInvalid: string;
  readonly fileMissing: string;
  readonly submit: string;
  readonly submitting: string;
  readonly sentTitle: string;
  readonly errorTitle: string;
  /** `studentSubmissionRefusalOf`'s answers, said under the file when the service named one. */
  readonly refusals: Readonly<Record<StudentSubmissionRefusal, string>>;
}

/** The subset of `next-intl`'s translator this module uses, declared structurally (see `plans-copy.ts`). */
export interface StudentTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

const STATES: readonly StudentVerificationState[] = ['NONE', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'];
const REFUSALS: readonly StudentSubmissionRefusal[] = [
  'cardInUse',
  'alreadySubmitted',
  'emptyFile',
  'unsupportedFile',
  'tooLarge',
  'storageUnavailable',
  'signedOut',
  'generic',
];

function byKey<K extends string>(keys: readonly K[], word: (key: K) => string): Readonly<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) out[key] = word(key);
  return out as Readonly<Record<K, string>>;
}

/** @param t a translator rooted at `account.student`. */
export function studentVerificationCopyFrom(t: StudentTranslator): StudentVerificationCopy {
  return {
    loading: t('loading'),
    unavailable: t('unavailable'),
    tryAgain: t('tryAgain'),

    statusHeading: t('statusHeading'),
    state: byKey(STATES, (state) => t(`state.${state}`)),
    stateBody: byKey(STATES, (state) => t(`stateBody.${state}`)),
    institutionLabel: t('institutionLabel'),
    cardNumberLabel: t('cardNumberLabel'),
    submittedLabel: t('submittedLabel'),
    validUntilLabel: t('validUntilLabel'),
    reasonLabel: t('reasonLabel'),
    toPricing: t('toPricing'),

    formHeading: t('formHeading'),
    why: t('why'),
    institutionField: t('institutionField'),
    institutionHint: t('institutionHint'),
    cardNumberField: t('cardNumberField'),
    cardNumberHint: t('cardNumberHint'),
    studentCardField: t('studentCardField'),
    // `t.raw` for the templates: `t('key')` on a message holding a placeholder renders the key's path.
    studentCardHint: String(t.raw('studentCardHint')),
    selfieField: t('selfieField'),
    selfieHint: String(t.raw('selfieHint')),
    pdfChosen: String(t.raw('pdfChosen')),
    studentCardPreview: t('studentCardPreview'),
    selfiePreview: t('selfiePreview'),
    institutionMissing: t('institutionMissing'),
    cardNumberInvalid: t('cardNumberInvalid'),
    fileMissing: t('fileMissing'),
    submit: t('submit'),
    submitting: t('submitting'),
    sentTitle: t('sentTitle'),
    errorTitle: t('errorTitle'),
    refusals: byKey(REFUSALS, (refusal) => t(`refusals.${refusal}`)),
  };
}
