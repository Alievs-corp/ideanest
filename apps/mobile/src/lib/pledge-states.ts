import type { components } from '@ideanest/api-client';
import type { SupportedLocale } from '../api/config';
import { catalogue } from './i18n';
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
 * regenerated, and `pledge-states.test.ts` compares the catalogue's keys against
 * the Java enum itself so it fails even before that.
 *
 * <h2>The wording is the web's, read rather than copied</h2>
 *
 * Every label is `account.pledges.states` from `packages/messages`, so a pledge
 * reads the same on both. The backer's view rather than the schema's:
 * `CANCELED_BY_PROJECT` is not something the backer did. The app used to carry its
 * own four-language copy of that namespace, tested equal to it; now it reads the
 * namespace itself, and there is no second copy to fall out of step.
 */
export type PledgeState = NonNullable<components['schemas']['BackerFilterBody']['states']>[number];

/**
 * The labels for one language, straight from the catalogue.
 *
 * The return type is a `Record` over the contract's states, and the catalogue's
 * namespace has to satisfy it: a thirteenth state is a compile error here the day
 * `schema.ts` is regenerated, until the web's catalogue names it.
 */
export function pledgeStateLabels(
  locale: SupportedLocale,
): Readonly<Record<PledgeState, string>> {
  return catalogue(locale).account.pledges.states;
}

function isPledgeState(state: string): state is PledgeState {
  return Object.hasOwn(pledgeStateLabels('en'), state);
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
  return isPledgeState(state) ? pledgeStateLabels(locale)[state] : state;
}
