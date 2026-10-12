import type { IbanDefect } from '@ideanest/account/iban';

/**
 * The payout details panel — IDN-EXT-01 (#44). Read with `raw`, because `accountOnFile` and
 * `cardOnFile` carry placeholders the panel fills once it has the destination; the arrangement
 * `campaign-controls-copy.ts` uses. `ibanDefect` is a table, one sentence per `IbanDefect` (#395).
 */
export interface PayoutPanelCopy {
  readonly loading: string;
  readonly subjectHeading: string;
  readonly subjectIntro: string;
  readonly kind: string;
  readonly kindIndividual: string;
  readonly kindEntity: string;
  readonly legalName: string;
  readonly legalNameHint: string;
  readonly taxId: string;
  readonly taxIdHint: string;
  readonly registeredAddress: string;
  readonly registrationNumber: string;
  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly bankHeading: string;
  readonly bankIntro: string;
  readonly accountNone: string;
  readonly accountOnFile: string;
  readonly ibanLabel: string;
  readonly ibanHint: string;
  readonly holderLabel: string;
  readonly holderHint: string;
  readonly ibanDefect: Readonly<Record<IbanDefect, string>>;
  readonly saveBank: string;
  readonly bankSaved: string;
  readonly bankUnavailable: string;
  readonly standingAwaiting: string;
  readonly standingVerified: string;
  readonly standingWaived: string;
  readonly standingMismatch: string;
  readonly mismatchHelp: string;
  readonly standingRejected: string;
  readonly cardHeading: string;
  readonly cardIntro: string;
  readonly cardOnFile: string;
  readonly register: string;
  readonly replace: string;
  readonly opening: string;
  readonly waiting: string;
  readonly cardFailed: string;
  readonly unavailable: string;
  readonly malformedTaxId: string;
  readonly failed: string;
}

export interface PayoutPanelTranslator {
  raw(key: string): unknown;
}

const KEYS = [
  'loading',
  'subjectHeading',
  'subjectIntro',
  'kind',
  'kindIndividual',
  'kindEntity',
  'legalName',
  'legalNameHint',
  'taxId',
  'taxIdHint',
  'registeredAddress',
  'registrationNumber',
  'save',
  'saving',
  'saved',
  'bankHeading',
  'bankIntro',
  'accountNone',
  'accountOnFile',
  'ibanLabel',
  'ibanHint',
  'holderLabel',
  'holderHint',
  'saveBank',
  'bankSaved',
  'bankUnavailable',
  'standingAwaiting',
  'standingVerified',
  'standingWaived',
  'standingMismatch',
  'mismatchHelp',
  'standingRejected',
  'cardHeading',
  'cardIntro',
  'cardOnFile',
  'register',
  'replace',
  'opening',
  'waiting',
  'cardFailed',
  'unavailable',
  'malformedTaxId',
  'failed',
] as const satisfies readonly Exclude<keyof PayoutPanelCopy, 'ibanDefect'>[];

export function payoutPanelCopyFrom(t: PayoutPanelTranslator): PayoutPanelCopy {
  const strings = Object.fromEntries(KEYS.map((key) => [key, String(t.raw(key))]));
  const defects = t.raw('ibanDefect') as Readonly<Record<IbanDefect, string>>;
  return { ...strings, ibanDefect: defects } as unknown as PayoutPanelCopy;
}
