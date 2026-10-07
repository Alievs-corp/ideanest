import { deferUntilOpen } from './app-lock';
import { deferUntilUp } from './maintenance';

/**
 * Runs a navigation that did not come from a tap inside the app — an incoming link, a push
 * notification tap — at the first moment it is allowed to (#319, #214).
 *
 * <ol>
 *   <li>The app lock first. While it is shut the navigation waits ({@link deferUntilOpen}): a
 *       native modal presented after the lock screen would appear above it on iOS, and any route
 *       pushed behind it is somebody else's to see. When the gate opens it comes back through
 *       here, because maintenance may have started in the meantime.</li>
 *   <li>Then maintenance: during a window it waits for the service (`deferUntilUp`).</li>
 *   <li>Otherwise it runs now.</li>
 * </ol>
 */
export function openWhenAllowed(navigate: () => void): void {
  if (deferUntilOpen(() => openWhenAllowed(navigate))) return;
  if (!deferUntilUp(navigate)) navigate();
}
