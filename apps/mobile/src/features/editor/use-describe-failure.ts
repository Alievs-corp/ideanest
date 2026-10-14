import { useCallback, useMemo } from 'react';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import { useT } from '../../lib/i18n';
import { describeSaveFailure, type SaveFailureCopy } from './save-failure';
import { useEditorChromeCopy } from './translator';

/**
 * The sentences a refused editor request is put in (#463): the web's `campaignEditor.failures`,
 * read through the shared builder, except `conflict`. The web's says "this page"; the app keeps
 * its own `mobile.editor.failures.conflict`, which says "this screen".
 */
export function useSaveFailureCopy(): SaveFailureCopy {
  const chrome = useEditorChromeCopy();
  const failures = useT('mobile.editor.failures');
  return useMemo(() => ({ ...chrome.failures, conflict: failures('conflict') }), [chrome.failures, failures]);
}

/**
 * A refused editor request as a {@link SaveFailure}, in the catalogue's words — for the writes
 * that are not the autosave: an item, a reward, a question, a reorder, a delete (#162).
 *
 * The same sentences ({@link useSaveFailureCopy}) and the same order as the autosave's
 * `describeSaveFailure`, so a refusal reads the same wherever in the editor it happened; the
 * service's `detail`, field errors, `code` and `meta` pass through untouched.
 */
export function useDescribeFailure(): (cause: unknown) => SaveFailure {
  const copy = useSaveFailureCopy();
  return useCallback((cause: unknown) => describeSaveFailure(cause, copy), [copy]);
}
