import { interpolate, useCurrentFrame } from 'remotion';
import { dur, ease } from '../motion';
import { colors } from '../theme';

interface TapRingProps {
  x: number;
  y: number;
  at: number;
  size?: number;
  tone?: 'dark' | 'light';
}

export function TapRing({ x, y, at, size = 90, tone = 'dark' }: TapRingProps) {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > dur.tapRing) return null;
  const scale = interpolate(t, [0, dur.tapRing], [0.6, 1.6], { easing: ease.enter });
  const opacity = interpolate(t, [0, dur.tapRing], [0.55, 0], { easing: ease.enter });
  const fill = interpolate(t, [0, 6, 14], [0, 0.22, 0], { extrapolateRight: 'clamp' });
  const stroke = tone === 'dark' ? colors.textPrimary : colors.textOnWhite;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: stroke,
          opacity: fill,
          transform: 'scale(0.7)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `4px solid ${stroke}`,
          opacity,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}
