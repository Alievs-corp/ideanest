'use client';

import { useEffect, useRef, useState } from 'react';
import { getDiscoveryFacets, type DiscoveryFacets } from './api';
import { filterKey, type DiscoveryFilters } from '@ideanest/discovery/filters';

/**
 * D-10's live counts, kept beside the controls they belong to.
 *
 * THE PREVIOUS PANEL STAYS ON SCREEN while the next one loads. A facet request
 * goes out every time a box is ticked, and clearing the counts in between would
 * make every number in the rail blink out and back on each interaction — which
 * reads as the panel breaking, and moves nothing, because the layout is
 * unchanged. The stale count is wrong for a few hundred milliseconds; a blank
 * one is unreadable for the same time and looks broken as well.
 *
 * A FAILURE IS NOT SURFACED AS AN ERROR. If the panel cannot be counted, the
 * filters still work — the feed is a separate request and reports its own
 * failures. Losing the counts is a degradation, not a stop, and an error banner
 * over a working feed would be a worse answer than a rail without numbers. The
 * controls render as available in that case rather than as unavailable: an
 * unknown count must never be shown as zero, because zero is what marks an
 * option the reader cannot use.
 */
export function useDiscoveryFacets(filters: DiscoveryFilters): DiscoveryFacets | null {
  const key = filterKey(filters);
  const [facets, setFacets] = useState<DiscoveryFacets | null>(null);

  const latestFilters = useRef(filters);
  latestFilters.current = filters;

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const next = await getDiscoveryFacets(latestFilters.current, { signal: controller.signal });
        if (!controller.signal.aborted) setFacets(next);
      } catch {
        // Deliberately silent. See the note above.
      }
    })();

    return () => controller.abort();
  }, [key]);

  return facets;
}
