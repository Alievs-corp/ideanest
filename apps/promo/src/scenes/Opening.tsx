import { CameraMotionBlur } from '@remotion/motion-blur';
import { Img, Sequence, spring, useCurrentFrame } from 'remotion';
import type { Copy } from '../copy';
import { captureToDevice } from '../camera';
import { Device } from '../device/Device';
import { ClipScreen, screenPoint, StillScreen } from '../device/Screen';
import { Studio } from '../fx/Studio';
import { TapRing } from '../fx/TapRing';
import { crop, cropSrc, point } from '../media';
import { cues, FPS, scenes, springs } from '../motion';
import { RISE_SPIN_END, risePose, showPose } from '../poses';
import { accent, DEVICE, shadow } from '../theme';
import { Headline, WordDrop } from '../text/Headline';

export function Hook({ copy }: { copy: Copy }) {
  return (
    <>
      <Studio />
      <WordDrop lines={copy.hook} cues={cues.hookWords} exitAt={100} top={600} />
    </>
  );
}

export function Rise() {
  const frame = useCurrentFrame();
  const [bx, by] = screenPoint(...point('createButton'));
  const device = (
    <Device
      pose={risePose}
      sweepAt={RISE_SPIN_END}
      screen={<StillScreen id="home-top" />}
      overlay={<TapRing x={bx} y={by} at={cues.createTap - scenes.rise.start} size={120} />}
    />
  );
  return (
    <>
      <Studio glow={accent.sky.glow} glowY={1720} />
      {frame < RISE_SPIN_END - 10 ? (
        <CameraMotionBlur shutterAngle={180} samples={6}>
          {device}
        </CameraMotionBlur>
      ) : (
        device
      )}
    </>
  );
}

export function Show({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const start = scenes.show.start;
  const freeze = cues.showFreeze - start;
  const card = crop('card');
  const lift = spring({ frame: frame - (cues.popLift - start), fps: FPS, config: springs.lift });
  const settle = spring({ frame: frame - (cues.popSettle - start), fps: FPS, config: springs.settle });
  const height = lift - settle;
  const [lx, ly] = captureToDevice(card.x, card.y);
  const left = lx + DEVICE.body.width / 2;
  const top = ly + DEVICE.body.height / 2;

  return (
    <>
      <Studio glow={accent.sky.glow} glowY={1700} />
      <Device
        pose={showPose(frame)}
        sweepAt={0}
        screen={
          frame < freeze ? (
            <Sequence durationInFrames={freeze} layout="none">
              <ClipScreen id="home" rate={1.5} />
            </Sequence>
          ) : (
            <StillScreen id="home-card" />
          )
        }
        above={
          frame >= freeze ? (
            <div
              style={{
                position: 'absolute',
                left,
                top,
                width: card.w * DEVICE.scale,
                height: card.h * DEVICE.scale,
                borderRadius: 25 * 2 * DEVICE.scale,
                overflow: 'hidden',
                transform: `translateZ(${height * 150}px) translate(${-height * 14}px, ${-height * 26}px) scale(${1 + height * 0.1})`,
                boxShadow: height > 0.01 ? shadow.float : 'none',
              }}
            >
              <Img src={cropSrc('card')} style={{ width: '100%', height: '100%', display: 'block' }} />
            </div>
          ) : null
        }
      />
      <Headline lines={copy.show} at={6} exitAt={222} />
    </>
  );
}
