import { ApiError } from '@ideanest/api-client';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import type { SaveFailureCopy } from '@ideanest/campaign-editor/copy';

/**
 * The sentences a failed autosave can be put in — the shared builder's `SaveFailureCopy`, which
 * `useSaveFailureCopy` fills (#463). The vocabulary is an argument (the `basicsValidationCopyFrom`
 * rule: a pure function is handed its words, never reaches for them).
 */
export type { SaveFailureCopy };

/**
 * A failed save as something a creator can act on — the web's `describeFailure`, same order.
 *
 * The service's `detail` wins wherever it sent one: the endpoint knows which of its rules was
 * broken and this function does not. The field errors and `meta` are carried through untouched,
 * so a 422 lands on its fields and `STORY_DOCUMENT_INVALID` can still point at its block.
 */
export function describeSaveFailure(cause: unknown, copy: SaveFailureCopy): SaveFailure {
  if (cause instanceof ApiError) {
    const detail = cause.problem?.detail ?? cause.problem?.title ?? null;
    const message =
      detail ??
      (cause.status === 401
        ? copy.signedOut
        : cause.status === 403
          ? copy.forbidden
          : cause.status === 404
            ? copy.notFound
            : cause.status === 409
              ? copy.conflict
              : cause.status === 422 || cause.status === 400
                ? copy.rejected
                : copy.generic);
    return {
      message,
      fieldErrors: cause.problem?.errors ?? {},
      status: cause.status,
      code: cause.problem?.code ?? null,
      meta: cause.problem?.meta ?? null,
    };
  }
  return { message: copy.unreachable, fieldErrors: {}, status: null, code: null, meta: null };
}
