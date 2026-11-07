import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { sendAudienceEvent, type AudienceSurface } from './send';

/**
 * When the app counts a reader — #636, the mobile half of #632's audience figures.
 *
 * <ul>
 *   <li><strong>VISIT</strong> on launch and on every return from the background: the phone's
 *       version of a page view. The service counts the visitor once per Baku day however many
 *       VISITs arrive, and the raw page views per VISIT.</li>
 *   <li><strong>VIEW</strong> when a campaign page opens ({@link useAudienceView}).</li>
 *   <li><strong>CLICK</strong> when a campaign card is pressed, with the list it was pressed in
 *       ({@link recordClick}).</li>
 * </ul>
 *
 * Every call ends in {@link sendAudienceEvent}, which never throws and never blocks.
 */

export function recordVisit(): void {
  sendAudienceEvent({ kind: 'VISIT' });
}

export function recordView(projectId: string | undefined | null): void {
  if (projectId == null || projectId === '') return;
  sendAudienceEvent({ kind: 'VIEW', projectId });
}

export function recordClick(projectId: string | undefined | null, surface: AudienceSurface = 'OTHER'): void {
  if (projectId == null || projectId === '') return;
  sendAudienceEvent({ kind: 'CLICK', projectId, surface });
}

/**
 * A VISIT now if the app is in front, and one on each return from the background. Returns the stop.
 * Called once, by the root layout.
 *
 * <p>Only a return from `background` counts. iOS passes through `inactive` for the app switcher, a
 * pulled-down control centre and an incoming call's banner, and coming back from those is not a
 * new visit — it would inflate the raw page views by every glance at a notification.
 */
export function watchVisits(): () => void {
  let away = AppState.currentState === 'background';
  if (!away) recordVisit();
  const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'background') {
      away = true;
    } else if (state === 'active' && away) {
      away = false;
      recordVisit();
    }
  });
  return () => subscription.remove();
}

/**
 * A VIEW when a campaign page opens, once per campaign the screen shows. A cached page drawn
 * offline still asks; the request fails quietly, and the reader was not counted, which is the
 * honest answer.
 */
export function useAudienceView(projectId: string | undefined | null): void {
  useEffect(() => {
    recordView(projectId);
  }, [projectId]);
}
