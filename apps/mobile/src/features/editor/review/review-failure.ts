import { ApiError } from '@ideanest/api-client';
import { unmetFromRefusal, type UnmetRequirement } from '@ideanest/campaign-editor/checklist';
import type { ReviewPanelCopy } from '@ideanest/campaign-editor/copy';

/**
 * What the Review tab says when the service refuses it — the web `ReviewPanel`'s `messageFor` and
 * `refusalFrom`, over the app's `ApiError` (#162). The requirements a refusal names are read by the
 * shared `unmetFromRefusal`; only the wording choice is here.
 */

/** A read, a submit or a launch the service refused, in the catalogue's words or the service's. */
export function reviewFailureMessage(cause: unknown, words: ReviewPanelCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 404) return words.notFound;
    /*
     * A plan refusal is a 403 and is not "you do not have access to this campaign": it is this
     * creator's own campaign. The server's sentence names the plan and the bound, which is what
     * makes it actionable, so it is preferred over the generic line.
     */
    if (cause.problem?.code === 'PLAN_LIMIT_EXCEEDED') {
      return cause.problem?.detail ?? words.planDoesNotCover;
    }
    if (cause.status === 403) return words.noAccess;
    return cause.problem?.detail ?? cause.problem?.title ?? words.serviceRefused;
  }
  return words.unreachable;
}

/** A refused submission, as something to render. */
export interface SubmitRefusal {
  readonly message: string;
  /** Named by the server. Replaces what the tab was showing: the server has just re-checked. */
  readonly unmet: readonly UnmetRequirement[];
  /** A plan bound refused it: the tab offers the plans, it does not navigate to them. */
  readonly planLimit: boolean;
}

/**
 * The one refusal the tab cannot answer: no plan at all. What is missing is not on the campaign,
 * so the answer is the pricing screen, opened with `from=submit` so it can say why.
 */
export function needsSubscription(cause: unknown): boolean {
  return cause instanceof ApiError && cause.problem?.code === 'SUBSCRIPTION_REQUIRED';
}

/**
 * `PROJECT_NOT_SUBMITTABLE` carries the unmet requirements, `PLAN_LIMIT_EXCEEDED` the bound that was
 * hit, and `PROJECT_TRANSITION_NOT_ALLOWED` neither — its message is the server's and "Check again"
 * is the fix.
 */
export function submitRefusal(cause: unknown, words: ReviewPanelCopy): SubmitRefusal {
  if (cause instanceof ApiError) {
    return {
      message: reviewFailureMessage(cause, words),
      unmet: unmetFromRefusal(cause.problem?.meta ?? undefined),
      planLimit: cause.problem?.code === 'PLAN_LIMIT_EXCEEDED',
    };
  }
  return { message: reviewFailureMessage(cause, words), unmet: [], planLimit: false };
}
