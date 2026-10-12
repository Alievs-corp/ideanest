import { interpolate, spring } from 'remotion';
import { focusPose, mixPose, type Pose } from './camera';
import { point } from './media';
import { BAR, ease, FPS, springs } from './motion';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const drift = (rel: number, length: number) => interpolate(rel, [0, length], [0, 1], { easing: ease.drift, ...clamp });

export function risePose(rel: number): Pose {
  const rise = spring({ frame: rel, fps: FPS, config: springs.heavy });
  const d = drift(rel, BAR);
  return {
    x: 0,
    y: interpolate(rise, [0, 1], [1500, 170]),
    rx: 16 - 4 * d,
    ry: -20 + 6 * d,
    rz: 4 - 2 * d,
    s: 1,
  };
}

export function showPose(rel: number): Pose {
  const d = drift(rel, BAR * 2);
  return { x: 0, y: 230, rx: 12 - 2 * d, ry: 18 - 8 * d, rz: -3 + 2 * d, s: 0.92 + 0.03 * d };
}

const MONTAGE_POSES: readonly Pose[] = [
  { x: 0, y: 240, rx: 10, ry: -18, rz: 2, s: 0.9 },
  { x: 0, y: 240, rx: 8, ry: 16, rz: -2, s: 0.9 },
  { x: 0, y: 240, rx: 10, ry: -14, rz: 1.5, s: 0.9 },
];

export function montagePose(rel: number): Pose {
  const shot = Math.min(3, Math.floor(rel / 60));
  const local = rel - shot * 60;
  const d = drift(local, 60);
  if (shot < 3) {
    const base = MONTAGE_POSES[shot] ?? MONTAGE_POSES[0]!;
    const dir = base.ry < 0 ? 1 : -1;
    const pose = { ...base, ry: base.ry + dir * 6 * d, s: base.s + 0.03 * d };
    if (shot === 2) {
      pose.x = interpolate(local, [48, 60], [0, -1500], { easing: ease.exit, ...clamp });
    }
    return pose;
  }
  const macro = focusPose({ x: 0, y: 0, rx: 10, ry: 8 - 4 * d, rz: -1, s: 1 }, ...point('tumarProgress'), 1.6 + 0.08 * d, [540, 1330]);
  macro.x += interpolate(local, [0, 21], [1500, 0], { easing: ease.enter, ...clamp });
  return macro;
}

export function pledgePose(rel: number): Pose {
  const d = drift(rel, BAR * 2);
  const base: Pose = { x: 0, y: 300, rx: 8, ry: -10 + 6 * d, rz: 1, s: 1 };
  const focus = focusPose(base, ...point('rewardSelect'), 1.45, [540, 1330]);
  const inT = interpolate(rel, [60, 110], [0, 1], { easing: ease.move, ...clamp });
  const outT = interpolate(rel, [140, 180], [0, 1], { easing: ease.move, ...clamp });
  return mixPose(mixPose(base, focus, inT), base, outT);
}

export function fundedPose(rel: number): Pose {
  const d = drift(rel, BAR * 2);
  const base: Pose = { x: 0, y: 400, rx: 12, ry: -10 + 6 * d, rz: 1, s: 0.86 };
  const focus = focusPose(base, ...point('fundedAmount'), 1.2, [500, 1320]);
  const t = interpolate(rel, [60, 150], [0, 1], { easing: ease.move, ...clamp });
  return mixPose(base, focus, t);
}
