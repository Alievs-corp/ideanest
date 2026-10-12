import { AbsoluteFill } from 'remotion';
import { colors } from '../theme';

interface StudioProps {
  glow?: string;
  glowY?: number;
  surface?: string;
}

export function Studio({ glow, glowY = 1500, surface }: StudioProps) {
  if (surface) return <AbsoluteFill style={{ background: surface }} />;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 120% 80% at 50% 62%, ${colors.surface3} 0%, ${colors.surface1} 62%)`,
      }}
    >
      {glow ? (
        <div
          style={{
            position: 'absolute',
            left: 140,
            top: glowY - 140,
            width: 800,
            height: 280,
            borderRadius: '50%',
            background: glow,
            filter: 'blur(90px)',
            opacity: 0.6,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}
