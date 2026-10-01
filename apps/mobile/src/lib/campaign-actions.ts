import * as WebBrowser from 'expo-web-browser';
import { ApiError } from '@ideanest/api-client';
import { sendJson } from '../api/client';
import { siteUrl } from '../api/config';
import { currentLocale } from './locale';

/**
 * The campaign page's writes and its one way out to the web — #155.
 *
 * <p>Each write is the endpoint the web's `CampaignActions` calls, through `sendJson`, so it
 * carries the session the way every read does and a refusal arrives as the shared `ApiError`.
 * The service makes all four idempotent: saving a saved campaign is the same success, which is
 * what makes the control's "start off" honest until #137 publishes the real state.
 */

/** `POST /v1/projects/{id}/save`. The service's `saved` decides what the control shows. */
export async function saveCampaign(projectId: string): Promise<boolean> {
  return savedFrom(await sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/save`));
}

/** `DELETE /v1/projects/{id}/save`. */
export async function unsaveCampaign(projectId: string): Promise<boolean> {
  return savedFrom(await sendJson('DELETE', `/v1/projects/${encodeURIComponent(projectId)}/save`));
}

/** `POST /v1/projects/{id}/remind` for the signed-in reader — an empty body names the account. */
export async function remindMe(projectId: string): Promise<void> {
  await sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/remind`, {});
}

/** `DELETE /v1/projects/{id}/remind`. */
export async function forgetMe(projectId: string): Promise<void> {
  await sendJson('DELETE', `/v1/projects/${encodeURIComponent(projectId)}/remind`);
}

function savedFrom(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { saved?: unknown }).saved === true;
}

/** Which of the control's three refusal sentences a failure is, or the service's own words. */
export type ActionFailure =
  | { readonly kind: 'signIn' }
  | { readonly kind: 'detail'; readonly text: string }
  | { readonly kind: 'notSaved' }
  | { readonly kind: 'unreachable' };

/**
 * The web's `messageFor`, as data: a 401 is "sign in first", any other refusal is the service's
 * `detail` (then `title`) — its sentence about this refusal beats any this side could write — and
 * no answer at all is "could not be reached".
 */
export function actionFailureOf(cause: unknown): ActionFailure {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return { kind: 'signIn' };
    const text = cause.problem?.detail ?? cause.problem?.title;
    return text === undefined || text === '' ? { kind: 'notSaved' } : { kind: 'detail', text };
  }
  return { kind: 'unreachable' };
}

/**
 * Where the checkout for this campaign is, optionally on one tier — "Back this campaign" and
 * "Select this reward" push it.
 *
 * <p><strong>The app's own route, `campaigns/[id]/back[?reward=]`</strong> — never the campaign
 * page, which is where the old button sent a reader who had already decided. Until #157 builds it,
 * that route is the placeholder that carries `reward` on to the web checkout; when #157 lands it is
 * the checkout, and nothing on the campaign page has to change.
 */
export function checkoutHref(
  projectId: string,
  rewardId?: string,
): { readonly pathname: '/campaigns/[id]/back'; readonly params: Record<string, string> } {
  return {
    pathname: '/campaigns/[id]/back',
    params: rewardId === undefined ? { id: projectId } : { id: projectId, reward: rewardId },
  };
}

/**
 * One tab of the campaign's web page in the in-app browser — the interim body of a tab the app
 * does not draw yet (#155). The locale is in the address so the page opens in the language the
 * reader is using here, and `?tab=` is the web's own parameter.
 */
export async function openCampaignTabOnWeb(
  creatorSlug: string,
  projectSlug: string,
  tab: string,
): Promise<void> {
  const path = `/projects/${encodeURIComponent(creatorSlug)}/${encodeURIComponent(projectSlug)}`;
  await WebBrowser.openBrowserAsync(
    `${siteUrl()}/${currentLocale()}${path}?tab=${encodeURIComponent(tab)}`,
  );
}
