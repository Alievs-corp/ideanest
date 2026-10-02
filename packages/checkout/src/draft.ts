import { toMoney } from '@ideanest/money';
import type { Selection } from './quote';
import type { DraftPledgeRequest } from './types';

export const NO_REWARD = 'none';

export function draftBodyFor(
  projectId: string,
  selection: Selection,
  needsDestination: boolean,
  isAnonymous: boolean,
): DraftPledgeRequest {
  return {
    projectId,
    rewardTierId: selection.reward?.id ?? null,
    addons: selection.addons
      .filter((addon) => addon.quantity > 0)
      .map((addon) => ({ rewardTierId: addon.reward.id, quantity: addon.quantity }))
      .sort((left, right) => (left.rewardTierId < right.rewardTierId ? -1 : 1)),
    contribution: toMoney(selection.contribution, selection.currency),
    shippingCountry: needsDestination ? selection.destination : null,
    isAnonymous,
    referrerCode: null,
  };
}

export function paymentIntentFor(pledgeId: string, acknowledgedAgreementVersion: number | null) {
  return { pledgeId, pay: true, acknowledgedAgreementVersion } as const;
}
