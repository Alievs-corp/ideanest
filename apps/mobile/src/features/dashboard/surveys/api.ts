import type { components } from '@ideanest/api-client';
import { ApiError } from '@ideanest/api-client';
import {
  surveyBody,
  surveyFrom,
  type RewardTier,
  type Survey,
  type SurveyDraft,
} from '@ideanest/dashboard/surveys';
import { api, sendJson } from '../../../api/client';
import type { Translate } from '../../../lib/i18n';

/**
 * The survey builder's requests — the web's `lib/dashboard/surveys.ts` (#163). The rules (the
 * question types, the body, how a survey is read) are `@ideanest/dashboard/surveys`'s.
 */

type ContractSurvey = components['schemas']['SurveyResponseBody'];

/** The campaign's surveys, newest first, drafts included. */
export async function listSurveys(projectId: string, signal?: AbortSignal): Promise<readonly Survey[]> {
  const body = await api().get('/v1/projects/{projectId}/surveys', {
    path: { projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  return ((body as { surveys?: ContractSurvey[] }).surveys ?? []).map(surveyFrom);
}

/**
 * The campaign's reward tiers for PM-02's condition (#135) — the creator's own list, so the
 * hidden and secret tiers a creator may well want to survey are in it.
 */
export async function listRewardTiers(projectId: string, signal?: AbortSignal): Promise<readonly RewardTier[]> {
  const body = await api().get('/v1/projects/{projectId}/rewards', {
    path: { projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  return body
    .filter((tier): tier is typeof tier & { id: string } => typeof tier.id === 'string' && tier.id !== '')
    .map((tier) => ({ id: tier.id, title: tier.title ?? '' }));
}

function read(body: unknown): Survey {
  return surveyFrom((body ?? {}) as ContractSurvey);
}

export async function createSurvey(projectId: string, draft: SurveyDraft): Promise<Survey> {
  return read(await sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/surveys`, surveyBody(draft)));
}

/** The whole survey, questions included: a question left out is one the creator deleted. */
export async function updateSurvey(surveyId: string, draft: SurveyDraft): Promise<Survey> {
  return read(await sendJson('PUT', `/v1/surveys/${encodeURIComponent(surveyId)}`, surveyBody(draft)));
}

/** Deletes a draft. A sent survey is refused: its answers are what a creator ships from. */
export async function deleteSurvey(surveyId: string): Promise<void> {
  await sendJson('DELETE', `/v1/surveys/${encodeURIComponent(surveyId)}`);
}

/** PM-04: sends it to the campaign's backers. One way. */
export async function sendSurvey(surveyId: string): Promise<Survey> {
  return read(await sendJson('POST', `/v1/surveys/${encodeURIComponent(surveyId)}/send`));
}

/**
 * A refusal as a sentence, the web's `messageFor`: branched on status, with the service's own
 * `detail` for 422 and 400, which names the field this cannot.
 */
export function surveyFailure(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return t('dashboard.failures.signedOut');
    if (cause.status === 403) return t('dashboard.surveys.notGranted');
    if (cause.status === 404) return t('dashboard.failures.noCampaign');
    if (cause.status === 409) return t('dashboard.surveys.alreadySent');
    if (cause.status === 422) return cause.problem?.detail ?? t('dashboard.surveys.needsQuestion');
    if (cause.status === 400) return cause.problem?.detail ?? t('dashboard.surveys.invalid');
  }
  return t('dashboard.surveys.unavailable');
}

/** Why the list did not load: the same refusals, and the load's own words for the rest. */
export function listFailure(cause: unknown, t: Translate): string {
  if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) return surveyFailure(cause, t);
  return t('mobile.dashboardSurveys.unavailable');
}
