import { colors } from '../theme';

interface SparkProps {
  x: number;
  y: number;
  scale?: number;
  opacity?: number;
  glow?: number;
  core?: number;
}

export function Spark({ x, y, scale = 1, opacity = 1, glow = 1, core = 14 }: SparkProps) {
  const halo = (size: number, alpha: number) => (
    <div
      style={{
        position: 'absolute',
        left: -size / 2,
        top: -size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${colors.textPrimary} 0%, transparent 68%)`,
        opacity: alpha * glow,
      }}
    />
  );
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 0,
        height: 0,
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      {halo(220, 0.18)}
      {halo(90, 0.5)}
      <div
        style={{
          position: 'absolute',
          left: -core / 2,
          top: -core / 2,
          width: core,
          height: core,
          borderRadius: '50%',
          background: colors.textPrimary,
        }}
      />
    </div>
  );
}
