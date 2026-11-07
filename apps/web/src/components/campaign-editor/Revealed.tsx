'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export interface RevealedProps {
  children: ReactNode;
  /**
   * Brings the message back into view when it changes while still shown: a second,
   * different refusal replaces the first in the same place, and the creator has
   * usually scrolled away again by then.
   */
  revealKey?: unknown;
  className?: string;
}

/**
 * A message that appears because of something the creator just did, scrolled into view.
 *
 * The editor's tabs draw their refusals and notices at the top, and the control that
 * caused one is usually far below it — on a phone, several screens below. A message
 * nobody sees is a message that was not sent: the creator keeps typing into a form
 * that is not saving. So when one appears off screen the page is taken to it.
 *
 * Only when it is off screen: a message already in view stays where the reader is
 * looking, and the page does not jump. Instant, not smooth — the editor's motion
 * budget is none (docs/motion-system.md §5), which also makes it right under
 * `prefers-reduced-motion`. Focus is NOT moved: the creator may be mid-sentence in a
 * field, and taking the caret from them would lose what they type next.
 *
 * `scroll-mt-28` keeps it clear of the sticky top bar.
 */
export function Revealed({ children, revealKey, className }: RevealedProps) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const { top, bottom } = element.getBoundingClientRect();
    const clearance = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    if (top >= clearance && bottom <= window.innerHeight) return;
    element.scrollIntoView({ block: 'start' });
  }, [revealKey]);

  return (
    <div ref={box} className={className === undefined ? 'scroll-mt-28' : `scroll-mt-28 ${className}`}>
      {children}
    </div>
  );
}
