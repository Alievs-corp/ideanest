import { useState } from 'react';
import {
  StyleSheet,
  Text as RNText,
  type TextLayoutLine,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { colors, font, fontSize, lineHeight, readingMeasure, tracking } from '../theme';
import { TONES, useSurface, type RelativeTone, type Surface } from './ui/surface';

/**
 * Typography, as the roles the screens actually use.
 *
 * <h2>Why roles rather than props</h2>
 *
 * A `<Text size={18} weight="500" tracking={-0.36}>` moves the decision to the
 * call site, and the decision is not the call site's to make: `docs/ui-kit.md`
 * §5.3 pairs a size with a weight and a tracking, and the pairing is the design.
 * Screens ask for a heading and get the heading, which is also what makes a
 * change to the scale a change to one file.
 *
 * <h2>Colour follows the surface</h2>
 *
 * Colour is a role too. `Body` is secondary and `Heading` is primary because
 * that is the hierarchy §2.2 describes — but "secondary" is `white/64` on a dark
 * card, `on-lime/72` on a lime one and `on-white/64` on a white panel, and the
 * role cannot know which it is on. `SurfaceContext` tells it (see
 * `ui/surface.tsx`), which is the native half of the web's `data-on-lime`. A
 * `tone` of `onLime` or `onWhite` still pins the colour, for the rare text that
 * sits on a lime or white shape nobody declared as a surface.
 *
 * <p>There is no `lime` tone and there never will be: lime is a surface or a
 * border, never text (CLAUDE.md §2). `src/theme/theme.test.ts` fails the build
 * on a text colour set to any lime token anywhere under `src/`.
 *
 * <h2>Inter, as a face per weight</h2>
 *
 * Every role spreads one of `theme.font`'s three faces instead of setting a bare
 * `fontWeight`, because on Android a weight only picks the right file when the
 * family asked for is the XML family the build registered. See `font` in
 * `src/theme/index.ts`. Dynamic Type stays on: nothing here sets
 * `maxFontSizeMultiplier`, and layouts wrap rather than truncate.
 */

export type Tone = RelativeTone | 'onLime' | 'onWhite' | 'reading';

/** The colour a tone resolves to on a surface. Exported for the contrast test. */
export function toneColor(tone: Tone, surface: Surface): string {
  switch (tone) {
    case 'onLime':
      return colors.textOnLime;
    case 'onWhite':
      return colors.textOnWhite;
    case 'reading':
      // The near-white reading colour exists to soften white on black. On lime or white the
      // surface's own primary tone is the reading colour.
      return surface === 'dark' ? colors.textReading : TONES[surface].primary;
    default:
      return TONES[surface][tone];
  }
}

export interface TextProps extends RNTextProps {
  readonly tone?: Tone;
}

export const HEADLINE_SCALE = 0.95;

const MIN_FIT = 0.6;
const FIT_STEP = 0.92;

export function breaksMidWord(lines: readonly Pick<TextLayoutLine, 'text'>[]): boolean {
  return lines.slice(0, -1).some((line) => !/[\s/-]$/u.test(line.text));
}

export function WordFitText({ style, onTextLayout, children, ...rest }: RNTextProps) {
  const [fit, setFit] = useState({ text: children, scale: 1 });
  const scale = fit.text === children ? fit.scale : 1;
  const flat: TextStyle = StyleSheet.flatten(style) ?? {};
  const scaled =
    scale === 1
      ? null
      : {
          fontSize: (flat.fontSize ?? 0) * scale,
          lineHeight: flat.lineHeight === undefined ? undefined : flat.lineHeight * scale,
          letterSpacing: flat.letterSpacing === undefined ? undefined : flat.letterSpacing * scale,
        };
  return (
    <RNText
      {...rest}
      android_hyphenationFrequency="none"
      style={[style, scaled]}
      onTextLayout={(event) => {
        onTextLayout?.(event);
        if (scale > MIN_FIT && breaksMidWord(event.nativeEvent.lines)) {
          setFit({ text: children, scale: Math.max(MIN_FIT, scale * FIT_STEP) });
        }
      }}
    >
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  display: {
    ...font.semibold,
    fontSize: fontSize.display * HEADLINE_SCALE,
    lineHeight: Math.round(lineHeight.display * HEADLINE_SCALE),
    letterSpacing: tracking.display * HEADLINE_SCALE,
  },
  heading: {
    ...font.semibold,
    fontSize: fontSize.h2,
    lineHeight: lineHeight.h2,
    letterSpacing: tracking.h2,
  },
  subheading: {
    ...font.semibold,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
  },
  cardTitle: {
    ...font.medium,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.cardTitle,
    letterSpacing: tracking.cardTitle,
  },
  body: {
    ...font.regular,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    letterSpacing: tracking.body,
  },
  story: {
    ...font.regular,
    fontSize: fontSize.reading,
    lineHeight: lineHeight.story,
    letterSpacing: tracking.reading,
    maxWidth: readingMeasure,
  },
  caption: {
    ...font.regular,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
    letterSpacing: tracking.tag,
  },
  meta: {
    ...font.medium,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.body,
    letterSpacing: tracking.tag,
  },
  eyebrow: {
    ...font.medium,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    letterSpacing: tracking.eyebrow,
    textTransform: 'uppercase',
  },
});

function role(style: object, defaultTone: Tone, fitWords = false) {
  const Base = fitWords ? WordFitText : RNText;
  return function Role({ tone = defaultTone, style: override, ...rest }: TextProps) {
    const surface = useSurface();
    return <Base {...rest} style={[style, { color: toneColor(tone, surface) }, override]} />;
  };
}

/** The one figure a screen leads with. §7.7's headline figure. */
export const Display = role(styles.display, 'primary', true);

/** A section heading, and a screen's title: 24pt is the web's screen H1 at phone width. */
export const Heading = role(styles.heading, 'primary');

/** A heading below a section heading. */
export const Subheading = role(styles.subheading, 'primary');

/** A card's title. 18px, medium, per §5.3. */
export const CardTitle = role(styles.cardTitle, 'primary');

/** Ordinary prose. */
export const Body = role(styles.body, 'secondary');

/**
 * Long-form reading: the campaign story, a static page. 17pt at 1.75, the web's
 * `--text-reading` paragraph, and capped at about 68 characters a line where the
 * screen is wide enough to exceed it.
 */
export const Story = role(styles.story, 'reading');

/** A field's hint, a line of meta under a row. 13pt. */
export const Caption = role(styles.caption, 'secondary');

/** A tag, a count, a timestamp. */
export const Meta = role(styles.meta, 'tertiary');

/** The small uppercase label above a section. 12pt, +0.06em. */
export const Eyebrow = role(styles.eyebrow, 'tertiary');
