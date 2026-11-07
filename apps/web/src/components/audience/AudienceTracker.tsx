'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from '../../i18n/navigation';
import { sendAudienceEvent } from '../../lib/audience/beacon';
import {
  AUDIENCE_PROJECT_ATTRIBUTE,
  AUDIENCE_SURFACE_ATTRIBUTE,
  countsAsVisit,
  surfaceOf,
} from '../../lib/audience/paths';

/**
 * The site's audience counter — #634. Mounted once, in the root layout beside `WebVitals`, and
 * like it renders nothing: no element, no text, nothing to lay out or animate.
 *
 * <h2>A `VISIT` per address, not per render</h2>
 *
 * The effect runs when the pathname changes, which is every client-side navigation and the
 * first load. It is the pathname without the language (`i18n/navigation`), so one page read in
 * another language is the same page; a change of query string alone — a campaign's tabs, a
 * feed's filters — is the same page too. The last address sent is remembered so a re-render, or
 * React running the effect twice in development, does not count one page twice. The console,
 * the dashboards and the editor are not counted at all (`lib/audience/paths.ts`).
 *
 * <h2>Every card click through one listener</h2>
 *
 * The campaign cards are Server Components and stay ones. Each card's link carries its campaign
 * and the listing it is on as two data attributes, and this one listener on the document reads
 * them when a link is followed — by a click, by Enter, or by a middle click into a new tab
 * (`auxclick`). A feed of twenty-four cards costs no JavaScript per card.
 */
export function AudienceTracker(): null {
  const pathname = usePathname();
  const counted = useRef<string | null>(null);

  useEffect(() => {
    if (counted.current === pathname) return;
    counted.current = pathname;
    if (countsAsVisit(pathname)) sendAudienceEvent({ kind: 'VISIT' });
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest(`a[${AUDIENCE_PROJECT_ATTRIBUTE}]`);
      const projectId = link?.getAttribute(AUDIENCE_PROJECT_ATTRIBUTE);
      if (link == null || projectId == null || projectId === '') return;
      sendAudienceEvent({
        kind: 'CLICK',
        projectId,
        surface: surfaceOf(link.getAttribute(AUDIENCE_SURFACE_ATTRIBUTE)),
      });
    };

    // Capture, so a handler further down that stops propagation cannot hide the click.
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('auxclick', onClick, true);
    };
  }, []);

  return null;
}
