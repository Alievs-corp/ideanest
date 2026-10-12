import Decimal from 'decimal.js';
import { formatMoney } from '@ideanest/money/format';

export function amountAt(target: string, progress: number): string {
  const p = Math.min(1, Math.max(0, progress));
  return new Decimal(target)
    .times(new Decimal(p.toFixed(6)))
    .toDecimalPlaces(2, Decimal.ROUND_DOWN)
    .toFixed(2);
}

export function formatAmountAt(target: string, currency: string, progress: number): string {
  return formatMoney({ amount: amountAt(target, progress), currency });
}
