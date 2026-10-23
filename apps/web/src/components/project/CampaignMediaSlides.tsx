'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton, MediaFrame, cn } from '@ideanest/ui';

/**
 * The campaign header's two slides — the video, then the uploaded cover — issue #545.
 *
 * <h2>Why there are slides at all</h2>
 *
 * A campaign with a video is covered by the video's own still (`CampaignMedia` says why), so
 * the cover a creator chose and uploaded was never on its own page. The owner's answer is a
 * second slide rather than a second picture beside the first: the header keeps one 16:9 box,
 * the video stays first, and the cover is one swipe, arrow or dot away. A campaign with only
 * one of the two never reaches this component and renders exactly as before.
 *
 * <h2>Scroll snap, not a carousel library</h2>
 *
 * The track is a horizontally scrolling row with `scroll-snap-type: x mandatory`, so a swipe on
 * a touch screen and a sideways scroll on a trackpad are the browser's own, with its own
 * momentum, and nothing here runs per frame. The arrows and dots set `scrollLeft`, which the
 * track's `scroll-behavior` animates — `motion-safe:` only, so under `prefers-reduced-motion`
 * the slide changes at once. Which slide is showing is read back by an `IntersectionObserver`
 * rather than a scroll listener: it reports only when a slide crosses the threshold, so a
 * programmatic scroll does not flicker the dots back to where it started. `IconButton` and
 * `MediaFrame` are already on the route, so the cost is this file and two chevrons — about
 * 2.5 KiB of First Load JS, measured — and `@ideanest/ui/motion` stays off it.
 *
 * <h2>The controls sit under the box, not over it</h2>
 *
 * Over the picture they would cover the native player's control bar once the video plays, need
 * a scrim to be readable on an arbitrary photograph, and have their focus rings clipped by the
 * frame's rounded corners. Under it they are ordinary controls on the page's own surface.
 *
 * <h2>The WAI carousel pattern, without rotation</h2>
 *
 * The section is named and described as a carousel, each slide is a group named "Video, 1 of
 * 2", and the slide that is not showing is `inert`, so neither a screen reader nor Tab reaches
 * a play button scrolled out of sight. Nothing rotates on its own, so there is no pause
 * control; a change the reader asked for is announced politely. The left and right arrow keys
 * move between slides from anywhere in the section except the video itself, whose own controls
 * use them to seek. Leaving the video's slide pauses it.
 */

export interface CampaignMediaSlidesProps {
  /** Server-rendered: the poster and the cover are in the initial HTML. */
  readonly slides: readonly ReactNode[];
  /** The carousel's accessible name. */
  readonly label: string;
  /** Each slide's name, with its position: "Video, 1 of 2". */
  readonly slideNames: readonly string[];
  /** Each dot's name: "Show the video". */
  readonly dotNames: readonly string[];
  readonly previous: string;
  readonly next: string;
}

export function CampaignMediaSlides({
  slides,
  label,
  slideNames,
  dotNames,
  previous,
  next,
}: CampaignMediaSlidesProps) {
  const [index, setIndex] = useState(0);
  const [asked, setAsked] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const count = slides.length;

  useEffect(() => {
    const root = track.current;
    if (root === null || typeof IntersectionObserver === 'undefined') return undefined;
    const items = [...root.children];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.6) setIndex(items.indexOf(entry.target));
        }
      },
      { root, threshold: 0.6 },
    );
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const items = track.current?.children ?? [];
    [...items].forEach((item, i) => {
      if (i !== index) for (const video of item.querySelectorAll('video')) video.pause();
    });
  }, [index]);

  function show(target: number): void {
    const to = (target + count) % count;
    const element = track.current;
    if (element !== null) element.scrollLeft = to * element.clientWidth;
    setIndex(to);
    setAsked(true);
  }

  function key(event: KeyboardEvent<HTMLElement>): void {
    if (event.target instanceof HTMLMediaElement) return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    show(index + step);
  }

  return (
    <section aria-roledescription="carousel" aria-label={label} onKeyDown={key} className="flex flex-col gap-3">
      <MediaFrame ratio="16/9" radius="lg">
        <div
          ref={track}
          className="scrollbar-none absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth"
        >
          {slides.map((slide, i) => (
            <div
              key={i}
              role="group"
              aria-roledescription="slide"
              aria-label={slideNames[i]}
              inert={i !== index}
              className="relative size-full shrink-0 snap-start snap-always"
            >
              {slide}
            </div>
          ))}
        </div>
      </MediaFrame>

      <div className="flex items-center justify-center gap-2">
        <IconButton
          size="sm"
          label={previous}
          icon={<ChevronLeft aria-hidden="true" />}
          onClick={() => show(index - 1)}
        />
        {dotNames.map((name, i) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            aria-current={i === index ? 'true' : undefined}
            onClick={() => show(i)}
            className="grid size-6 place-items-center rounded-full"
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-2 rounded-full bg-fg transition-[opacity,transform] duration-150 ease-in-out motion-reduce:transition-none',
                i === index ? 'opacity-100' : 'scale-75 opacity-32',
              )}
            />
          </button>
        ))}
        <IconButton
          size="sm"
          label={next}
          icon={<ChevronRight aria-hidden="true" />}
          onClick={() => show(index + 1)}
        />
      </div>

      <p aria-live="polite" className="sr-only">
        {asked ? slideNames[index] : ''}
      </p>
    </section>
  );
}
