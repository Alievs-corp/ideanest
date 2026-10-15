'use client';

import { useEffect, useRef } from 'react';

export interface LoopSource {
  /** A media query; the first source whose query matches, or that has none, plays. */
  readonly media?: string;
  readonly src: string;
}

/**
 * A silent decorative loop that costs nothing until it is seen — issue #490.
 *
 * Nothing is fetched but the poster until the video is on screen: `preload="none"` and no
 * `src` in the markup, so a hidden copy (the phone card on a laptop, the wide scene on a
 * phone) never downloads. It plays while visible and pauses when scrolled away, and a reader
 * who asked for reduced motion keeps the poster.
 */
export function HeroLoop({
  sources,
  poster,
  className,
}: {
  readonly sources: readonly LoopSource[];
  readonly poster: string;
  readonly className: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (video === null) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const queries = sources.flatMap((source) => (source.media ? [window.matchMedia(source.media)] : []));
    let visible = false;

    const sync = () => {
      if (!visible || still.matches) {
        video.pause();
        return;
      }
      const src = sources.find((source) => !source.media || window.matchMedia(source.media).matches)?.src;
      if (src !== undefined && !video.src.endsWith(src)) video.src = src;
      video.play().catch(() => undefined);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    });
    observer.observe(video);
    still.addEventListener('change', sync);
    for (const query of queries) query.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      still.removeEventListener('change', sync);
      for (const query of queries) query.removeEventListener('change', sync);
    };
  }, [sources]);

  return (
    <video
      ref={ref}
      aria-hidden="true"
      muted
      loop
      playsInline
      preload="none"
      poster={poster}
      className={className}
    />
  );
}
