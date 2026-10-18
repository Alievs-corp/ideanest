'use client';

import { useSyncExternalStore } from 'react';
import { reportedMaintenance, subscribeToMaintenance } from '../../lib/admin/maintenance-strip';

/**
 * The strip itself: drawn from the server's answer, and from the maintenance console's when it
 * has a newer one — `lib/admin/maintenance-strip.ts` has why.
 */
export function MaintenanceStripView({ initiallyOn, label }: { readonly initiallyOn: boolean; readonly label: string }) {
  const reported = useSyncExternalStore(subscribeToMaintenance, reportedMaintenance, () => null);
  if (!(reported ?? initiallyOn)) return null;

  return (
    <p role="status" className="border-b border-white/8 bg-warning/12 px-5 py-2 text-center text-sm text-warning sm:px-6">
      {label}
    </p>
  );
}
