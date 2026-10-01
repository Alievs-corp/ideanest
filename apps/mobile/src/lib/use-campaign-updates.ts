import { useEffect, useState } from 'react';
import { parseUpdate, reconnectDelayMs, type CampaignUpdate } from '@ideanest/campaign/realtime';

/**
 * §12.1's live counter, natively — the app's `useCampaignUpdates` (#155), the web's
 * `apps/web/src/lib/realtime/useCampaignUpdates.ts` on React Native's `WebSocket`.
 *
 * <h2>What is shared and what is not</h2>
 *
 * The address (`realtimeUrl`), the wire format (`parseUpdate`) and the reconnect policy
 * (`reconnectDelayMs`: 1 s, 2 s, 4 s … capped at 60 s, at most six attempts, reset by an open)
 * are `@ideanest/campaign/realtime`'s, so both clients reconnect on the same schedule and drop the
 * same malformed frames. The socket itself is each client's: the web's lives as long as the tab,
 * and a phone's must not.
 *
 * <h2>Open only while somebody is looking</h2>
 *
 * `active` is the screen's focus and the app's foreground together (`lib/app-active.ts`), and
 * the socket follows it: closed on blur or background, opened again on return with the attempts
 * reset, because a counter that kept a radio awake behind another screen would be spending a
 * battery on a number nobody can see. Nothing is reported to the reader either way — a counter
 * that stopped is the figures the page read, which is what it shows when realtime is not
 * configured at all.
 *
 * <h2>`null` is no socket</h2>
 *
 * `realtimeUrl` answers `null` for an unset or unusable origin, and offline the screen passes
 * `null` too. Nothing is opened, nothing is retried.
 */
export interface CampaignUpdatesState {
  /** Every update received since the screen mounted, in arrival order. */
  readonly updates: readonly CampaignUpdate[];
  readonly connected: boolean;
}

export function useCampaignUpdates(url: string | null, active: boolean): CampaignUpdatesState {
  const [updates, setUpdates] = useState<readonly CampaignUpdate[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (url === null || !active) return undefined;
    // A test environment, or a platform build without the global. Static figures, no error.
    if (typeof WebSocket === 'undefined') return undefined;

    let closedByUs = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // Per opening of the effect, so a return from the background starts the schedule again.
    let attempts = 0;

    const open = () => {
      retry = null;
      const current = new WebSocket(url);
      socket = current;

      current.onopen = () => {
        attempts = 0;
        setConnected(true);
      };

      current.onmessage = (event: WebSocketMessageEvent) => {
        // The server only ever sends text; a binary frame is not ours.
        if (typeof event.data !== 'string') return;
        const update = parseUpdate(event.data);
        if (update !== null) setUpdates((previous) => [...previous, update]);
      };

      current.onclose = () => {
        setConnected(false);
        if (closedByUs) return;
        const wait = reconnectDelayMs(attempts);
        if (wait === null) return;
        attempts += 1;
        retry = setTimeout(open, wait);
      };

      /*
       * An error is always followed by a close, and the close is where the schedule lives. An
       * `onerror` that also scheduled would reconnect twice per failure.
       */
      current.onerror = () => {};
    };

    open();

    return () => {
      closedByUs = true;
      if (retry !== null) clearTimeout(retry);
      // Legal on a socket still connecting, and it cancels the handshake.
      socket?.close();
      setConnected(false);
    };
  }, [url, active]);

  return { updates, connected };
}
