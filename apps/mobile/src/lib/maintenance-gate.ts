import { useEffect, useRef } from 'react';
import { takeDeferred, useMaintenance } from './maintenance';

/**
 * Shows `maintenance` when `lib/maintenance.ts` says the service is away — issue #150. Used by
 * the root stack; a hook of its own so the rules below are tested without a navigator.
 *
 * <p>Pushed rather than replacing the stack, so that when the service answers the screen can go
 * back to exactly where the reader was; what stops them going back *before* then is the route's
 * own options and its hardware-back handler. Only the entry is here: the screen owns its polling
 * and its exit, because it is the one that knows when it is being looked at.
 *
 * <p>Pushed once per outage. Every request on a screen fails at once, and the store already
 * collapses those into one change; the ref makes the same true of a re-render, or of a router
 * object that is not the same object twice.
 *
 * <p>When the service is back, a link held by `deferUntilUp` opens — after the screen's own
 * exit, which it dispatches before this effect runs, so the link lands on the stack the reader
 * returns to rather than under the maintenance screen being removed.
 */
export function useMaintenanceGate(router: { readonly push: (href: '/maintenance') => void }) {
  const down = useMaintenance();
  const shown = useRef(false);

  useEffect(() => {
    if (down) {
      if (shown.current) return;
      shown.current = true;
      router.push('/maintenance');
      return;
    }
    shown.current = false;
    takeDeferred()?.();
  }, [down, router]);
}
