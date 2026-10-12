import { colors } from '../theme';

export function Scrim({ opacity, height = 820 }: { opacity: number; height?: number }) {
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height,
        background: `linear-gradient(180deg, ${colors.surface1} 0%, ${colors.surface1} 62%, transparent 100%)`,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
}
