'use client';

import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { Pill } from '@ideanest/ui';

/**
 * The press that turns `CampaignMedia`'s poster into a playing video — issue #331.
 *
 * <h2>The smallest island that can own a press</h2>
 *
 * The poster is not in here. It is the server-rendered `next/image` underneath, priority-loaded
 * as the page's largest element, and this component draws only what has to run in a browser: a
 * button over it, and the `<video>` element it starts. No player library — the MP4 is H.264/AAC
 * with its index at the front (docs/architecture.md §13.2), which every browser's own controls
 * play, seek and take full-screen — and nothing from `@ideanest/ui/motion`. `Pill` and
 * `lucide-react` are already on this route through `CampaignActions`, so what this adds to the
 * First Load JS budget is this file.
 *
 * <h2>Nothing is fetched until somebody asks, and play starts inside the press</h2>
 *
 * The `<video>` element is in the document from the start, hidden, with no `src` and no
 * `poster`: an element with nothing to load loads nothing, however a browser reads `preload`.
 * The press gives it both and calls `play()` IN THE CLICK HANDLER, synchronously. That is the
 * whole reason the element exists before the press rather than being mounted by it: iOS Safari
 * starts a video with sound only from inside a user gesture, and an element mounted by the
 * re-render that follows a click — with `autoPlay` — starts outside it and sits there paused.
 *
 * `src` is deliberately never a React prop. Setting the attribute, even to the value it already
 * has, restarts the media element's load algorithm, and React writing it on the re-render after
 * the press would abort the `play()` the press just started.
 *
 * Playing on the press is not autoplay in the sense §4.4 and docs/motion-system.md §9.2 forbid —
 * those are about a video starting on its own — so it is the same under
 * `prefers-reduced-motion`: a reader who asked for less motion and then pressed play has asked
 * for this motion specifically.
 *
 * <h2>The box does not move</h2>
 *
 * The video fills the frame `CampaignMedia` already reserved, `object-contain` inside it. A
 * portrait clip from a phone is letterboxed in the page ground's colour rather than given a
 * taller frame, because a taller frame is the header changing height under the reader's
 * pointer the moment they pressed something — the layout shift §8 of docs/motion-system.md
 * measures, at the top of the most measured page in the application.
 *
 * <h2>Focus follows the press</h2>
 *
 * The button is removed by pressing it, which would drop a keyboard user's focus to the top of
 * the document. It moves to the video instead, whose native controls are then one key away.
 */

export interface CampaignVideoPlayerProps {
  readonly src: string;
  readonly poster: string;
  /** The word on the button. */
  readonly playLabel: string;
  /**
   * The button's accessible name, with the clip's length in words. It begins with
   * {@link playLabel}, so speech input reaches the control by the word printed on it.
   */
  readonly playName: string;
  /** The length as a player's clock shows it, printed beside the word. */
  readonly duration: string;
  /** The video element's accessible name once it is shown. */
  readonly videoLabel: string;
}

export function CampaignVideoPlayer({
  src,
  poster,
  playLabel,
  playName,
  duration,
  videoLabel,
}: CampaignVideoPlayerProps) {
  const [requested, setRequested] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (requested) video.current?.focus({ preventScroll: true });
  }, [requested]);

  function press(): void {
    const element = video.current;
    if (element !== null) {
      element.poster = poster;
      element.src = src;
      /*
       * Inside the gesture, before React re-renders anything. A refusal — a browser that still
       * will not play, a network that drops — leaves the native controls on screen with their
       * own play button, so it is not reported a second time here.
       */
      const playing = element.play() as Promise<void> | undefined;
      playing?.catch(() => {});
    }
    setRequested(true);
  }

  return (
    <>
      <video
        ref={video}
        hidden={!requested}
        controls={requested}
        playsInline
        preload="none"
        aria-label={videoLabel}
        /*
         * Explicit, though a `<video controls>` is in the tab order of every engine already: the
         * focus moved here above has to land somewhere that is focusable by definition rather
         * than by browser habit, and space then plays and pauses it. Out of the order while it is
         * hidden and has nothing in it.
         */
        tabIndex={requested ? 0 : -1}
        className="absolute inset-0 size-full bg-surface-1 object-contain"
      />

      {!requested && (
        <div className="absolute inset-0 grid place-items-center">
          {/*
            WHITE, NOT LIME. Lime on this page is the pledge button, and a reader deciding
            whether to back a campaign should find exactly one thing on it that says "act now"
            (docs/ui-kit.md §7.2). Watching is the primary action of this frame and nothing more.
          */}
          <Pill
            variant="primary"
            size="lg"
            aria-label={playName}
            iconLeft={<Play aria-hidden="true" className="size-4 fill-current" />}
            onClick={press}
          >
            {playLabel}
            <span aria-hidden="true" className="tabular-nums text-on-white/64">
              {duration}
            </span>
          </Pill>
        </div>
      )}
    </>
  );
}
