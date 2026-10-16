import { ApiError } from '../api/problem';
import type { ConsoleRefusalsCopy } from '../i18n/admin/common-copy';
import { consoleMessageFor } from './refusals';

/**
 * A refusal in the screen's own words, never in the service's.
 *
 * <p>`consoleMessageFor` falls back to the problem's `detail`, which the service writes in English.
 * On the money screens that put sentences like "Invalid request content." in front of an Azerbaijani
 * reader at exactly the moment they needed to know what to fix. This branches on the `code` first,
 * like `payoutRefusalFor` does, and keeps the service's prose out entirely:
 *
 * <ul>
 *   <li>a code the screen has a sentence for gets that sentence, whatever the status;
 *   <li>a 401 or 403 goes to the console's shared table, which names the subject and the capability;
 *   <li>a 400 with no code is Spring's own validation refusal, and gets {@code invalid};
 *   <li>anything else the service refused gets the console's generic, translated refusal;
 *   <li>a request that never reached the service gets the console's "unreachable".
 * </ul>
 *
 * @param words the screen's sentences, keyed by the service's `code`
 * @param invalid what to say about a request Spring rejected before any code ran
 */
export function codedRefusalFor(
  cause: unknown,
  words: Readonly<Record<string, string>>,
  invalid: string,
  subject: string,
  refusals: ConsoleRefusalsCopy,
): string {
  if (!(cause instanceof ApiError)) return consoleMessageFor(cause, subject, refusals);

  const code = cause.problem?.code;
  if (code != null && Object.hasOwn(words, code)) return words[code] ?? refusals.refused;
  if (cause.status === 401 || cause.status === 403) return consoleMessageFor(cause, subject, refusals);
  if (cause.status === 400 && code == null) return invalid;
  return refusals.refused;
}

/** The refusal's code, when the service named one. */
export function refusalCode(cause: unknown): string | undefined {
  return cause instanceof ApiError ? (cause.problem?.code ?? undefined) : undefined;
}

/** The value of one `meta` entry on a refusal, when it carries one. */
export function refusalMeta(cause: unknown, key: string): string | undefined {
  if (!(cause instanceof ApiError)) return undefined;
  const value = cause.problem?.meta?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Whether a string is a whole identifier — what the service's `UUID` fields accept. */
export function isIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}
