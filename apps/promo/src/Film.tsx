import { AbsoluteFill, Html5Audio, interpolate, Sequence, useCurrentFrame } from 'remotion';
import { COPY, type Language } from './copy';
import { Grain } from './fx/Grain';
import { SparkLayer } from './fx/SparkLayer';
import { soundtrackSrc } from './media';
import { scenes, type Span } from './motion';
import { Brand, Funded } from './scenes/Finale';
import { Gather, Montage, Pledge } from './scenes/Middle';
import { Hook, Rise, Show } from './scenes/Opening';
import { colors } from './theme';

export interface FilmProps {
  lang: Language;
  sound: boolean;
  [key: string]: unknown;
}

const span = (scene: Span) => ({ from: scene.start, durationInFrames: scene.end - scene.start });

export function Film({ lang, sound }: FilmProps) {
  const frame = useCurrentFrame();
  const copy = COPY[lang];
  const grain = interpolate(frame, [scenes.end.start, scenes.end.start + 12], [0.035, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const brandFrom = scenes.return.start;
  return (
    <AbsoluteFill style={{ background: colors.surface1 }}>
      <Sequence {...span(scenes.hook)} name="Hook">
        <Hook copy={copy} />
      </Sequence>
      <Sequence {...span(scenes.rise)} name="Rise">
        <Rise />
      </Sequence>
      <Sequence {...span(scenes.show)} name="Show">
        <Show copy={copy} />
      </Sequence>
      <Sequence {...span(scenes.gather)} name="Gather">
        <Gather copy={copy} />
      </Sequence>
      <Sequence {...span(scenes.montage)} name="Montage">
        <Montage copy={copy} />
      </Sequence>
      <Sequence {...span(scenes.pledge)} name="Pledge">
        <Pledge copy={copy} />
      </Sequence>
      <Sequence {...span(scenes.funded)} name="Funded">
        <Funded copy={copy} />
      </Sequence>
      <Sequence from={brandFrom} durationInFrames={scenes.end.end - brandFrom} name="Brand">
        <Brand copy={copy} />
      </Sequence>
      <SparkLayer />
      {grain > 0 ? <Grain opacity={grain} /> : null}
      {sound ? <Html5Audio src={soundtrackSrc()} /> : null}
    </AbsoluteFill>
  );
}
