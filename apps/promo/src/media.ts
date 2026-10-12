import { staticFile } from 'remotion';
import captures from '../captures.json';

export type ClipId = (typeof captures.clips)[number]['id'];
export type StillId = (typeof captures.stills)[number]['id'];
export type CropId = (typeof captures.crops)[number]['id'];
export type PointId = keyof typeof captures.points;

export const clipSrc = (id: ClipId) => staticFile(`media/clips/${id}.mp4`);
export const stillSrc = (id: StillId) => staticFile(`media/stills/${id}.png`);
export const cropSrc = (id: CropId) => staticFile(`media/crops/${id}.png`);
export const grainSrc = () => staticFile('media/fx/grain.png');
export const soundtrackSrc = () => staticFile('media/audio/soundtrack.wav');

export function point(id: PointId): [number, number] {
  const [x, y] = captures.points[id];
  return [x ?? 0, y ?? 0];
}

export function crop(id: CropId) {
  const found = captures.crops.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown crop ${id}`);
  return found;
}
