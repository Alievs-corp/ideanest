import { readStatusForRender } from '../../lib/maintenance/server';
import { MaintenanceStripView } from './MaintenanceStripView';

/**
 * "Maintenance is on — readers see the maintenance page", across the top of the console while
 * a window is in force — §19.6, issue #214.
 *
 * A member of staff keeps working through a window (their token passes the service's gate and
 * the proxy leaves the console open), so without this nothing on their screen would say that
 * everybody else is looking at the maintenance page.
 *
 * Asked fresh on every render of the console shell. A layout is not drawn again on a client
 * navigation, so the strip also follows what the maintenance console last read
 * (`MaintenanceStripView`), and `MaintenanceConsole` refreshes the route after each change. A
 * status that cannot be read starts the strip hidden rather than guessing.
 */
export async function MaintenanceStrip({ label }: { readonly label: string }) {
  const status = await readStatusForRender(true);

  return <MaintenanceStripView initiallyOn={status?.state === 'maintenance'} label={label} />;
}
