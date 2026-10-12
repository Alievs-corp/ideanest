import { interpolate, useCurrentFrame } from 'remotion';
import { fontFamily } from '../fonts';
import { BAR, dur, ease } from '../motion';
import { accent, colors } from '../theme';

const BACKERS = [
  { initial: 'A', surface: accent.sun.surface, ink: accent.sun.text },
  { initial: 'R', surface: colors.whiteSurface, ink: colors.textOnWhite },
  { initial: 'N', surface: accent.mint.surface, ink: accent.mint.text },
  { initial: 'T', surface: accent.sky.surface, ink: accent.sky.text },
  { initial: 'L', surface: accent.sun.surface, ink: accent.sun.text },
  { initial: 'K', surface: accent.mint.surface, ink: accent.mint.text },
  { initial: 'S', surface: colors.whiteSurface, ink: colors.textOnWhite },
  { initial: 'E', surface: accent.sky.surface, ink: accent.sky.text },
] as const;

export const NEST_SIZE = BACKERS.length;
export const NEST_STEP = 6;

interface NestRingProps {
  cx: number;
  cy: number;
  radius: number;
  start: number;
  size?: number;
  collapseAt?: number;
}

export function NestRing({ cx, cy, radius, start, size = 116, collapseAt }: NestRingProps) {
  const frame = useCurrentFrame();
  const landed = start + (BACKERS.length - 1) * NEST_STEP + dur.avatarFlight;
  const spin = interpolate(frame, [landed, landed + BAR], [0, 8], {
    easing: ease.drift,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'extend',
  });
  const collapse =
    collapseAt === undefined
      ? 0
      : interpolate(frame - collapseAt, [0, 30], [0, 1], {
          easing: ease.exit,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  return (
    <>
      {BACKERS.map((b, i) => {
        const theta = ((-90 + i * (360 / BACKERS.length) + spin) * Math.PI) / 180;
        const tx = cx + Math.cos(theta) * radius;
        const ty = cy + Math.sin(theta) * radius;
        const sx = cx + Math.cos(theta) * 1500;
        const sy = cy + Math.sin(theta) * 1500;
        const qx = (sx + tx) / 2 + Math.cos(theta + Math.PI / 2) * 420;
        const qy = (sy + ty) / 2 + Math.sin(theta + Math.PI / 2) * 420;
        const t = interpolate(frame - (start + i * NEST_STEP), [0, dur.avatarFlight], [0, 1], {
          easing: ease.enter,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        if (t <= 0) return null;
        const u = 1 - t;
        let x = u * u * sx + 2 * u * t * qx + t * t * tx;
        let y = u * u * sy + 2 * u * t * qy + t * t * ty;
        const land = frame - (start + i * NEST_STEP + dur.avatarFlight);
        let scale = land >= 0 ? interpolate(land, [0, 3, 9], [1.06, 1.02, 1], { extrapolateRight: 'clamp' }) : 1;
        let opacity = interpolate(t, [0, 0.25], [0, 1]);
        if (collapse > 0) {
          x += (cx - x) * collapse;
          y += (cy - y) * collapse;
          scale *= 1 - 0.8 * collapse;
          opacity *= 1 - collapse;
        }
        return (
          <div
            key={b.initial + i}
            style={{
              position: 'absolute',
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              borderRadius: '50%',
              background: b.surface,
              color: b.ink,
              border: `5px solid ${colors.surface1}`,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily,
              fontWeight: 800,
              fontSize: size * 0.42,
              transform: `scale(${scale})`,
              opacity,
            }}
          >
            {b.initial}
          </div>
        );
      })}
    </>
  );
}
