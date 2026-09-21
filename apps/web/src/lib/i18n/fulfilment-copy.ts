/**
 * Every word the two fulfilment screens draw — issue #324, §4.8 PM-07 and PM-08.
 *
 * <h2>Why the status words left `lib/fulfilment/describe.ts`</h2>
 *
 * That module paired each `FulfilmentStatus` with a label, a sentence and a `Tag` variant. The
 * variant is a design decision and stays — `RETURNED` is `--danger` because it is the one
 * status that asks the reader to act — and the two pieces of prose are copy. They are
 * `account.fulfilment.status` and `.statusDetail` now, keyed by the same status.
 *
 * A status this build does not know still shows the raw value with a sentence saying so.
 * `describeStatus` argued that showing the wire value is honest where a blank tag tells a
 * backer nothing and a guessed one tells them something wrong about where their parcel is;
 * that reasoning is unchanged and the fallback is the catalogue's now.
 *
 * <h2>Two sentences come in a pair each, and that is not duplication</h2>
 *
 * The locked notice and the saved confirmation each have a version with a timestamp and one
 * without, because the service does not always send the instant. English can append ", as of
 * …" to a finished sentence; Azerbaijani and Turkish put the clause before the verb, so a
 * suffix concatenated onto the end is a sentence that parses in one language of four.
 */
export interface FulfilmentTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

export interface DeliveryListCopy {
  readonly loading: string;
  readonly failedTitle: string;
  readonly refused: string;
  readonly unreachable: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyAction: string;
  readonly unlisted: string;
  readonly carrier: string;
  readonly tracking: string;
  readonly sent: string;
  readonly arrived: string;
  readonly shippingAddress: string;
  readonly theCampaign: string;
  /** Keyed by `FulfilmentStatus`. A status with no word renders as the wire value. */
  readonly status: Readonly<Record<string, string>>;
  /** The same keys, plus `unknown` for a status this build has never heard of. */
  readonly statusDetail: Readonly<Record<string, string>>;
}

export interface ShippingAddressFormCopy {
  readonly recipient: string;
  readonly line1: string;
  readonly line2: string;
  readonly locality: string;
  readonly region: string;
  readonly postcode: string;
  readonly country: string;
  readonly countryHint: string;
  readonly phone: string;
  readonly phoneHint: string;
  readonly requiredField: string;
  /** The skeleton's accessible name, which says what is being waited for — #86. */
  readonly loading: string;
  readonly loadFailedTitle: string;
  readonly notFound: string;
  readonly unreachable: string;
  readonly refused: string;
  readonly lockedTitle: string;
  readonly lockedBody: string;
  /** Carries `{at}`. */
  readonly lockedBodyAt: string;
  readonly noAddressTitle: string;
  readonly noAddressBody: string;
  readonly saveFailedTitle: string;
  readonly savedTitle: string;
  readonly savedBody: string;
  /** Carries `{at}`. */
  readonly savedBodyAt: string;
  readonly save: string;
  readonly saving: string;
}

export function deliveryListCopyFrom(t: FulfilmentTranslator): DeliveryListCopy {
  return {
    loading: t('deliveries.loading'),
    failedTitle: t('deliveries.failedTitle'),
    refused: t('deliveries.refused'),
    unreachable: t('deliveries.unreachable'),
    emptyTitle: t('deliveries.emptyTitle'),
    emptyBody: t('deliveries.emptyBody'),
    emptyAction: t('deliveries.emptyAction'),
    unlisted: t('deliveries.unlisted'),
    carrier: t('deliveries.carrier'),
    tracking: t('deliveries.tracking'),
    sent: t('deliveries.sent'),
    arrived: t('deliveries.arrived'),
    shippingAddress: t('deliveries.shippingAddress'),
    theCampaign: t('deliveries.theCampaign'),
    status: t.raw('status') as Readonly<Record<string, string>>,
    statusDetail: t.raw('statusDetail') as Readonly<Record<string, string>>,
  };
}

export function shippingAddressFormCopyFrom(t: FulfilmentTranslator): ShippingAddressFormCopy {
  return {
    recipient: t('form.recipient'),
    line1: t('form.line1'),
    line2: t('form.line2'),
    locality: t('form.locality'),
    region: t('form.region'),
    postcode: t('form.postcode'),
    country: t('form.country'),
    countryHint: t('form.countryHint'),
    phone: t('form.phone'),
    phoneHint: t('form.phoneHint'),
    requiredField: t('form.requiredField'),
    loading: t('form.loading'),
    loadFailedTitle: t('form.loadFailedTitle'),
    notFound: t('form.notFound'),
    unreachable: t('form.unreachable'),
    refused: t('form.refused'),
    lockedTitle: t('form.lockedTitle'),
    lockedBody: t('form.lockedBody'),
    lockedBodyAt: String(t.raw('form.lockedBodyAt')),
    noAddressTitle: t('form.noAddressTitle'),
    noAddressBody: t('form.noAddressBody'),
    saveFailedTitle: t('form.saveFailedTitle'),
    savedTitle: t('form.savedTitle'),
    savedBody: t('form.savedBody'),
    savedBodyAt: String(t.raw('form.savedBodyAt')),
    save: t('form.save'),
    saving: t('form.saving'),
  };
}
