import type { CSSProperties } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { fontFamily } from '../fonts';
import { dur, ease, STAGGER } from '../motion';
import { colors, SAFE, TYPE } from '../theme';

interface HeadlineProps {
  lines: readonly string[];
  at: number;
  exitAt?: number;
  top?: number;
  size?: number;
  weight?: 600 | 800;
  color?: string;
  align?: 'left' | 'center';
  style?: CSSProperties;
}

export function Headline({
  lines,
  at,
  exitAt,
  top = SAFE.top + 20,
  size = TYPE.headline,
  weight = 800,
  color = colors.textPrimary,
  align = 'left',
  style,
}: HeadlineProps) {
  const frame = useCurrentFrame();
  const last = lines.length - 1;
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: SAFE.side,
        right: SAFE.side,
        textAlign: align,
        fontFamily,
        fontWeight: weight,
        fontSize: size,
        lineHeight: TYPE.leading,
        letterSpacing: TYPE.tracking,
        color,
        ...style,
      }}
    >
      {lines.map((line, i) => {
        const start = at + i * STAGGER * 2;
        const rise = interpolate(frame - start, [0, dur.textLine], [110, 0], {
          easing: ease.enter,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const fade = interpolate(frame - start, [0, dur.textLine / 3], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        let out = 0;
        if (exitAt !== undefined) {
          const exitStart = exitAt + (last - i) * STAGGER;
          out = interpolate(frame - exitStart, [0, dur.textExit], [0, -110], {
            easing: ease.exit,
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
        }
        return (
          <div key={i} style={{ overflow: 'hidden', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
            <div style={{ transform: `translateY(${rise + out}%)`, opacity: fade }}>{line}</div>
          </div>
        );
      })}
    </div>
  );
}

interface WordDropProps {
  lines: readonly string[];
  cues: readonly number[];
  exitAt: number;
  top: number;
  size?: number;
}

export function WordDrop({ lines, cues, exitAt, top, size = TYPE.headlineLarge }: WordDropProps) {
  const frame = useCurrentFrame();
  const total = lines.reduce((n, line) => n + line.split(' ').length, 0);
  let index = 0;

  const renderWord = (word: string, i: number) => {
    const t = frame - (cues[i] ?? 0);
    const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
    const y = interpolate(t, [0, dur.wordDrop], [40, 0], { easing: ease.enter, ...clamp });
    const s = interpolate(t, [0, dur.wordDrop], [1.04, 1], { easing: ease.enter, ...clamp });
    const o = interpolate(t, [0, dur.wordDrop], [0, 1], { easing: ease.enter, ...clamp });
    const exit = interpolate(frame - exitAt - (total - 1 - i) * STAGGER, [0, dur.textExit], [0, 1], {
      easing: ease.exit,
      ...clamp,
    });
    return (
      <span
        key={i}
        style={{
          display: 'inline-block',
          margin: '0 0.12em',
          transform: `translateY(${y - exit * 60}px) scale(${s})`,
          opacity: o * (1 - exit),
        }}
      >
        {word}
      </span>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: SAFE.side,
        right: SAFE.side,
        textAlign: 'center',
        fontFamily,
        fontWeight: 800,
        fontSize: size,
        lineHeight: TYPE.leading,
        letterSpacing: TYPE.tracking,
        color: colors.textPrimary,
      }}
    >
      {lines.map((line, li) => (
        <div key={li}>{line.split(' ').map((word) => renderWord(word, index++))}</div>
      ))}
    </div>
  );
}
