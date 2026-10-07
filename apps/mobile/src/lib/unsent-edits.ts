import { deviceStore, type KeyValueStore } from './storage';

/**
 * Changes the editor has not had acknowledged, kept on the phone — issue #162.
 *
 * <p>The autosave keeps whatever the service has not yet accepted (`unsavedPatch` of the shared
 * machine) here, per project, on every transition. MMKV writes synchronously, so a phone the OS
 * kills between a keystroke and the answer still has the change on the next launch, and the
 * editor OFFERS it back ("A change from {time} was not saved") rather than sending it: the
 * service's copy may have moved on since, on this phone or another.
 *
 * <p>One account's text, so the session ending erases every entry (`lib/account-sync.tsx`).
 */

const PREFIX = 'ideanest.editor.unsent.v1.';

/** The store key for one project's unsent change. */
export function unsentKeyFor(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

/** A change nobody has seen accepted: the merge patch, and when it was last typed (ISO). */
export interface UnsentChange<P> {
  readonly patch: P;
  readonly at: string;
}

/** The stored change, or null — and a malformed entry is removed rather than offered. */
export function readUnsent<P>(store: KeyValueStore, key: string): UnsentChange<P> | null {
  const raw = store.getString(key);
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { at?: unknown }).at === 'string' &&
      typeof (parsed as { patch?: unknown }).patch === 'object' &&
      (parsed as { patch?: unknown }).patch !== null
    ) {
      const { at, patch } = parsed as { at: string; patch: P };
      return { at, patch };
    }
  } catch {
    // Fall through: an entry nobody can read is not worth offering.
  }
  store.remove(key);
  return null;
}

/** Keep `change`, or forget the entry when there is nothing left unsent. */
export function writeUnsent<P>(store: KeyValueStore, key: string, change: UnsentChange<P> | null): void {
  if (change === null) {
    store.remove(key);
    return;
  }
  store.set(key, JSON.stringify(change));
}

/** Every project's unsent change, gone — the session ended. */
export function forgetUnsentEdits(store: KeyValueStore = deviceStore): void {
  for (const key of store.getAllKeys()) {
    if (key.startsWith(PREFIX)) store.remove(key);
  }
}
