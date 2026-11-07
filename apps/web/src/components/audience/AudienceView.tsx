'use client';

import { useEffect, useRef } from 'react';
import { sendAudienceEvent } from '../../lib/audience/beacon';

/**
 * A campaign page was opened — the `VIEW` of #634. Renders nothing.
 *
 * Once per mount of a campaign: switching the page's tabs changes the query string, not the
 * campaign, and is not another view. The ref also absorbs React running the effect twice in
 * development. The service counts a person once per campaign per Baku day anyway, so a reload is
 * a request and never a second view.
 */
export function AudienceView({ projectId }: { readonly projectId: string }): null {
  const counted = useRef<string | null>(null);

  useEffect(() => {
    if (counted.current === projectId) return;
    counted.current = projectId;
    sendAudienceEvent({ kind: 'VIEW', projectId });
  }, [projectId]);

  return null;
}
