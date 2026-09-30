import { readStatusForRender } from '../../lib/maintenance/server';

/**
 * "Maintenance is on — readers see the maintenance page", across the top of the console while
 * a window is in force — §19.6, issue #214.
 *
 * A member of staff keeps working through a window (their token passes the service's gate and
 * the proxy leaves the console open), so without this nothing on their screen would say that
 * everybody else is looking at the maintenance page.
 *
 * Server markup, asked fresh on every render of the console shell: the console's routes carry
 * no script for it, and `MaintenanceConsole` refreshes the route after each change so the strip
 * follows the window it just started or ended. A status that cannot be read draws nothing
 * rather than a guess.
 */
export async function MaintenanceStrip({ label }: { readonly label: string }) {
  const status = await readStatusForRender(true);
  if (status?.state !== 'maintenance') return null;

  return (
    <p
      role="status"
      className="border-b border-white/8 bg-warning/12 px-5 py-2 text-center text-sm text-warning sm:px-6"
    >
      {label}
    </p>
  );
}
