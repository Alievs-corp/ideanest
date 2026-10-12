import type { ReactNode } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { PERSPECTIVE, poseTransform, type Pose } from '../camera';
import { ease } from '../motion';
import { colors, DEVICE, FRAME, shadow } from '../theme';
import { StatusBar } from './StatusBar';

interface DeviceProps {
  pose: Pose;
  screen: ReactNode;
  overlay?: ReactNode;
  above?: ReactNode;
  sweepAt?: number;
}

export function Device({ pose, screen, overlay, above, sweepAt }: DeviceProps) {
  const frame = useCurrentFrame();
  const { body, screen: s, bezel, bodyRadius, screenRadius } = DEVICE;
  const sweep =
    sweepAt === undefined
      ? -1
      : interpolate(frame - sweepAt, [0, 40], [0, 1], {
          easing: ease.move,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const sweepOn = sweep > 0 && sweep < 1;

  return (
    <AbsoluteFill style={{ perspective: PERSPECTIVE, perspectiveOrigin: '50% 50%' }}>
    <div
      style={{
        position: 'absolute',
        left: FRAME.width / 2 - body.width / 2,
        top: FRAME.height / 2 - body.height / 2,
        width: body.width,
        height: body.height,
        transform: poseTransform(pose),
        transformStyle: 'preserve-3d',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: bodyRadius,
          background: colors.surface3,
          boxShadow: `${shadow.float}, inset 0 0 0 2px ${colors.surface4}`,
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
        }}
      >
        <StatusBar />
        <div style={{ position: 'relative', width: s.width, height: s.height - DEVICE.statusBar }}>
          {screen}
          {overlay}
        </div>
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: s.width / 2 - 52,
            width: 104,
            height: 30,
            borderRadius: 15,
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
      {above}
    </div>
    </AbsoluteFill>
  );
}
