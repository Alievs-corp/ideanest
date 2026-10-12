import { describe, expect, it } from 'vitest';
import { focusPose, mixPose, project, projectCapture, REST } from './camera';
import { DEVICE, FRAME, IPHONE_BUTTONS } from './theme';

describe('the device camera', () => {
  it('puts the centre of an untransformed device at the centre of the frame', () => {
    expect(project(REST, 0, 0)).toEqual([FRAME.width / 2, FRAME.height / 2]);
  });

  it('shrinks a point that rotates away from the viewer', () => {
    const [x] = project({ ...REST, ry: 30 }, 300, 0);
    expect(x - FRAME.width / 2).toBeLessThan(300);
    expect(x - FRAME.width / 2).toBeGreaterThan(0);
  });

  it('frames a capture point exactly where the shot asks for it, tilted and scaled', () => {
    const base = { x: 0, y: 0, rx: 10, ry: -14, rz: 2, s: 1 };
    const pose = focusPose(base, 280, 1505, 1.6, [540, 1200]);
    const [x, y] = projectCapture(pose, 280, 1505);
    expect(x).toBeCloseTo(540, 6);
    expect(y).toBeCloseTo(1200, 6);
  });

  it('builds the body to iPhone 17 Pro proportions, 71.9 x 150.0 x 8.75 mm', () => {
    expect(DEVICE.depth / DEVICE.body.width).toBeCloseTo(8.75 / 71.9, 2);
    expect(DEVICE.body.height / DEVICE.body.width).toBeCloseTo(150 / 71.9, 1);
    for (const b of [...IPHONE_BUTTONS.left, ...IPHONE_BUTTONS.right]) {
      expect(b.to * DEVICE.mm).toBeLessThan(DEVICE.body.height);
    }
  });

  it('blends poses linearly', () => {
    const a = { x: 0, y: 0, rx: 0, ry: 0, rz: 0, s: 1 };
    const b = { x: 100, y: -50, rx: 10, ry: 20, rz: -4, s: 2 };
    expect(mixPose(a, b, 0.5)).toEqual({ x: 50, y: -25, rx: 5, ry: 10, rz: -2, s: 1.5 });
  });
});
