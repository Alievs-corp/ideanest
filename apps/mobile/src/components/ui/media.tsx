import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { motion, radius as radii } from '../../theme';
import { useMotionAllowed } from './motion-budget';
import { BLOCK, blockSurface, useSurface } from './surface';

/**
 * The media primitive — the native `Media` and `MediaFrame` (`docs/ui-kit.md` §7.16).
 *
 * <h2>The box is reserved before the bytes arrive</h2>
 *
 * `MediaFrame` sets `aspectRatio` on a view that is already the width of its column, so the
 * picture's height is known on the first frame and nothing below it moves when it decodes. A crop
 * token for a cropped image (every discovery card cuts its cover to 16:9); the image's own
 * `{ width, height }` for one shown whole, because reserving 16:9 for a portrait photograph is a
 * layout shift with extra steps. A size that cannot be a ratio — zero, negative, not finite, what a
 * failed measurement leaves behind — falls back to 16:9, keeping the box.
 *
 * <h2>Alt is a decision the caller has to make</h2>
 *
 * The props are a union: `{ alt: string }` or `{ decorative: true }`, never neither and never both,
 * so a meaningful image cannot be left unnamed at compile time. A named image is an accessible
 * `image` with the alt as its label; a decorative one is hidden, which on a card whose own name
 * already says what the picture shows is the right answer rather than the lazy one.
 *
 * <p>An empty `alt` is treated as decorative, which is what `alt=""` means on the web. It is the
 * type checker's gap — `''` is a string — and it arrives at run time from data (a caption nobody
 * wrote), so refusing it in development would not catch the case that matters. The alternative is
 * an image announced as "image" with no name, which is worse than one not announced at all.
 *
 * <h2>Motion</h2>
 *
 * The picture arriving is the skill's skeleton → content crossfade (`mobile-design` §6.3): the
 * reserved block (`surface3` on the canvas, `whiteMuted` in a white sheet) or the inline preview,
 * then the picture over it on opacity alone — `expo-image`'s native `transition` of
 * `motion.overlay`, off the JS thread. It is a load, not an entry, so it runs in lists too. With
 * Reduce Motion the picture replaces the placeholder at once (`transition={0}`).
 */

export const MEDIA_RATIOS = {
  /** A project cover, everywhere it is cropped. */
  '16/9': 16 / 9,
  /** Editorial and reward imagery. */
  '3/2': 3 / 2,
  /** Denser cards, where a 16:9 strip reads as a letterbox. */
  '4/3': 4 / 3,
  /** Avatars, tiles, anything square. */
  '1/1': 1,
} as const;

export type MediaRatioToken = keyof typeof MEDIA_RATIOS;

/** The intrinsic pixel size of an image shown whole. */
export interface IntrinsicSize {
  readonly width: number;
  readonly height: number;
}

export type MediaRatio = MediaRatioToken | IntrinsicSize;

/** Radius tokens; `none` for a frame inside a card that already clips. */
export type MediaRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl';

const RADIUS: Record<MediaRadius, number> = {
  none: 0,
  sm: radii.sm,
  md: radii.md,
  lg: radii.lg,
  xl: radii.xl,
};

/** The `aspectRatio` for a ratio, falling back to 16:9 for a size that cannot be one. */
export function aspectRatioOf(ratio: MediaRatio): number {
  if (typeof ratio === 'string') return MEDIA_RATIOS[ratio];
  const { width, height } = ratio;
  const usable = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  return usable ? width / height : MEDIA_RATIOS['16/9'];
}

/**
 * True for a placeholder this component will draw: an inline `data:image/…;base64,…` URI, the
 * low-quality preview the API sends, as the web accepts. Anything else is ignored — a remote
 * address would be a second request for the thing the placeholder exists to cover.
 */
export function isPlaceholderUri(value: string): boolean {
  return /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(value);
}

export interface MediaFrameProps {
  /** A crop token, or the image's own `{ width, height }` when it is shown whole. */
  readonly ratio: MediaRatio;
  readonly radius?: MediaRadius;
  /** The picture, usually an `expo-image`. Absent, the reserved surface is drawn alone. */
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * The reserved, clipped placeholder box, for a caller that brings its own image element. `Media` is
 * the frame with an `expo-image` already in it.
 */
export function MediaFrame({ ratio, radius = 'none', children, style, testID }: MediaFrameProps) {
  const placeholder = BLOCK[blockSurface(useSurface())].placeholder;
  return (
    <View
      testID={testID}
      style={[
        styles.frame,
        {
          aspectRatio: aspectRatioOf(ratio),
          borderRadius: RADIUS[radius],
          backgroundColor: placeholder,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Either a description or an explicit statement that there is nothing to describe. */
export type MediaAlt =
  | { readonly alt: string; readonly decorative?: false }
  | { readonly alt?: never; readonly decorative: true };

export type MediaProps = {
  /** The picture's URL. */
  readonly src: string;
  readonly ratio: MediaRatio;
  readonly radius?: MediaRadius;
  /** A `data:image/…;base64,…` preview drawn until the picture covers it. */
  readonly placeholder?: string | null;
  /** `cover` crops to the frame; `contain` letterboxes inside it. */
  readonly fit?: 'cover' | 'contain';
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
} & MediaAlt;

export function Media(props: MediaProps) {
  const { src, ratio, radius = 'none', placeholder, fit = 'cover', style, testID } = props;
  const fades = useMotionAllowed('minimal');
  const named = props.decorative !== true && props.alt !== undefined && props.alt !== '';
  const preview =
    placeholder !== undefined && placeholder !== null && isPlaceholderUri(placeholder)
      ? { uri: placeholder }
      : undefined;

  return (
    <MediaFrame ratio={ratio} radius={radius} style={style}>
      <Image
        testID={testID}
        source={{ uri: src }}
        placeholder={preview}
        placeholderContentFit="cover"
        contentFit={fit}
        transition={fades ? motion.overlay : 0}
        style={styles.fill}
        accessible={named}
        accessibilityRole={named ? 'image' : undefined}
        accessibilityLabel={named ? props.alt : undefined}
        accessibilityElementsHidden={!named}
        importantForAccessibility={named ? 'yes' : 'no-hide-descendants'}
      />
    </MediaFrame>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
