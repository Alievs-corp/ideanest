import { useCallback } from 'react';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import { useT } from '../../lib/i18n';
import { describeSaveFailure } from './save-failure';

/**
 * A refused editor request as a {@link SaveFailure}, in the catalogue's words — for the writes
 * that are not the autosave: an item, a reward, a question, a reorder, a delete (#162).
 *
 * The same sentences (`mobile.editor.failures`) and the same order as the autosave's
 * `describeSaveFailure`, so a refusal reads the same wherever in the editor it happened; the
 * service's `detail`, field errors, `code` and `meta` pass through untouched.
 */
export function useDescribeFailure(): (cause: unknown) => SaveFailure {
  const failures = useT('mobile.editor.failures');
  return useCallback(
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
}
