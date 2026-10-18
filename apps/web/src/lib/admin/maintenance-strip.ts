/**
 * What the maintenance console last learned about whether a window is in force — §19.6.
 *
 * <p>The console shell's "maintenance is on" strip is server markup in the admin layout, and a
 * layout is not drawn again when the reader moves between console pages. So a window that
 * started on its own schedule, or that somebody else started, stayed invisible in the strip
 * until a full reload — on the very screen that showed the window in force. The maintenance
 * console reports what it read here, and the strip follows the latest of the two answers.
 *
 * <p>A module-level value rather than a context, because the strip and the console are in
 * different subtrees of the layout and neither is the other's parent.
 */

type Listener = () => void;

let reported: boolean | null = null;
const listeners = new Set<Listener>();

/** Whether the console's last read found a window in force. */
export function reportMaintenanceInForce(inForce: boolean): void {
  if (reported === inForce) return;
  reported = inForce;
  for (const listener of listeners) listener();
}

export function subscribeToMaintenance(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Null until the console has read anything in this tab. */
export function reportedMaintenance(): boolean | null {
  return reported;
}

/** Tests only. */
export function forgetReportedMaintenance(): void {
  reported = null;
}
