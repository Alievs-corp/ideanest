import type { ReactNode } from 'react';
import { AbsoluteFill, Freeze, interpolate, useCurrentFrame } from 'remotion';
import { PERSPECTIVE, poseTransform, SCREEN_Z, type Pose } from '../camera';
import { ease } from '../motion';
import { colors, DEVICE, FRAME } from '../theme';
import { Back, Buttons, Rim } from './Body';
import { StatusBar } from './StatusBar';

interface DeviceProps {
  pose: Pose | ((frame: number) => Pose);
  screen: ReactNode;
  overlay?: ReactNode;
  above?: ReactNode;
  sweepAt?: number;
}

const GLASS_INSET = 3;

export function Device({ pose, screen, overlay, above, sweepAt }: DeviceProps) {
  const frame = useCurrentFrame();
  const posed = typeof pose === 'function' ? pose(frame) : pose;
  const { body, screen: s, bezel, bodyRadius, screenRadius, depth } = DEVICE;
  const sweep =
    sweepAt === undefined
      ? -1
      : interpolate(frame - sweepAt, [0, 40], [0, 1], {
          easing: ease.move,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const sweepOn = sweep > 0 && sweep < 1;
  const glass = `translateZ(${depth / 2 + 0.5}px)`;
  const front = `translateZ(${SCREEN_Z}px)`;

  return (
    <AbsoluteFill style={{ perspective: PERSPECTIVE, perspectiveOrigin: '50% 50%' }}>
      <div
        style={{
          position: 'absolute',
          left: FRAME.width / 2 - body.width / 2,
          top: FRAME.height / 2 - body.height / 2,
          width: body.width,
          height: body.height,
          transform: poseTransform(posed),
          transformStyle: 'preserve-3d',
        }}
      >
        <Rim />
        <Buttons />
        <Back />
        <div
          style={{
            position: 'absolute',
            inset: GLASS_INSET,
            borderRadius: bodyRadius - GLASS_INSET,
            background: colors.black,
            transform: glass,
            backfaceVisibility: 'hidden',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: bezel,
            top: bezel,
            width: s.width,
            height: s.height,
            borderRadius: screenRadius,
            overflow: 'hidden',
            background: colors.surface1,
            transform: front,
            backfaceVisibility: 'hidden',
          }}
        >
          <StatusBar />
          <div style={{ position: 'relative', width: s.width, height: s.height - DEVICE.statusBar }}>
            <Freeze frame={Math.floor(frame)}>{screen}</Freeze>
            {overlay}
          </div>
          <div
            style={{
              position: 'absolute',
              top: 13,
              left: s.width / 2 - 62,
              width: 124,
              height: 36,
              borderRadius: 18,
              background: colors.black,
            }}
          />
          {sweepOn ? (
            <div
              style={{
                position: 'absolute',
                inset: '-40%',
                background: `linear-gradient(115deg, transparent 42%, ${colors.textPrimary} 50%, transparent 58%)`,
                opacity: 0.1 * Math.sin(Math.PI * sweep),
                transform: `translate(${interpolate(sweep, [0, 1], [-45, 45])}%, ${interpolate(sweep, [0, 1], [-30, 30])}%)`,
              }}
            />
          ) : null}
        </div>
        {above ? (
          <div style={{ position: 'absolute', inset: 0, transform: front, transformStyle: 'preserve-3d' }}>{above}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
