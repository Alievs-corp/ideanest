import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { grainSrc } from '../media';

export function Grain({ opacity = 0.035 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const step = Math.floor(frame / 2);
  const ox = Math.floor(random(`gx${step}`) * 256);
  const oy = Math.floor(random(`gy${step}`) * 256);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${grainSrc()})`,
        backgroundRepeat: 'repeat',
        backgroundPosition: `${ox}px ${oy}px`,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
}
