import { CameraMotionBlur } from '@remotion/motion-blur';
import { AbsoluteFill, Img, interpolate, Sequence, useCurrentFrame } from 'remotion';
import type { Copy } from '../copy';
import { PERSPECTIVE } from '../camera';
import { Device } from '../device/Device';
import { ClipScreen, screenPoint } from '../device/Screen';
import { Scrim } from '../fx/Scrim';
import { Studio } from '../fx/Studio';
import { TapRing } from '../fx/TapRing';
import { crop, cropSrc, point, type ClipId } from '../media';
import { BAR, cues, ease, scenes } from '../motion';
import { montagePose, pledgePose } from '../poses';
import { accent, colors, shadow } from '../theme';
import { Headline } from '../text/Headline';
import { NestRing } from '../ui/NestRing';

export function Gather({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const card = crop('card');
  const width = 600;
  const height = (card.h / card.w) * width;
  const ry = interpolate(frame, [0, BAR], [-10, 6], { easing: ease.drift });
  const s = interpolate(frame, [0, BAR], [0.96, 1.0], { easing: ease.drift });
  const cy = 1110;
  return (
    <>
      <Studio glow={accent.sky.glow} glowY={cy + height / 2 + 60} />
      <AbsoluteFill style={{ perspective: PERSPECTIVE }}>
        <div
          style={{
            position: 'absolute',
            left: 540 - width / 2,
            top: cy - height / 2,
            width,
            height,
            borderRadius: 34,
            overflow: 'hidden',
            boxShadow: shadow.float,
            transform: `rotateX(8deg) rotateY(${ry}deg) scale(${s})`,
          }}
        >
          <Img src={cropSrc('card')} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
      </AbsoluteFill>
      <NestRing cx={540} cy={cy} radius={500} start={cues.ringStart - scenes.gather.start} />
      <Headline lines={copy.gather} at={6} exitAt={102} />
    </>
  );
}

const MONTAGE_CLIPS: readonly ClipId[] = ['discover', 'games', 'campaign', 'tumar'];

export function Montage({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const start = scenes.montage.start;
  const swaps = cues.backgroundSwaps.map((f) => f - start);
  const onSun = frame >= (swaps[0] ?? 0) && frame < (swaps[1] ?? 0);
  const shot = Math.min(3, Math.floor(frame / 60));
  const whip = frame >= cues.whip - start - 12 && frame < cues.whip - start + 21;
  const device = (
    <Device
      pose={montagePose(frame)}
      sweepAt={shot * 60}
      screen={
        <>
          {MONTAGE_CLIPS.map((id, i) => (
            <Sequence key={id} from={i * 60} durationInFrames={60} layout="none">
              <ClipScreen id={id} />
            </Sequence>
          ))}
        </>
      }
    />
  );
  return (
    <>
      {onSun ? <Studio surface={accent.sun.surface} /> : <Studio glow={accent.mint.glow} glowY={1760} />}
      {whip ? (
        <CameraMotionBlur shutterAngle={180} samples={10}>
          {device}
        </CameraMotionBlur>
      ) : (
        device
      )}
      <Scrim opacity={interpolate(frame, [180, 192], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      <Headline lines={copy.montage} at={6} exitAt={222} color={onSun ? accent.sun.text : colors.textPrimary} />
    </>
  );
}

export function Pledge({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const start = scenes.pledge.start;
  const [rx, ry] = screenPoint(...point('rewardSelect'));
  const [bx, by] = screenPoint(...point('backButton'));
  return (
    <>
      <Studio glow={accent.mint.glow} glowY={1760} />
      <Device
        pose={pledgePose(frame)}
        sweepAt={0}
        screen={<ClipScreen id="rewards" />}
        overlay={
          <>
            <TapRing x={rx} y={ry} at={cues.rewardTap - start} size={110} tone="light" />
            <TapRing x={bx} y={by} at={cues.backTap - start} size={120} tone="light" />
          </>
        }
      />
      <Scrim opacity={interpolate(frame, [60, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      <Headline lines={copy.pledge} at={6} exitAt={222} />
    </>
  );
}
