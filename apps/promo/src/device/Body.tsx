import type { CSSProperties } from 'react';
import { colors, DEVICE, IPHONE_BUTTONS, shadow } from '../theme';

const { body, bodyRadius, depth, mm } = DEVICE;
const LAYERS = Math.round(depth / 2);

function rimLayer(u: number): CSSProperties {
  const edge = Math.min(u, 1 - u);
  if (edge < 0.06) return { background: colors.whiteSurface, opacity: 0.3 };
  if (edge < 0.12) return { background: colors.whiteSurface, opacity: 0.18 };
  return { background: Math.abs(u - 0.5) < 0.2 ? colors.surface4 : colors.surface3 };
}

export function Rim() {
  return (
    <>
      {Array.from({ length: LAYERS }, (_, i) => {
        const u = i / (LAYERS - 1);
        const z = -depth / 2 + u * depth;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: bodyRadius,
              ...rimLayer(u),
              transform: `translateZ(${z}px)`,
              boxShadow: i === 0 ? shadow.float : undefined,
            }}
          />
        );
      })}
    </>
  );
}

function ButtonBlock({ side, from, to }: { side: 'left' | 'right'; from: number; to: number }) {
  const thickness = depth * 0.42;
  const steps = 10;
  const top = from * mm;
  const height = (to - from) * mm;
  return (
    <>
      {Array.from({ length: steps }, (_, i) => {
        const u = i / (steps - 1);
        const z = -thickness / 2 + u * thickness;
        const style: CSSProperties = {
          position: 'absolute',
          top,
          height,
          width: 14,
          left: side === 'right' ? body.width - 9 : -5,
          borderRadius: 6,
          background: u < 0.15 || u > 0.85 ? colors.textTertiary : colors.surface4,
          transform: `translateZ(${z}px)`,
        };
        return <div key={i} style={style} />;
      })}
    </>
  );
}

export function Buttons() {
  return (
    <>
      {IPHONE_BUTTONS.left.map((b) => (
        <ButtonBlock key={`l${b.from}`} side="left" {...b} />
      ))}
      {IPHONE_BUTTONS.right.map((b) => (
        <ButtonBlock key={`r${b.from}`} side="right" {...b} />
      ))}
    </>
  );
}

function Lens({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: colors.surface4,
        boxShadow: `${shadow.panel}, inset 0 0 0 2px ${colors.borderStrong}`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: size * 0.09,
          borderRadius: '50%',
          background: colors.black,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: size * 0.2,
          borderRadius: '50%',
          background: `radial-gradient(circle at 38% 36%, ${colors.surface4} 0%, ${colors.surface1} 34%, ${colors.black} 70%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: size * 0.36,
          top: size * 0.33,
          width: size * 0.1,
          height: size * 0.1,
          borderRadius: '50%',
          background: colors.textPrimary,
          opacity: 0.45,
        }}
      />
    </div>
  );
}

export function Back() {
  const plateau = body.height * 0.27;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: bodyRadius,
        transform: `translateZ(${-depth / 2 - 0.5}px) rotateY(180deg)`,
        backfaceVisibility: 'hidden',
        background: `linear-gradient(160deg, ${colors.surface3} 0%, ${colors.surface2} 55%, ${colors.surface3} 100%)`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: plateau,
          borderRadius: `${bodyRadius}px ${bodyRadius}px 70px 70px`,
          background: `linear-gradient(180deg, ${colors.surface4} 0%, ${colors.surface3} 100%)`,
          boxShadow: `${shadow.panel}, inset 0 -2px 0 ${colors.surface4}`,
        }}
      >
        <Lens x={128} y={plateau * 0.28} size={128} />
        <Lens x={128} y={plateau * 0.72} size={128} />
        <Lens x={272} y={plateau * 0.5} size={128} />
        <div
          style={{
            position: 'absolute',
            left: body.width - 120,
            top: plateau * 0.26 - 24,
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: colors.textSecondary,
            boxShadow: `inset 0 0 0 6px ${colors.surface4}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: body.width - 120,
            top: plateau * 0.74 - 26,
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: colors.black,
            boxShadow: `inset 0 0 0 6px ${colors.surface4}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: body.width - 102,
            top: plateau * 0.5 - 6,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: colors.black,
          }}
        />
      </div>
    </div>
  );
}
