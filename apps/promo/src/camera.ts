import { CAPTURE, DEVICE, FRAME } from './theme';

export const PERSPECTIVE = 2200;
export const SCREEN_Z = DEVICE.depth / 2 + 1;

export interface Pose {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
}

export const REST: Pose = { x: 0, y: 0, rx: 0, ry: 0, rz: 0, s: 1 };

export function poseTransform(p: Pose): string {
  return `translate3d(${p.x}px, ${p.y}px, 0) rotateX(${p.rx}deg) rotateY(${p.ry}deg) rotateZ(${p.rz}deg) scale(${p.s})`;
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const m = (u: number, v: number) => u + (v - u) * t;
  return { x: m(a.x, b.x), y: m(a.y, b.y), rx: m(a.rx, b.rx), ry: m(a.ry, b.ry), rz: m(a.rz, b.rz), s: m(a.s, b.s) };
}

export function captureToDevice(cx: number, cy: number): [number, number] {
  const left = DEVICE.bezel + cx * DEVICE.scale;
  const top = DEVICE.bezel + DEVICE.statusBar + cy * DEVICE.scale;
  return [left - DEVICE.body.width / 2, top - DEVICE.body.height / 2];
}

export function project(p: Pose, lx: number, ly: number, lz = 0): [number, number] {
  const [x, y] = projectWithDepth(p, lx, ly, lz);
  return [x, y];
}

function projectWithDepth(p: Pose, lx: number, ly: number, lz = 0): [number, number, number] {
  const rad = Math.PI / 180;
  let x = lx * p.s;
  let y = ly * p.s;
  let z = lz * p.s;

  const cz = Math.cos(p.rz * rad);
  const sz = Math.sin(p.rz * rad);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];

  const cy = Math.cos(p.ry * rad);
  const sy = Math.sin(p.ry * rad);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];

  const cx = Math.cos(p.rx * rad);
  const sx = Math.sin(p.rx * rad);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];

  x += p.x;
  y += p.y;

  const k = PERSPECTIVE / (PERSPECTIVE - z);
  return [FRAME.width / 2 + x * k, FRAME.height / 2 + y * k, k];
}

export function projectCapture(p: Pose, cx: number, cy: number): [number, number] {
  const [lx, ly] = captureToDevice(cx, cy);
  return project(p, lx, ly, SCREEN_Z);
}

export function focusPose(base: Pose, cx: number, cy: number, s: number, target: [number, number]): Pose {
  const [lx, ly] = captureToDevice(cx, cy);
  const [fx, fy, k] = projectWithDepth({ ...base, x: 0, y: 0, s }, lx, ly, SCREEN_Z);
  return {
    ...base,
    s,
    x: (target[0] - fx) / k,
    y: (target[1] - fy) / k,
  };
}

export const CAPTURE_SIZE = CAPTURE;
