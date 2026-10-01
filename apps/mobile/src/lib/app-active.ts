import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Whether the application is in the foreground — the campaign page's live counter and countdown
 * (#155) stop while it is not.
 *
 * <p>`active` only. iOS reports `inactive` for the app switcher and a pulled-down control centre,
 * and a socket kept open or a timer kept ticking behind those is a battery spent on a screen
 * nobody is looking at; both resume, recomputed, the moment the app is back.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== 'background');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  return active;
}
