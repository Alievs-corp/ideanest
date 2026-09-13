/**
 * The creator's Extend and Withdraw controls on the dashboard — IDN-EXT-01 §5.1 (#44).
 *
 * Resolved on the server and handed to the client island as a prop, the arrangement
 * `checkout-copy.ts` explains. Read with `raw` rather than formatted, because several sentences
 * carry a `{date}` or `{latest}` the component fills with `fillPlaceholders` once it knows them.
 */
export interface CampaignControlsCopy {
  readonly heading: string;
  readonly rule: string;
  readonly extend: string;
  readonly extendLabel: string;
  readonly extendHint: string;
  readonly extendConfirmTitle: string;
  readonly extendConfirmBody: string;
  readonly extendNow: string;
  readonly extending: string;
  readonly extended: string;
  readonly withdraw: string;
  readonly withdrawConfirmTitle: string;
  readonly withdrawConfirmBody: string;
  readonly withdrawNow: string;
  readonly withdrawing: string;
  readonly withdrawn: string;
  readonly cancel: string;
  readonly belowThreshold: string;
  readonly extendWrongState: string;
  readonly extendAlready: string;
  readonly extendOutsideWindow: string;
  readonly extendBelow: string;
  readonly extendDate: string;
  readonly withdrawWrongState: string;
  readonly failed: string;
}

export interface CampaignControlsTranslator {
  raw(key: string): unknown;
}

const KEYS = [
  'heading',
  'rule',
  'extend',
  'extendLabel',
  'extendHint',
  'extendConfirmTitle',
  'extendConfirmBody',
  'extendNow',
  'extending',
  'extended',
  'withdraw',
  'withdrawConfirmTitle',
  'withdrawConfirmBody',
  'withdrawNow',
  'withdrawing',
  'withdrawn',
  'cancel',
  'belowThreshold',
  'extendWrongState',
  'extendAlready',
  'extendOutsideWindow',
  'extendBelow',
  'extendDate',
  'withdrawWrongState',
  'failed',
] as const satisfies readonly (keyof CampaignControlsCopy)[];

export function campaignControlsCopyFrom(t: CampaignControlsTranslator): CampaignControlsCopy {
  return Object.fromEntries(KEYS.map((key) => [key, String(t.raw(key))])) as unknown as CampaignControlsCopy;
}
