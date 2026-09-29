import type { components } from '@ideanest/api-client';
import type { SupportedLocale } from '../api/config';
import { currentLocale } from './locale';

/**
 * A pledge's state in words a backer would use — issue #180.
 *
 * <h2>Why the list is typed from the contract</h2>
 *
 * The pledge list printed `CHARGEBACK` because the switch it replaced was written
 * against an older state machine: it knew `PENDING` and `CANCELED`, which the
 * service no longer sends, and none of the six it added since. A hand-written
 * list drifts silently; this one cannot.
 *
 * `BackerPledgeSummary.state` is a bare `string` in the contract, so the union
 * is taken from `BackerFilterBody.states`, the one place the generated schema
 * spells out the service's `PledgeState` enum. The labels below are a `Record`
 * over it, so a thirteenth state is a compile error here the day `schema.ts` is
 * regenerated, and `pledge-states.test.ts` compares the keys against the Java
 * enum itself so it fails even before that.
 *
 * <h2>The wording is the web's</h2>
 *
 * Every label is `account.pledges.states` from `packages/messages`, so a pledge
 * reads the same on both. The backer's view rather than the schema's:
 * `CANCELED_BY_PROJECT` is not something the backer did.
 */
export type PledgeState = NonNullable<components['schemas']['BackerFilterBody']['states']>[number];

export const PLEDGE_STATE_LABELS: Readonly<
  Record<SupportedLocale, Readonly<Record<PledgeState, string>>>
> = {
  az: {
    DRAFT: 'Tamamlanmayıb',
    CONFIRMED: 'Təsdiqlənib',
    EXPIRED: 'Vaxtı bitib',
    CANCELED_BY_BACKER: 'Sizin tərəfinizdən ləğv edilib',
    CANCELED_BY_PROJECT: 'Müəllif tərəfindən ləğv edilib',
    CHARGE_PENDING: 'Ödəniş gedir',
    CHARGE_FAILED: 'Ödəniş alınmadı',
    COLLECTED: 'Ödənilib',
    DROPPED: 'Baş tutmayıb',
    REFUNDED: 'Geri qaytarılıb',
    CHARGEBACK: 'Geri tələb edilib',
    FULFILLED: 'Çatdırılıb',
  },
  en: {
    DRAFT: 'Not finished',
    CONFIRMED: 'Confirmed',
    EXPIRED: 'Expired',
    CANCELED_BY_BACKER: 'Cancelled by you',
    CANCELED_BY_PROJECT: 'Cancelled by the creator',
    CHARGE_PENDING: 'Payment in progress',
    CHARGE_FAILED: 'Payment failed',
    COLLECTED: 'Paid',
    DROPPED: 'Dropped',
    REFUNDED: 'Refunded',
    CHARGEBACK: 'Charged back',
    FULFILLED: 'Delivered',
  },
  ru: {
    DRAFT: 'Не завершён',
    CONFIRMED: 'Подтверждён',
    EXPIRED: 'Истёк',
    CANCELED_BY_BACKER: 'Отменён вами',
    CANCELED_BY_PROJECT: 'Отменён автором',
    CHARGE_PENDING: 'Идёт оплата',
    CHARGE_FAILED: 'Платёж не прошёл',
    COLLECTED: 'Оплачен',
    DROPPED: 'Не состоялся',
    REFUNDED: 'Возвращён',
    CHARGEBACK: 'Оспорен через банк',
    FULFILLED: 'Доставлен',
  },
  tr: {
    DRAFT: 'Tamamlanmadı',
    CONFIRMED: 'Onaylandı',
    EXPIRED: 'Süresi doldu',
    CANCELED_BY_BACKER: 'Sizin tarafınızdan iptal edildi',
    CANCELED_BY_PROJECT: 'Yaratıcı tarafından iptal edildi',
    CHARGE_PENDING: 'Ödeme sürüyor',
    CHARGE_FAILED: 'Ödeme başarısız',
    COLLECTED: 'Ödendi',
    DROPPED: 'Gerçekleşmedi',
    REFUNDED: 'İade edildi',
    CHARGEBACK: 'Banka üzerinden geri alındı',
    FULFILLED: 'Teslim edildi',
  },
};

function isPledgeState(state: string): state is PledgeState {
  return Object.hasOwn(PLEDGE_STATE_LABELS.en, state);
}

/**
 * The label for a state, in the device's language unless one is given.
 *
 * Not "Unknown" for a state this build has not been taught about. It is still a
 * real state on the service, and printing it is more useful than hiding it.
 */
export function readablePledgeState(
  state: string | undefined,
  locale: SupportedLocale = currentLocale(),
): string {
  if (state === undefined) return '';
  return isPledgeState(state) ? PLEDGE_STATE_LABELS[locale][state] : state;
}
