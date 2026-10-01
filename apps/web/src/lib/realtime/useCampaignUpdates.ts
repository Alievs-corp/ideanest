'use client';

import { useEffect, useRef, useState } from 'react';
import { reconnectDelayMs } from '@ideanest/campaign/realtime';
import type { CampaignUpdate } from './updates';
import { parseUpdate } from './updates';

/**
 * Holds §12.1's socket open for one channel and hands back what arrives.
 *
 * The thin half of `lib/realtime/updates.ts`: everything worth testing is a pure function
 * there, and what is left here is a connection and its lifecycle.
 *
 * <h2>Nothing happens without an address</h2>
 *
 * `url` is `null` when `IDEANEST_REALTIME_ORIGIN` is unset, which is the default —
 * `updates.ts` explains why. This hook then opens nothing, retries nothing and re-renders
 * nothing, so the cost of the feature on a deployment that has not configured it is the bytes
 * of this file.
 *
 * <h2>Reconnection gives up, and that is the point</h2>
 *
 * Backoff doubles from a second towards a minute, and after six consecutive failures it stops
 * for good — `reconnectDelayMs` in `@ideanest/campaign/realtime`, which the app's hook calls
 * too. A live counter that reconnected forever would be every abandoned tab on the
 * platform holding a connection attempt open against the service — and the page it is on is
 * already correct without it. The reader who wants fresh numbers reloads, which is the same
 * action they would take anyway.
 *
 * <h2>It never renders anything on its own</h2>
 *
 * The hook returns the accumulated updates and nothing else. It does not fetch, it does not
 * hold a total, and it does not know what a campaign is: the component that owns the
 * server-rendered numbers is the one that applies a delta to them, which keeps this reusable
 * for the comments tab without it learning about money.
 */

export interface CampaignUpdatesState {
  /** Every window that has arrived since mount, newest last. */
  readonly updates: readonly CampaignUpdate[];
  /** Whether a socket is currently open. For a "live" affordance, if a page wants one. */
  readonly connected: boolean;
}

export function useCampaignUpdates(url: string | null): CampaignUpdatesState {
  const [updates, setUpdates] = useState<readonly CampaignUpdate[]>([]);
  const [connected, setConnected] = useState(false);

  /*
   * The attempt count and the pending timer live in refs rather than state: changing either
   * must not re-render, and the effect below must not re-run when they change — a dependency
   * on the attempt count would tear the socket down on every failure and rebuild it, which is
   * the reconnection loop this backoff exists to avoid.
   */
  const attempts = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (url === null) {
      return;
    }
    /*
     * `WebSocket` is absent in a server render and in a test environment that has not provided
     * one. Checked rather than assumed, because the alternative is a ReferenceError inside an
     * effect, which React surfaces as a broken page rather than as a missing counter.
     */
    if (typeof WebSocket === 'undefined') {
      return;
    }

    let closedByUs = false;
    let socket: WebSocket | null = null;

    const open = () => {
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempts.current = 0;
        setConnected(true);
      };

      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') {
          // The server only ever sends text. A binary frame is not ours.
          return;
        }
        const update = parseUpdate(event.data);
        if (update !== null) {
          setUpdates((previous) => [...previous, update]);
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (closedByUs) {
          return;
        }
        const wait = reconnectDelayMs(attempts.current);
        if (wait === null) {
          return;
        }
        attempts.current += 1;
        retry.current = setTimeout(open, wait);
      };

      /*
       * No `onerror` handler. A failed socket always closes as well, so handling both would
       * schedule two retries for one failure — which is the classic way a backoff turns into a
       * flood.
       */
    };

    open();

    return () => {
      closedByUs = true;
      if (retry.current !== null) {
        clearTimeout(retry.current);
        retry.current = null;
      }
      // `close()` on a socket still connecting is legal and cancels the handshake, which is
      // exactly what a reader navigating away mid-connect should cause.
      socket?.close();
      setConnected(false);
    };
  }, [url]);

  return { updates, connected };
}
