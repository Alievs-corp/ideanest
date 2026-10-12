import { Img, useCurrentFrame } from 'remotion';
import { clipFrameCount, clipFrameSrc, stillSrc, type ClipId, type StillId } from '../media';
import { CAPTURE, DEVICE } from '../theme';

const size = { width: CAPTURE.width * DEVICE.scale, height: CAPTURE.height * DEVICE.scale };

export function ClipScreen({ id, rate = 1 }: { id: ClipId; rate?: number }) {
  const frame = useCurrentFrame();
  const index = Math.min(clipFrameCount(id) - 1, Math.max(0, Math.floor(frame * rate)));
  return <Img src={clipFrameSrc(id, index)} style={{ ...size, display: 'block' }} />;
}

export function StillScreen({ id }: { id: StillId }) {
  return <Img src={stillSrc(id)} style={{ ...size, display: 'block' }} />;
}

export function screenPoint(cx: number, cy: number): [number, number] {
  return [cx * DEVICE.scale, cy * DEVICE.scale];
}
