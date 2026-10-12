import { Easing } from 'remotion';
import { STAGGER_STEP } from '@ideanest/design-tokens';
import timeline from './timeline.json';

export const FPS = timeline.fps;
export const BPM = timeline.bpm;
export const BEAT = (60 / BPM) * FPS;
export const HALF = BEAT / 2;
export const BAR = BEAT * 4;
export const DURATION = timeline.durationInFrames;
export const STAGGER = Math.round((STAGGER_STEP / 1000) * FPS);

export const ease = {
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  exit: Easing.bezier(0.7, 0, 0.84, 0),
  move: Easing.bezier(0.65, 0, 0.35, 1),
  drift: Easing.linear,
};

export const springs = {
  settle: { damping: 200, mass: 1, stiffness: 120 },
  lift: { damping: 200, mass: 0.8, stiffness: 180 },
  heavy: { damping: 200, mass: 1.6, stiffness: 90 },
} as const;

export const dur = {
  textLine: 27,
  textExit: 18,
  wordDrop: 18,
  pop: 30,
  settle: 36,
  tapRing: 27,
  whipOut: 12,
  whipIn: 21,
  sparkCarry: 30,
  avatarFlight: 36,
  odometerColumn: 33,
  countUp: 48,
  radialReveal: 48,
  logoResolve: 90,
  ctaGrow: 21,
  endHold: 150,
} as const;

type SceneId = keyof typeof timeline.scenes;
export interface Span {
  start: number;
  end: number;
}

export const scenes = Object.fromEntries(
  Object.entries(timeline.scenes).map(([id, [start = 0, end = 0]]) => [id, { start, end }]),
) as Record<SceneId, Span>;
export const cues = timeline.cues;
