'use client';

import { useEffect, useRef } from 'react';

/**
 * A campaign card's video, previewed over its poster while the card is hovered or focused.
 *
 * The card stays a Server Component; this is its only client code. The poster underneath is
 * the card's own `next/image`, so it stays the largest contentful paint and nothing here moves
 * the layout: the clip fills the frame `MediaFrame` already reserved, and only its `opacity`
 * changes.
 *
 * Nothing is fetched until somebody asks. The `<video>` has no `src` until the first hover or
 * focus, and `preload="none"` after that. `src` is set on the element rather than through a
 * prop, because a re-render writing the attribute again would restart the load.
 *
 * Only on a device that can hover and only without `prefers-reduced-motion: reduce`, both read
 * at the moment of the hover, so a change in either is respected without a reload. A touch
 * pointer on a hybrid laptop is ignored for the same reason Tailwind's `hover:` is.
 *
 * Decorative, so `aria-hidden`: the card's link is its accessible element, and a muted loop
 * says nothing the title does not.
 */

export interface CardVideoPreviewProps {
  /** The clip. Muted and looped, never with controls. */
  readonly src: string;
  /** The frame's transform, so the clip leans in with the cover under it. */
  readonly className?: string;
}

/** The preview playing now, so a second one (a hover while another card has focus) stops it. */
let current: HTMLVideoElement | null = null;

const CAN_PREVIEW = '(hover: hover) and (prefers-reduced-motion: no-preference)';

function canPreview(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(CAN_PREVIEW).matches;
}

function stop(video: HTMLVideoElement): void {
  video.pause();
  // Back to the first frame, so the next hover starts the clip from its beginning.
  if (video.readyState > 0) video.currentTime = 0;
  delete video.dataset['playing'];
  if (current === video) current = null;
}

export function CardVideoPreview({ src, className }: CardVideoPreviewProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    // The card that owns the hover: the nearest ancestor that asked for a preview.
    const host = video?.closest<HTMLElement>('[data-card-video]');
    if (!video || !host) return;
    video.muted = true;

    const start = (): void => {
      if (!canPreview()) return;
      if (current !== null && current !== video) stop(current);
      current = video;
      if (!video.hasAttribute('src')) video.setAttribute('src', src);
      // A refusal (a power-saving mode) or a pause before it started leaves the poster showing.
      (video.play() as Promise<void> | undefined)?.catch(() => undefined);
    };
    const reveal = (): void => {
      if (current === video) video.dataset['playing'] = '';
    };
    const onEnter = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') start();
    };
    const onLeave = (): void => stop(video);
    const onFocusOut = (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node && host.contains(event.relatedTarget))) stop(video);
    };

    host.addEventListener('pointerenter', onEnter);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('focusin', start);
    host.addEventListener('focusout', onFocusOut);
    video.addEventListener('playing', reveal);
    return () => {
      host.removeEventListener('pointerenter', onEnter);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('focusin', start);
      host.removeEventListener('focusout', onFocusOut);
      video.removeEventListener('playing', reveal);
      if (current === video) stop(video);
    };
  }, [src]);

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className ?? ''}`}>
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        disablePictureInPicture
        tabIndex={-1}
        className="size-full object-cover opacity-0 transition-opacity duration-150 ease-in-out data-playing:opacity-100"
      />
    </div>
  );
}
