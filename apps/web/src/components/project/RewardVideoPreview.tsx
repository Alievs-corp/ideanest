'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { IconButton } from '@ideanest/ui';

/**
 * A reward's clip over its poster, on the campaign page's reward card.
 *
 * The poster is the server-rendered `next/image` underneath, in the `MediaFrame` that reserved
 * the box, so the card does not move when the clip arrives: only the video's `opacity` changes.
 * Nothing is fetched until the clip is asked for — the `<video>` has no `src` until then.
 *
 * Two ways to play it. On a device that can hover, and without `prefers-reduced-motion:
 * reduce`, it previews muted and looping while the pointer or focus is on it, and stops and
 * rewinds when they leave — the discovery card's preview. And everywhere, the button: a visible
 * play/pause control for touch and keyboard, named for the tier. A press is the reader asking,
 * so it plays under reduced motion too, and it keeps playing until it is pressed again.
 *
 * The project page's budget is moderate (docs/motion-system.md §5), and this is an answer to
 * the reader rather than something that moves on its own: a 150ms opacity change and nothing
 * else.
 */

export interface RewardVideoPreviewProps {
  readonly src: string;
  /** The button's accessible names, each naming the tier. */
  readonly playName: string;
  readonly pauseName: string;
}

const CAN_PREVIEW = '(hover: hover) and (prefers-reduced-motion: no-preference)';

function canPreview(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(CAN_PREVIEW).matches;
}

export function RewardVideoPreview({ src, playName, pauseName }: RewardVideoPreviewProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  /** Started by the button, so leaving does not stop it. */
  const pinned = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (video === null) return;
    video.muted = true;
    const on = (): void => setPlaying(true);
    const off = (): void => setPlaying(false);
    video.addEventListener('playing', on);
    video.addEventListener('pause', off);
    return () => {
      video.removeEventListener('playing', on);
      video.removeEventListener('pause', off);
      if (!video.paused) video.pause();
    };
  }, []);

  function play(): void {
    const video = ref.current;
    if (video === null) return;
    // Set on the element, never as a prop: writing it again on a re-render restarts the load.
    if (!video.hasAttribute('src')) video.setAttribute('src', src);
    // A refusal leaves the poster showing and the button saying "play", which is the truth.
    (video.play() as Promise<void> | undefined)?.catch(() => undefined);
  }

  function stop(): void {
    const video = ref.current;
    if (video === null) return;
    video.pause();
    if (video.readyState > 0) video.currentTime = 0;
  }

  function preview(): void {
    if (canPreview()) play();
  }

  function endPreview(): void {
    if (!pinned.current) stop();
  }

  function toggle(): void {
    if (playing) {
      pinned.current = false;
      ref.current?.pause();
    } else {
      pinned.current = true;
      play();
    }
  }

  return (
    <div
      className="absolute inset-0"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') preview();
      }}
      onPointerLeave={endPreview}
      onFocus={preview}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
          endPreview();
        }
      }}
    >
      {/* Decorative: the button below is the control, and it names what it plays. */}
      <video
        ref={ref}
        aria-hidden="true"
        muted
        loop
        playsInline
        preload="none"
        disablePictureInPicture
        tabIndex={-1}
        data-playing={playing ? '' : undefined}
        className="size-full object-cover opacity-0 transition-opacity duration-150 ease-in-out data-playing:opacity-100"
      />
      <IconButton
        variant="light"
        size="md"
        label={playing ? pauseName : playName}
        icon={
          playing ? (
            <Pause aria-hidden="true" className="fill-current" />
          ) : (
            <Play aria-hidden="true" className="fill-current" />
          )
        }
        className="absolute right-3 bottom-3"
        onClick={toggle}
      />
    </div>
  );
}
