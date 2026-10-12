import { Trail } from '@remotion/motion-blur';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { projectCapture } from '../camera';
import { point } from '../media';
import { BEAT, cues, dur, ease, scenes } from '../motion';
import { fundedPose, risePose } from '../poses';
import { CTA_CENTER, MARK_DOT_AT, MARK_LAYOUT } from '../scenes/Finale';
import { MARK_DOT, MARK_VIEW } from '../ui/Mark';
import { Spark } from './Spark';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const HOME: [number, number] = [540, 1120];
const CENTER: [number, number] = [540, 960];
const MARK_DOT_SIZE = 2 * MARK_DOT.r * (MARK_LAYOUT.height / MARK_VIEW.height);

const breath = (f: number) => 1 + 0.08 * ((1 - Math.cos((2 * Math.PI * f) / BEAT)) / 2);

const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

interface SparkState {
  at: [number, number];
  scale: number;
  glow: number;
  core: number;
  moving: boolean;
}

function sparkAt(f: number): SparkState | null {
  const still = (at: [number, number], scale = 1): SparkState => ({ at, scale, glow: 1, core: 14, moving: false });

  if (f < cues.sparkLaunch) {
    const ignite = interpolate(f, [0, 18], [0, 1], { easing: ease.enter, ...clamp });
    return still(HOME, ignite * breath(f));
  }
  if (f < cues.createTap + 6) {
    const target = projectCapture(risePose(cues.createTap - scenes.rise.start), ...point('createButton'));
    const t = interpolate(f, [cues.sparkLaunch, cues.sparkLaunch + dur.sparkCarry], [0, 1], { easing: ease.move, ...clamp });
    const absorb = interpolate(f, [cues.createTap, cues.createTap + 6], [1, 0], clamp);
    return { ...still(lerp(HOME, target, t), absorb), moving: t < 1 };
  }
  if (f >= cues.reveal - 30 && f < cues.reveal + 6) {
    const at = projectCapture(fundedPose(f - scenes.funded.start), ...point('fundedProgressEnd'));
    const appear = interpolate(f, [cues.reveal - 30, cues.reveal - 18], [0, 1], { easing: ease.enter, ...clamp });
    return still(at, appear * breath(f));
  }
  if (f >= cues.contract + 30 && f < cues.wordmark) {
    const appear = interpolate(f, [cues.contract + 30, cues.contract + 42], [0, 1], { easing: ease.enter, ...clamp });
    const travel = interpolate(f, [cues.collapse + 15, cues.collapse + 45], [0, 1], { easing: ease.move, ...clamp });
    const settle = interpolate(f, [cues.collapse + 45, cues.wordmark], [0, 1], { easing: ease.enter, ...clamp });
    return {
      at: lerp(CENTER, MARK_DOT_AT, travel),
      scale: appear * (travel > 0 ? 1 : breath(f)),
      glow: 1 - settle,
      core: 14 + (MARK_DOT_SIZE - 14) * settle,
      moving: travel > 0 && travel < 1,
    };
  }
  if (f >= cues.ctaDrop && f < cues.cta) {
    const t = interpolate(f, [cues.ctaDrop, cues.cta], [0, 1], { easing: ease.move, ...clamp });
    return { ...still(lerp(MARK_DOT_AT, CTA_CENTER, t)), moving: true };
  }
  return null;
}

function SparkFrame() {
  const frame = useCurrentFrame();
  const state = sparkAt(frame);
  if (!state || state.scale <= 0) return null;
  return <Spark x={state.at[0]} y={state.at[1]} scale={state.scale} glow={state.glow} core={state.core} />;
}

export function SparkLayer() {
  const frame = useCurrentFrame();
  const moving = sparkAt(frame)?.moving ?? false;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {moving ? (
        <Trail layers={6} lagInFrames={1} trailOpacity={0.35}>
          <AbsoluteFill>
            <SparkFrame />
          </AbsoluteFill>
        </Trail>
      ) : (
        <SparkFrame />
      )}
    </AbsoluteFill>
  );
}
