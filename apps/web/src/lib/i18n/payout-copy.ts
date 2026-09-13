/**
 * The payout details panel — IDN-EXT-01 (#44). Read with `raw`, because `cardOnFile` carries
 * placeholders the panel fills once it has the card; the arrangement `campaign-controls-copy.ts` uses.
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
  readonly cardHeading: string;
  readonly cardIntro: string;
  readonly cardNone: string;
  readonly cardOnFile: string;
  readonly standingAwaiting: string;
  readonly standingVerified: string;
  readonly standingWaived: string;
  readonly standingMismatch: string;
  readonly standingRejected: string;
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
  'cardHeading',
  'cardIntro',
  'cardNone',
  'cardOnFile',
  'standingAwaiting',
  'standingVerified',
  'standingWaived',
  'standingMismatch',
  'standingRejected',
  'register',
  'replace',
  'opening',
  'waiting',
  'cardFailed',
  'unavailable',
  'malformedTaxId',
  'failed',
] as const satisfies readonly (keyof PayoutPanelCopy)[];

export function payoutPanelCopyFrom(t: PayoutPanelTranslator): PayoutPanelCopy {
  return Object.fromEntries(KEYS.map((key) => [key, String(t.raw(key))])) as unknown as PayoutPanelCopy;
}
