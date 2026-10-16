import { ApiError } from '../api/problem';
import type { SuspensionCopy } from '../i18n/admin/people-copy';
import { consoleMessageFor } from './refusals';

/**
 * What a refused suspension or reinstatement says, from either screen that offers one — #501.
 *
 * <p>Branches on `problem.code` and never on prose, like the moderation queue: two refusals that
 * cannot be told apart would force this to match on sentences the service is free to reword.
 * A 403 is the console's, which names the capability the service asked for.
 *
 * <p>Here rather than beside `SuspendDialog`, so that a screen which reinstates without opening
 * the dialog does not pull the dialog's `Modal`, and the motion library with it, into its route.
 */
export function suspensionMessageFor(cause: unknown, subject: string, copy: SuspensionCopy): string {
  if (cause instanceof ApiError && cause.status !== 403) {
    const code = cause.problem?.code;

    if (code === 'ACCOUNT_NOT_FOUND') return copy.accountNotFound;
    if (code === 'ACCOUNT_SUSPENSION_REFUSED') return copy.selfSuspend;
  }
  return consoleMessageFor(cause, subject, copy.refusals);
}
