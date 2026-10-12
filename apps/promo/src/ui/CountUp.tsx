import { interpolate, useCurrentFrame } from 'remotion';
import { formatAmountAt } from '../money';
import { dur, ease } from '../motion';

interface CountUpProps {
  amount: string;
  currency: string;
  at: number;
}

export function CountUp({ amount, currency, at }: CountUpProps) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame - at, [0, dur.countUp], [0, 1], {
    easing: ease.enter,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmountAt(amount, currency, progress)}</span>;
}
