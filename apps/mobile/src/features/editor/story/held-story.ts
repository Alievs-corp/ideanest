import { readStoryDocument, type StoryDocument } from '@ideanest/campaign-editor/story';
import type { KeyValueStore } from '../../../lib/storage';
import { heldKeyFor } from '../../../lib/unsent-edits';

/**
 * The story the Story tab is holding back (#162): a document with an incomplete block, which the
 * server would refuse and the autosave therefore never sees. It exists on this phone and nowhere
 * else, so it is kept outside the form — in the editor's store, per project — and survives the tab
 * being left (the route unmounts) and the OS killing the app (the camera opened for the very image
 * block that makes it incomplete). Erased with the unsent changes when the session ends.
 *
 * <p>`base` fingerprints the last complete story the draft grew from. When the tab opens and the
 * service's story no longer matches it, the story changed elsewhere meanwhile, and the tab says so
 * rather than silently keeping either copy.
 */
export interface HeldStory {
  readonly document: StoryDocument;
  /** `storyFingerprint` of the complete story this draft grew from. */
  readonly base: string;
  /** When it was last written (ISO). */
  readonly at: string;
}

const TAB = 'story';

/** The held story, or null — and an entry nobody can read is removed rather than trusted. */
export function readHeldStory(store: KeyValueStore, projectId: string): HeldStory | null {
  const key = heldKeyFor(projectId, TAB);
  const raw = store.getString(key);
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const { document, base, at } = parsed as { document?: unknown; base?: unknown; at?: unknown };
      const read = readStoryDocument(document);
      if (read !== null && typeof base === 'string' && typeof at === 'string') {
        return { document: read, base, at };
      }
    }
  } catch {
    // Fall through.
  }
  store.remove(key);
  return null;
}

export function writeHeldStory(store: KeyValueStore, projectId: string, held: HeldStory | null): void {
  const key = heldKeyFor(projectId, TAB);
  if (held === null) store.remove(key);
  else store.set(key, JSON.stringify(held));
}

/** Plain data with its keys in one order, so the same story always reads the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * A short, stable fingerprint of a stored story (or of none), for "has it changed since". Not a
 * security measure: FNV-1a over the canonical JSON, so key order in a response does not matter.
 */
export function storyFingerprint(story: unknown): string {
  const text = JSON.stringify(canonical(story ?? null));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}
