import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit, ProjectPatch } from '@ideanest/campaign-editor/contract';
import { readStoryDocument } from '@ideanest/campaign-editor/story';
import { queryKeys } from '../../api/queries';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { deviceStore, type KeyValueStore } from '../../lib/storage';
import { unsentKeyFor } from '../../lib/unsent-edits';
import { useSession } from '../../lib/use-session';
import { patchProject, useProjectEdit } from './api';
import { describeSaveFailure } from './save-failure';
import { withUnsaved } from './seed';
import { useAutosave, type Autosave } from './use-autosave';

/**
 * The editor's shared state — one per open project, provided by the frame
 * (`campaigns/[id]/edit/_layout.tsx`, keyed by the project id) and read by every tab (#162).
 *
 * <h2>Contract</h2>
 *
 * `useEditor()` gives a tab:
 * <ul>
 *   <li>`project` — the server's latest `ProjectEdit` (null until loaded), and `load`, its state:
 *       `loading`, `ready`, `signed-out` (no session, or a 401), `failed` (with `error`) or
 *       `unreachable` (offline with nothing cached);</li>
 *   <li>`fresh` — `project` was read from the service (or answered by a save) since the editor
 *       opened. The cache it may have come from is up to a week old, and a form seeded from that
 *       would PATCH stale values over edits made elsewhere. ONLINE, A TAB BUILDS ITS FORM ONLY ONCE
 *       `fresh` (`canSeed`), and shows its skeleton until then. Offline it seeds from the cache,
 *       read-only;</li>
 *   <li>`canSeed` — `project !== null && (fresh || !online || the refresh failed)`: when a tab may
 *       build its form. Not fresh means `readOnly`;</li>
 *   <li>`seed` — what to seed a form from: `project` with the autosave's unacknowledged patch laid
 *       over it (`withUnsaved`), so a tab mounted again shows what was typed, not what the server
 *       last answered;</li>
 *   <li>`autosave` — ONE autosave for every `PATCH /v1/projects/{id}` field, whichever tab sends
 *       it: `save(patch)` queues a merge patch (800ms debounce), `flush()` sends now (call it on
 *       blur), `retry()`, `state`/`failure` for the indicator and the tab's failure alert, and
 *       `unsaved`. Story's `{story}`/`{risks}` and Pre-launch's title/summary/cover use this same
 *       one. Each save's answer replaces the cached project. It stops (and forgets) when the
 *       session ends;</li>
 *   <li>`readOnly` — true while offline, not loaded, or not `fresh`: fields are disabled, nothing
 *       is queued;</li>
 *   <li>`revision` — bumps when a mounted form must be re-seeded from `seed`: the creator sent a
 *       change an earlier launch left unsent, or a newer copy was read from the service while
 *       nothing was pending. Re-seed in place keeping text that is only local (Basics does), or key
 *       the form on it;</li>
 *   <li>`apply(project)` — take a server answer (any mutation that returns the project) as the
 *       new truth;</li>
 *   <li>`store` — where this editor keeps what is only on the phone (the unsent patch, and a tab's
 *       held draft such as Story's incomplete document). Erased when the session ends.</li>
 * </ul>
 */

export type EditorLoad = 'loading' | 'ready' | 'signed-out' | 'failed' | 'unreachable';

export interface EditorContextValue {
  readonly projectId: string;
  readonly project: ProjectEdit | null;
  readonly load: EditorLoad;
  /** The failed read, when `load` is `failed` — or a failed refresh over a cached project. */
  readonly error: unknown;
  readonly query: UseQueryResult<ProjectEdit>;
  readonly online: boolean;
  readonly fresh: boolean;
  readonly canSeed: boolean;
  readonly seed: ProjectEdit | null;
  readonly readOnly: boolean;
  readonly autosave: Autosave<ProjectPatch>;
  readonly revision: number;
  readonly apply: (project: ProjectEdit) => void;
  readonly reload: () => void;
  readonly store: KeyValueStore;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (value === null) throw new Error('useEditor() needs an <EditorProvider> above it');
  return value;
}

function loadOf(query: UseQueryResult<ProjectEdit>, online: boolean, signedIn: boolean): EditorLoad {
  if (!signedIn) return 'signed-out';
  if (query.data !== undefined) return 'ready';
  if (query.error instanceof ApiError && query.error.status === 401) return 'signed-out';
  if (query.fetchStatus === 'paused' || (!online && query.isError)) return 'unreachable';
  if (query.isError) return 'failed';
  return 'loading';
}

export function EditorProvider({
  projectId,
  store = deviceStore,
  children,
}: {
  readonly projectId: string;
  /** Where unsent changes are kept. The device's MMKV; a memory store in a test. */
  readonly store?: KeyValueStore;
  readonly children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const { signedIn } = useSession();
  const failures = useT('mobile.editor.failures');
  const query = useProjectEdit(signedIn ? projectId : '');
  const [revision, setRevision] = useState(0);
  /**
   * When the copy the editor opened on was written — 0 when there was none. Anything newer is this
   * session's own read or save. Compared with the cache's own clock rather than with `Date.now()`
   * at mount, which the cached copy can share to the millisecond.
   */
  const openedAt = useRef(query.dataUpdatedAt);
  /** The last project this provider wrote to the cache itself, so it is not taken for a read. */
  const written = useRef<ProjectEdit | null>(null);

  const apply = useCallback(
    (project: ProjectEdit) => {
      // What the cache holds afterwards, which structural sharing may make a different object.
      written.current = queryClient.setQueryData<ProjectEdit>(queryKeys.projectEdit(projectId), project) ?? null;
    },
    [queryClient, projectId],
  );

  const describe = useCallback(
    (cause: unknown) =>
      describeSaveFailure(cause, {
        signedOut: failures('signedOut'),
        forbidden: failures('forbidden'),
        notFound: failures('notFound'),
        conflict: failures('conflict'),
        rejected: failures('rejected'),
        generic: failures('generic'),
        unreachable: failures('unreachable'),
      }),
    [failures],
  );

  const persist = useMemo(() => ({ store, key: unsentKeyFor(projectId) }), [store, projectId]);
  const send = useCallback((patch: ProjectPatch) => patchProject(projectId, patch), [projectId]);
  const autosave = useAutosave<ProjectPatch, ProjectEdit>({
    send,
    onSaved: apply,
    describe,
    persist,
    active: signedIn,
  });

  /*
   * "Send it" on the offered change shows it at once: the patch's keys are the project's own
   * (merge patch over `ProjectEdit`), so the cached project takes them and the tabs re-seed. The
   * service's answer then replaces it, as every save's does.
   */
  const sendUnsent = autosave.sendUnsent;
  const sendOffered = useCallback((): ProjectPatch | null => {
    const patch = sendUnsent();
    if (patch !== null) {
      const current = queryClient.getQueryData<ProjectEdit>(queryKeys.projectEdit(projectId));
      if (current !== undefined) apply(withUnsaved(current, patch));
      setRevision((value) => value + 1);
    }
    return patch;
  }, [sendUnsent, queryClient, projectId, apply]);

  const load = loadOf(query, online, signedIn);
  const project = query.data ?? null;
  const fresh = project !== null && query.dataUpdatedAt > openedAt.current;
  const refreshFailed = project !== null && !fresh && query.isError && !query.isFetching;
  const canSeed = project !== null && (fresh || !online || refreshFailed);

  /*
   * A newer copy READ from the service (a refetch on reconnect, a retry) re-seeds the mounted
   * forms — but only while nothing typed is waiting, since what is waiting is newer still. A save's
   * own answer (`apply`) never does: the creator is already typing the next sentence.
   */
  const pendingRef = useRef(autosave.pending);
  pendingRef.current = autosave.pending;
  useEffect(() => {
    if (query.data === undefined || query.data === written.current) return;
    if (query.dataUpdatedAt <= openedAt.current || pendingRef.current) return;
    setRevision((value) => value + 1);
  }, [query.data, query.dataUpdatedAt]);

  /*
   * A story stored in a format this build cannot read must never be overwritten from here: an
   * offered `{story}` from an earlier launch would put a v1 document over it. The rest of the offer
   * stands.
   */
  const storyUnreadable = project?.story != null && readStoryDocument(project.story) === null;
  const offeredStory = autosave.unsent !== null && 'story' in autosave.unsent.patch;
  const dropUnsent = autosave.dropUnsent;
  useEffect(() => {
    if (storyUnreadable && offeredStory) dropUnsent(['story']);
  }, [storyUnreadable, offeredStory, dropUnsent]);

  const unsaved = autosave.unsaved;
  const seed = useMemo(() => (project === null ? null : withUnsaved(project, unsaved)), [project, unsaved]);
  const refetch = query.refetch;
  const reload = useCallback(() => void refetch(), [refetch]);

  const value = useMemo<EditorContextValue>(
    () => ({
      projectId,
      project,
      load,
      error: query.error,
      query,
      online,
      fresh,
      canSeed,
      seed,
      readOnly: !online || load !== 'ready' || !fresh,
      autosave: { ...autosave, sendUnsent: sendOffered },
      revision,
      apply,
      reload,
      store,
    }),
    [projectId, project, load, query, online, fresh, canSeed, seed, autosave, sendOffered, revision, apply, reload, store],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
