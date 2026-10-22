import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Loading placeholders. See docs/ui-kit.md §7.15.
 *
 * SANCTIONED MOTION. Discovery and search have a motion budget of "skeleton to
 * content crossfade only" (docs/motion-system.md §5) — speed outranks
 * everything there, and this is the one animation that survived the cut,
 * because it says "the request is alive" rather than "look at this".
 *
 * TRANSFORM ONLY. The shimmer is an overlay that TRANSLATES across the block
 * (`.skeleton-shimmer` in styles.css). Animating `background-position` instead
 * repaints the element on every frame off the main thread's critical path and
 * cannot be composited; a list of forty placeholders then costs more than the
 * content it is standing in for. See CLAUDE.md §2 and docs/motion-system.md §8.
 *
 * REDUCED MOTION IS HANDLED EXPLICITLY, in CSS. `theme.css` already collapses
 * every animation to 0.01ms, but that leaves the gradient overlay frozen at its
 * last keyframe rather than gone, so `.skeleton-shimmer` removes the overlay
 * outright under `prefers-reduced-motion: reduce`. There is deliberately no
 * `useReducedMotion()` here — one mechanism, in one place.
 *
 * A SCREEN READER MUST NEVER READ SHIMMER. Every placeholder is
 * `aria-hidden`; `SkeletonGroup` is the `aria-busy` container that carries the
 * caller's real message ("Loading projects"). A grey rectangle has no accessible
 * name worth announcing, and inventing one only makes the wait longer.
 */

export interface SkeletonGroupProps extends ComponentPropsWithoutRef<'div'> {
  /** What is loading, in the caller's own words. This is what is announced. */
  label: string;
}

/**
 * The container the placeholders live in. Swap it for the real content when the
 * request resolves — `aria-busy` going away is the signal that the wait ended.
 */
export function SkeletonGroup({ label, className, children, ...props }: SkeletonGroupProps) {
  return (
    <div role="status" aria-busy="true" className={cn('w-full', className)} {...props}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export interface SkeletonProps extends ComponentPropsWithoutRef<'div'> {
  /** Any CSS width. Defaults to filling the container. */
  width?: string;
  /** Any CSS height. Defaults to a line of body text. */
  height?: string;
  /** Circular, for avatar placeholders. */
  circle?: boolean;
}

export function Skeleton({
  width,
  height = '1rem',
  circle = false,
  className,
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'skeleton-shimmer relative overflow-hidden bg-surface-3',
        circle ? 'rounded-full' : 'rounded-sm',
        className,
      )}
      style={{ width: circle ? height : width, height, ...style }}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Number of lines. */
  lines?: number;
  lineHeight?: string;
}

/**
 * A paragraph placeholder. The last line is short because real text ends
 * mid-measure; a block of equal-length bars reads as a table, not prose.
 */
export function SkeletonText({
  lines = 3,
  lineHeight = '0.875rem',
  className,
  ...props
}: SkeletonTextProps) {
  const count = Math.max(0, Math.round(lines));

  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          key={index}
          data-skeleton-line=""
          height={lineHeight}
          width={index === count - 1 && count > 1 ? '60%' : '100%'}
        />
      ))}
    </div>
  );
}

export type SkeletonCardProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'>;

/** Placeholder shaped like a project card, so the layout does not jump. */
export function SkeletonCard({ className, ...props }: SkeletonCardProps) {
  return (
    <div
      className={cn('rounded-lg border border-fg/8 bg-surface-2 p-5', className)}
      {...props}
    >
      <Skeleton height="7rem" className="rounded-md" />
      <div className="mt-4 flex items-center gap-3">
        <Skeleton circle height="2rem" />
        <Skeleton height="0.875rem" width="45%" />
      </div>
      <SkeletonText lines={2} className="mt-4" />
    </div>
  );
}
