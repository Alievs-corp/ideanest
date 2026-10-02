import { useCallback, useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { useAppActive } from '../../../lib/app-active';

/**
 * Whether this phone lets IdeyaNest notify at all — the OS half of a Push preference (#161).
 * `unknown` is a phone that could not be asked; nothing is claimed about it.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unknown';

export async function readPushPermission(): Promise<PushPermission> {
  try {
    const answer = await Notifications.getPermissionsAsync();
    if (answer.granted) return 'granted';
    return answer.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unknown';
  }
}

/**
 * The permission, read on mount and again whenever the app comes back to the foreground — the
 * way back from the phone's settings, where it is changed.
 */
export function usePushPermission(): {
  readonly permission: PushPermission;
  readonly refresh: () => Promise<PushPermission>;
} {
  const active = useAppActive();
  const [permission, setPermission] = useState<PushPermission>('unknown');

  const refresh = useCallback(async () => {
    const answer = await readPushPermission();
    setPermission(answer);
    return answer;
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  return { permission, refresh };
}
