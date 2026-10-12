import { Composition } from 'remotion';
import { LANGUAGES } from './copy';
import { Film } from './Film';
import { DURATION, FPS } from './motion';
import { FRAME } from './theme';

export function Root() {
  return (
    <>
      {LANGUAGES.map((lang) => (
        <Composition
          key={lang}
          id={`SparkToNest-9x16-${lang}`}
          component={Film}
          durationInFrames={DURATION}
          fps={FPS}
          width={FRAME.width}
          height={FRAME.height}
          defaultProps={{ lang, sound: true }}
        />
      ))}
    </>
  );
}
