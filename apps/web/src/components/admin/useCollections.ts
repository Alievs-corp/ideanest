'use client';

import { useCallback, useEffect, useState } from 'react';
import { listCollections, type AdminCollection } from '../../lib/admin/curation';
import {
  consoleMessageFor,
  requiredCapabilityFrom,
  statusFor,
  wasAborted,
  type ConsoleStatus,
} from '../../lib/admin/refusals';
import type { ConsoleRefusalsCopy } from '../../lib/i18n/admin/common-copy';

export interface Collections {
  readonly status: ConsoleStatus;
  readonly collections: readonly AdminCollection[];
  readonly error: string | null;
  /** The capability a 403 named, for `ConsoleRefusal` — #400. Read only when refused. */
  readonly capability: string | null;
  /** Puts the service's own version of one collection back into the list. */
  readonly apply: (updated: AdminCollection) => void;
  /** Re-reads the whole list, for a change that can reorder it. */
  readonly reload: () => void;
  readonly setError: (message: string | null) => void;
}

/**
 * The collection index, loaded once per screen — AD-03, issues #300 to #303.
 *
 * <h2>Why a hook and not four copies of the same effect</h2>
 *
 * Four screens read the same endpoint and differ only in which collections they draw and what
 * they let a curator change: the manager lists everything, the badge screen the ones that
 * grant a badge, the open-call screen the ones with a window, the placement editor the order.
 * The loading, the abort on unmount, the four refusal states and the "put the service's answer
 * back" rule are identical in all four, and four copies of that is three places for the next
 * fix to miss.
 *
 * <h2>`apply` replaces a row wholesale and never merges into it</h2>
 *
 * Every curation mutation returns the collection as the service now holds it. Merging a guess
 * into local state is how a screen ends up showing a badge that was not granted: the request
 * that publishes a collection can also change its `sortOrder`, and a client that patched only
 * the field it thought it was changing would keep the stale one.
 *
 * <h2>No optimistic updates anywhere in this module</h2>
 *
 * Same rule the moderation queue and the account directory follow, and for the same reason:
 * these are privileged, audited changes that another curator can be making at the same moment.
 * A row that flips before the service answers is an interface that lies for a few hundred
 * milliseconds about which campaigns the platform is standing behind.
 *
 * @param subject what the screen calls the thing it is reading, already translated — the four
 *     screens say different things, and the refusal is the one message a reader meets without
 *     having done anything wrong
 * @param refusals the console's refusal table, resolved on the server by the route
 */
export function useCollections(subject: string, refusals: ConsoleRefusalsCopy): Collections {
  const [status, setStatus] = useState<ConsoleStatus>('loading');
  const [collections, setCollections] = useState<readonly AdminCollection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capability, setCapability] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setStatus((current) => (current === 'ready' ? current : 'loading'));
      try {
        const loaded = await listCollections(controller.signal);
        if (controller.signal.aborted) return;

        setCollections(loaded);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        const next = statusFor(cause);
        if (next === 'failed') setError(consoleMessageFor(cause, subject, refusals));
        setCapability(requiredCapabilityFrom(cause));
        setStatus(next);
      }
    }

    void load();
    return () => controller.abort();
    // The copy is one object per server render — see `useConsoleResource` for the argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const apply = useCallback((updated: AdminCollection): void => {
    setCollections((previous) =>
      previous.map((collection) => (collection.slug === updated.slug ? updated : collection)),
    );
  }, []);

  const reload = useCallback((): void => {
    setAttempt((n) => n + 1);
  }, []);

  return { status, collections, error, capability, apply, reload, setError };
}
