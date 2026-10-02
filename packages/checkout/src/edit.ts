import Decimal from 'decimal.js';
import { toMoney } from '@ideanest/money';
import { NO_REWARD } from './draft';
import type { PledgeAddon, PledgeEdit, PledgeResponse } from './types';

export interface PledgeDraft {
  readonly choice: string;
  readonly contributionText: string;
  readonly addons: readonly PledgeAddon[];
  readonly destination: string | null;
  readonly isAnonymous: boolean;
}

export function contributionOf(pledge: PledgeResponse): Decimal {
  return new Decimal(pledge.amounts.base.amount).plus(pledge.amounts.bonus.amount);
}

export function normaliseAddons(addons: readonly PledgeAddon[]): readonly PledgeAddon[] {
  return [...addons]
    .filter((addon) => addon.quantity > 0)
    .sort((left, right) => (left.rewardTierId < right.rewardTierId ? -1 : 1));
}

export function sameAddons(left: readonly PledgeAddon[], right: readonly PledgeAddon[]): boolean {
  const a = normaliseAddons(left);
  const b = normaliseAddons(right);
  if (a.length !== b.length) return false;
  return a.every((addon, index) => {
    const other = b[index];
    return other !== undefined && other.rewardTierId === addon.rewardTierId && other.quantity === addon.quantity;
  });
}

export function draftOf(pledge: PledgeResponse): PledgeDraft {
  return {
    choice: pledge.rewardTierId ?? NO_REWARD,
    contributionText: contributionOf(pledge).toFixed(2),
    addons: pledge.addons,
    destination: pledge.shippingCountry ?? null,
    isAnonymous: pledge.isAnonymous,
  };
}

export function changesFrom(pledge: PledgeResponse, draft: PledgeDraft, contribution: Decimal): PledgeEdit {
  const edit: PledgeEdit = {};
  const original = draftOf(pledge);

  if (draft.choice !== original.choice) {
    edit.rewardTierId = draft.choice === NO_REWARD ? null : draft.choice;
  }
  if (!sameAddons(draft.addons, original.addons)) {
    edit.addons = normaliseAddons(draft.addons);
  }
  if (!contribution.equals(contributionOf(pledge))) {
    edit.contribution = toMoney(contribution, pledge.amounts.total.currency);
  }
  if (draft.destination !== original.destination) {
    edit.shippingCountry = draft.destination;
  }
  if (draft.isAnonymous !== original.isAnonymous) {
    edit.isAnonymous = draft.isAnonymous;
  }
  return edit;
}

export function isEmptyEdit(edit: PledgeEdit): boolean {
  return Object.keys(edit).length === 0;
}

export function seedOf(pledge: PledgeResponse): string {
  return JSON.stringify([pledge.id, draftOf(pledge), pledge.amounts]);
}

export function raiseDifference(total: Decimal, pledge: PledgeResponse): Decimal {
  return total.minus(new Decimal(pledge.amounts.total.amount));
}
