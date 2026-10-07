import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit, ProjectPatch } from '@ideanest/campaign-editor/contract';
import { queryKeys } from '../../api/queries';
import { useOnline } from '../../lib/connectivity';
import { useT } from '../../lib/i18n';
import { deviceStore, type KeyValueStore } from '../../lib/storage';
import { unsentKeyFor } from '../../lib/unsent-edits';
import { useSession } from '../../lib/use-session';
import { patchProject, useProjectEdit } from './api';
import { describeSaveFailure } from './save-failure';
import { useAutosave, type Autosave } from './use-autosave';

/**
 * The editor's shared state — one per open project, provided by the frame
 * (`campaigns/[id]/edit/_layout.tsx`) and read by every tab (#162).
 *
 * <h2>Contract</h2>
 *
 * `useEditor()` gives a tab:
 * <ul>
 *   <li>`project` — the server's latest `ProjectEdit` (null until loaded), and `load`, its state:
 *       `loading`, `ready`, `signed-out` (no session, or a 401), `failed` (with `error`) or
 *       `unreachable` (offline with nothing cached);</li>
 *   <li>`autosave` — ONE autosave for every `PATCH /v1/projects/{id}` field, whichever tab sends
 *       it: `save(patch)` queues a merge patch (800ms debounce), `flush()` sends now (call it on
 *       blur), `retry()`, and `state`/`failure` for the indicator and the tab's failure alert.
 *       Story's `{story}`/`{risks}` and Pre-launch's title/summary/cover use this same one, so
 *       the frame's indicator, the tab switch flush and the unsent-change offer cover them too.
 *       Each save's answer replaces the cached project;</li>
 *   <li>`readOnly` — true while the phone is offline (or the project is not loaded): fields are
 *       disabled, nothing is queued;</li>
 *   <li>`revision` — bumps when the fields must be re-seeded from `project` (the creator sent a
 *       change an earlier launch left unsent). A tab that seeds a local draft once keys its form
 *       on it;</li>
 *   <li>`apply(project)` — take a server answer (any mutation that returns the project) as the
 *       new truth.</li>
 * </ul>
 */

export type EditorLoad = 'loading' | 'ready' | 'signed-out' | 'failed' | 'unreachable';

export interface EditorContextValue {
  readonly projectId: string;
  readonly project: ProjectEdit | null;
  readonly load: EditorLoad;
  /** The failed read, when `load` is `failed`. */
  readonly error: unknown;
  readonly query: UseQueryResult<ProjectEdit>;
  readonly online: boolean;
  readonly readOnly: boolean;
  readonly autosave: Autosave<ProjectPatch>;
  readonly revision: number;
  readonly apply: (project: ProjectEdit) => void;
  readonly reload: () => void;
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

  const apply = useCallback(
    (project: ProjectEdit) => queryClient.setQueryData(queryKeys.projectEdit(projectId), project),
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
  const autosave = useAutosave<ProjectPatch, ProjectEdit>({ send, onSaved: apply, describe, persist });

  /*
   * "Send it" on the offered change shows it at once: the patch's keys are the project's own
   * (merge patch over `ProjectEdit`), so the cached project takes them and the tabs re-seed. The
   * service's answer then replaces it, as every save's does.
   */
  const sendUnsent = autosave.sendUnsent;
  const sendOffered = useCallback((): ProjectPatch | null => {
    const patch = sendUnsent();
    if (patch !== null) {
      queryClient.setQueryData<ProjectEdit>(queryKeys.projectEdit(projectId), (current) =>
        current === undefined ? current : ({ ...current, ...patch } as ProjectEdit),
      );
      setRevision((value) => value + 1);
    }
    return patch;
  }, [sendUnsent, queryClient, projectId]);

  const load = loadOf(query, online, signedIn);
  const project = query.data ?? null;
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
      readOnly: !online || load !== 'ready',
      autosave: { ...autosave, sendUnsent: sendOffered },
      revision,
      apply,
      reload,
    }),
    [projectId, project, load, query, online, autosave, sendOffered, revision, apply, reload],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
