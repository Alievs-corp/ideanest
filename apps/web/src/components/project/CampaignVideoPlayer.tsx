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
 * button over it, and the `<video>` element once that button is pressed. No player library —
 * the MP4 is H.264/AAC with its index at the front (docs/architecture.md §13.2), which every
 * browser's own controls play, seek and take full-screen — and nothing from
 * `@ideanest/ui/motion`. `Pill` and `lucide-react` are already on this route through
 * `CampaignActions`, so what this adds to the First Load JS budget is this file.
 *
 * <h2>Nothing is fetched until somebody asks</h2>
 *
 * Before the press there is no `<video>` element in the document at all, so the browser has
 * nothing to preload however it interprets `preload`. On the press the element mounts with
 * `preload="none"` and `autoPlay`: the press IS the request to play, and making somebody press
 * a second time, on the player's own control, to start what they just asked for would be the
 * interface ignoring them. That is not autoplay in the sense §4.4 and docs/motion-system.md §9.2
 * forbid — those are about a video starting on its own — so it is the same under
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
  /** The video element's accessible name once it is mounted. */
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

  if (requested) {
    return (
      <video
        ref={video}
        controls
        playsInline
        preload="none"
        autoPlay
        src={src}
        poster={poster}
        aria-label={videoLabel}
        /*
         * Explicit, though a `<video controls>` is in the tab order of every engine already:
         * the focus moved here above has to land somewhere that is focusable by definition
         * rather than by browser habit, and space then plays and pauses it.
         */
        tabIndex={0}
        className="absolute inset-0 size-full bg-surface-1 object-contain"
      />
    );
  }

  return (
    <div className="absolute inset-0 grid place-items-center">
      {/*
        WHITE, NOT LIME. Lime on this page is the pledge button, and a reader deciding whether
        to back a campaign should find exactly one thing on it that says "act now"
        (docs/ui-kit.md §7.2). Watching is the primary action of this frame and nothing more.
      */}
      <Pill
        variant="primary"
        size="lg"
        aria-label={playName}
        iconLeft={<Play aria-hidden="true" className="size-4 fill-current" />}
        onClick={() => setRequested(true)}
      >
        {playLabel}
        <span aria-hidden="true" className="tabular-nums text-on-white/64">
          {duration}
        </span>
      </Pill>
    </div>
  );
}
