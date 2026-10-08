import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * The media primitive. See docs/ui-kit.md §7.16.
 *
 * THE BOX IS RESERVED BEFORE THE BYTES ARRIVE. `MediaFrame` sets `aspect-ratio`
 * on a block that is already the width of its column, so the height of the
 * picture is known at first paint and nothing below it moves when the image
 * decodes. docs/motion-system.md §8 puts cumulative layout shift under 0.05;
 * an unreserved image in a card grid spends that budget on its own.
 *
 * THE RATIO IS EITHER A CROP OR THE TRUTH. A discovery card cuts every cover to
 * 16:9 whatever was uploaded, so it passes a token. A cover shown whole passes
 * the intrinsic `{ width, height }` the image actually has. Reserving 16:9 for
 * a portrait photograph is a layout shift with extra steps: the box is right
 * and the picture is not in it.
 *
 * THE FRAME IS NOT AN IMAGE ELEMENT, deliberately. `next/image` lives in the
 * application and cannot be imported here — this package is rendered by
 * Storybook and by Vitest, neither of which is Next. So the frame takes the
 * image as its child and owns only what is framework-independent: the reserved
 * box, the placeholder underneath it, the radius, and the clip. `Media` is the
 * same frame with a plain `<img>` already in it, for the surfaces that have no
 * optimiser to reach for.
 *
 * NOTHING HERE ANIMATES. The placeholder is painted, the image paints over it,
 * and no property transitions. Discovery's motion budget is "skeleton to
 * content crossfade only" (docs/motion-system.md §5.1) and this is not a
 * skeleton; a card grid that cross-fades twenty-four images is exactly the
 * long-list animation §8 forbids. There is therefore no reduced-motion branch,
 * because there is no motion to reduce.
 *
 * ALT IS A DECISION THE CALLER HAS TO MAKE. `Media` accepts either `alt` or
 * `decorative`, never neither and never both: a content image gets a sentence
 * and a decorative one gets `alt=""`. Leaving the attribute off entirely makes
 * a screen reader read the file name, which is the worst of the three.
 */

/**
 * The crops the system uses. A ratio is a design decision like a radius or a
 * duration, so the set is closed and lives here rather than being typed inline
 * at each call site (CLAUDE.md §6).
 */
export const MEDIA_RATIOS = {
  /** Project cover, everywhere it is cropped: discovery card, share image. */
  '16/9': '16 / 9',
  /** Editorial and reward imagery. */
  '3/2': '3 / 2',
  /** Denser cards where a 16:9 strip reads as a letterbox. */
  '4/3': '4 / 3',
  /** Avatars, tiles, anything square. */
  '1/1': '1 / 1',
} as const;

export type MediaRatioToken = keyof typeof MEDIA_RATIOS;

/** The intrinsic pixel size of the image, when it is shown whole. */
export interface IntrinsicSize {
  width: number;
  height: number;
}

export type MediaRatio = MediaRatioToken | IntrinsicSize;

/** Radius tokens, docs/ui-kit.md §4. `none` is for a frame inside a clipped card. */
const RADIUS = {
  none: '',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
} as const;

export type MediaRadius = keyof typeof RADIUS;

/**
 * The CSS `aspect-ratio` value for a ratio.
 *
 * A non-positive or non-finite intrinsic size falls back to the 16:9 token.
 * `width / 0` is an invalid declaration the browser drops, which would take the
 * reservation with it — and a cover recorded as 0×0 is exactly what a failed
 * measurement leaves behind (`lib/projects/coverImage.ts` says why it can
 * happen). Falling back keeps the box, which is the whole point of the frame.
 */
export function aspectRatioOf(ratio: MediaRatio): string {
  if (typeof ratio === 'string') return MEDIA_RATIOS[ratio];

  const { width, height } = ratio;
  const usable =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

  return usable ? `${width} / ${height}` : MEDIA_RATIOS['16/9'];
}

/**
 * True for a placeholder this component will paint.
 *
 * Only an inline `data:image/…` URI is accepted. A placeholder is interpolated
 * into a CSS `url()`, so an arbitrary string is an injection point, and a
 * remote address is a second request for the thing the placeholder exists to
 * cover up.
 */
export function isPlaceholderUri(value: string): boolean {
  return /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(value);
}

export interface MediaFrameProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'placeholder'> {
  /** A crop token, or the image's own `{ width, height }` when it is shown whole. */
  ratio: MediaRatio;
  radius?: MediaRadius;
  /**
   * A low-quality image placeholder as a `data:image/…;base64,…` URI, painted
   * blurred inside the reserved box until the real image covers it. Anything
   * else is ignored rather than rendered.
   */
  placeholder?: string;
  /** The image element. Absent renders the reserved surface and nothing else. */
  children?: ReactNode;
}

export function MediaFrame({
  ratio,
  radius = 'none',
  placeholder,
  className,
  style,
  children,
  ...props
}: MediaFrameProps) {
  const usablePlaceholder =
    placeholder !== undefined && isPlaceholderUri(placeholder) ? placeholder : null;

  return (
    <div
      data-media-frame=""
      /*
       * `relative` is load-bearing: `next/image` with `fill` positions itself
       * absolutely against the nearest positioned ancestor, and this is it.
       * `overflow-hidden` clips both the image and the scaled-up placeholder.
       */
      className={cn('relative w-full overflow-hidden bg-surface-3', RADIUS[radius], className)}
      style={{ aspectRatio: aspectRatioOf(ratio), ...style }}
      {...props}
    >
      {usablePlaceholder !== null && (
        /*
         * Scaled past the edges because `blur()` samples transparent pixels
         * outside the element and would otherwise leave a pale halo on all four
         * sides. It is a static transform, not an animation.
         */
        <span
          aria-hidden="true"
          data-media-placeholder=""
          className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center blur-md"
          style={{ backgroundImage: `url("${usablePlaceholder}")` }}
        />
      )}
      {children}
    </div>
  );
}

/** Either a description or an explicit statement that there is nothing to describe. */
type AltProps =
  | { alt: string; decorative?: false }
  | { alt?: never; decorative: true };

export type MediaProps = Omit<
  ComponentPropsWithoutRef<'img'>,
  'alt' | 'placeholder' | 'width' | 'height'
> & {
  src: string;
  ratio: MediaRatio;
  radius?: MediaRadius;
  placeholder?: string;
  /** `cover` crops to the frame; `contain` letterboxes inside it. */
  fit?: 'cover' | 'contain';
  /** Classes for the frame rather than the `<img>`. */
  frameClassName?: string;
} & AltProps;

/**
 * A framed `<img>` for surfaces with no image optimiser behind them.
 *
 * The application renders project imagery through `next/image` inside a bare
 * `MediaFrame`, because that is where the AVIF and WebP variants come from.
 * This is what Storybook shows and what any non-Next consumer uses, and it
 * carries the same reservation, the same placeholder, and the same alt
 * contract so the two cannot drift.
 */
export function Media({
  src,
  ratio,
  radius = 'none',
  placeholder,
  fit = 'cover',
  frameClassName,
  className,
  decorative,
  alt,
  loading = 'lazy',
  ...props
}: MediaProps) {
  return (
    <MediaFrame ratio={ratio} radius={radius} placeholder={placeholder} className={frameClassName}>
      <img
        src={src}
        alt={decorative === true ? '' : alt}
        loading={loading}
        decoding="async"
        className={cn(
          'absolute inset-0 size-full',
          fit === 'cover' ? 'object-cover' : 'object-contain',
          className,
        )}
        {...props}
      />
    </MediaFrame>
  );
}
