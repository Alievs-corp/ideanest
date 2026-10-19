'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The two arrows above a home-page rail — `HOME_RAIL` in `campaign-grid-layout.ts`.
 *
 * <h2>The list stays a server render</h2>
 *
 * The cards are drawn on the server like every other grid on the page; this component owns the
 * two buttons and nothing else, and reaches the list by the id it names in `aria-controls`.
 * Making the rail itself a client component would ship twelve cards' markup a second time as
 * the JavaScript to rebuild them, on the page a stranger meets first.
 *
 * <h2>Desktop only</h2>
 *
 * Below `lg` the list is the ordinary grid and there is nothing to scroll, so the arrows are
 * not drawn — the owner asked for the phone to stay exactly as it was.
 *
 * <h2>Motion</h2>
 *
 * One page of cards per press. The scroll is smooth unless the reader asked for reduced
 * motion, in which case it jumps; a scroll position is not layout, so neither costs a frame
 * of reflow. An arrow at its end is disabled rather than hidden, so the pair never moves.
 */
export function RailControls({
  target,
  previous,
  next,
}: {
  readonly target: string;
  readonly previous: string;
  readonly next: string;
}) {
  // At the start and not at the end: what the server render shows, so hydration agrees.
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const rail = document.getElementById(target);
    if (rail === null) return undefined;

    const update = () =>
      setEdges({
        start: rail.scrollLeft <= 1,
        end: rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1,
      });

    update();
    rail.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      rail.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [target]);

  const step = (direction: 1 | -1) => {
    const rail = document.getElementById(target);
    if (rail === null) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollBy({ left: direction * rail.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <div className="hidden items-center gap-2 lg:flex">
      <button
        type="button"
        aria-label={previous}
        aria-controls={target}
        disabled={edges.start}
        onClick={() => step(-1)}
        className={ARROW}
      >
        <ChevronLeft aria-hidden="true" className="size-[18px]" />
      </button>
      <button
        type="button"
        aria-label={next}
        aria-controls={target}
        disabled={edges.end}
        onClick={() => step(1)}
        className={ARROW}
      >
        <ChevronRight aria-hidden="true" className="size-[18px]" />
      </button>
    </div>
  );
}

const ARROW =
  'inline-grid size-10 place-items-center rounded-full bg-surface-3 text-white transition-colors duration-150 ease-in-out hover:bg-surface-4 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]';
