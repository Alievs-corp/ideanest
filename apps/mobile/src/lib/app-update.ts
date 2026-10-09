import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Over-the-air updates, offered in a dialog once they are ready (`components/update-prompt.tsx`).
 *
 * <h2>Downloaded first, offered second</h2>
 *
 * `app.config.ts` keeps `checkAutomatically: 'ON_LOAD'`: the native layer checks at every cold
 * start, before any JavaScript runs, and downloads what it finds in the background. That is the
 * path a fix for a bundle that crashes on launch arrives by, so it stays native. This module adds
 * the two things it does not do: a check when the app comes back to the foreground (a session can
 * last days), and the offer. The dialog appears only when an update is already on the phone
 * (`isUpdatePending`), so "Restart" is one tap and a second, not a progress bar, and "Later" costs
 * nothing: the next cold start launches the downloaded update anyway.
 *
 * <h2>Not in the middle of something</h2>
 *
 * A restart throws away what is on the screen. On checkout, in the campaign editor and on the
 * shipping-address form that is somebody's work, so the offer waits until they leave
 * ({@link isQuietRoute}). Behind the app lock it waits too, which `Dialog` does by itself.
 */

/** How long after a check the next foreground may check again — the update server is rate-limited. */
export const RECHECK_AFTER_MS = 15 * 60 * 1000;

const QUIET_ROUTES: readonly RegExp[] = [
  /^\/campaigns\/new$/,
  /^\/campaigns\/[^/]+\/(back|edit)(\/|$)/,
  /^\/pledges\/[^/]+\/address$/,
];

/** Whether a restart here would lose somebody's work: the offer waits until they leave. */
export function isQuietRoute(pathname: string): boolean {
  return QUIET_ROUTES.some((route) => route.test(pathname));
}

export function shouldRecheck(lastCheck: number, now: number): boolean {
  return now - lastCheck >= RECHECK_AFTER_MS;
}

/** One key per downloaded update, so "Later" holds for that update and no other. */
export function updateKey(update: Updates.UseUpdatesReturnType['downloadedUpdate']): string | null {
  if (update === undefined) return null;
  return update.type === Updates.UpdateInfoType.NEW
    ? update.updateId
    : `rollback-${update.createdAt.getTime()}`;
}

// The native launch check is the first one; the foreground clock starts with the process.
const checks = { last: Date.now(), running: false };

export function resetUpdateChecksForTests(now = Date.now()): void {
  checks.last = now;
  checks.running = false;
}

async function checkAndDownload(): Promise<void> {
  checks.running = true;
  try {
    const result = await Updates.checkForUpdateAsync();
    checks.last = Date.now();
    if (result.isAvailable || result.isRollBackToEmbedded) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or the server is away: the next foreground after the interval tries again.
  } finally {
    checks.running = false;
  }
}

export interface AppUpdate {
  /** A downloaded update the reader has not put off. */
  readonly offered: boolean;
  readonly restarting: boolean;
  /** The restart was refused; the update still launches at the next cold start. */
  readonly failed: boolean;
  readonly restart: () => void;
  readonly later: () => void;
}

export function useAppUpdate(): AppUpdate {
  const { isUpdatePending, downloadedUpdate, isStartupProcedureRunning, isChecking, isDownloading } =
    Updates.useUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const busy = isStartupProcedureRunning || isChecking || isDownloading || isUpdatePending;
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || busyRef.current || checks.running) return;
      if (shouldRecheck(checks.last, Date.now())) void checkAndDownload();
    });
    return () => subscription.remove();
  }, []);

  const key = isUpdatePending ? updateKey(downloadedUpdate) : null;

  const restart = useCallback(() => {
    setFailed(false);
    setRestarting(true);
    Updates.reloadAsync().catch(() => {
      setRestarting(false);
      setFailed(true);
    });
  }, []);

  const later = useCallback(() => {
    setFailed(false);
    setDismissed(key);
  }, [key]);

  return {
    offered: Updates.isEnabled && key !== null && key !== dismissed,
    restarting,
    failed,
    restart,
    later,
  };
}
