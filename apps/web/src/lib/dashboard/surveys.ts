import type { components } from '@ideanest/api-client';
import { surveyBody, surveyFrom, type Survey, type SurveyDraft } from '@ideanest/dashboard/surveys';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * What the survey builder asks the service — §4.8's PM-01 to PM-04, issue 73.
 *
 * <h2>Browser reads, like the rest of the dashboard</h2>
 *
 * `lib/api/server.ts` sends no token by design, and every route here is one campaign
 * team's view of its own unsent questions behind a bearer token the service answers
 * `no-store`. There is nothing to render on the server, which is the argument
 * `lib/dashboard/backers.ts` already makes for the report.
 *
 * <h2>The builder's types and rules are shared</h2>
 *
 * The question types, how a survey is read and the body a create or a save sends live in
 * `@ideanest/dashboard/surveys` (#163), because the app's builder has to send the same body.
 * Only the requests stay here.
 */

type ContractSurvey = components['schemas']['SurveyResponseBody'];

/** The campaign's surveys, newest first, drafts included. */
export async function listSurveys(projectId: string, signal?: AbortSignal): Promise<readonly Survey[]> {
  const response = await authorizedFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/surveys`,
    { signal },
  );
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as { surveys?: ContractSurvey[] };
  return (body.surveys ?? []).map(surveyFrom);
}

/** Creates a draft. */
export async function createSurvey(projectId: string, survey: SurveyDraft): Promise<Survey> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(surveyBody(survey)),
  });
  if (!response.ok) throw await errorFrom(response);

  return surveyFrom((await response.json()) as ContractSurvey);
}

/**
 * Rewrites a survey.
 *
 * The whole thing, questions included: a question left out is one the creator deleted.
 * On a sent survey the service refuses a change to the questions and applies a change to
 * the note and the deadline — the builder disables the question controls rather than
 * relying on that refusal, but the refusal is what actually holds.
 */
export async function updateSurvey(surveyId: string, survey: SurveyDraft): Promise<Survey> {
  const response = await authorizedFetch(`/v1/surveys/${encodeURIComponent(surveyId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(surveyBody(survey)),
  });
  if (!response.ok) throw await errorFrom(response);

  return surveyFrom((await response.json()) as ContractSurvey);
}

/** Deletes a draft. A sent survey is refused, because its answers are what a creator ships from. */
export async function deleteSurvey(surveyId: string): Promise<void> {
  const response = await authorizedFetch(`/v1/surveys/${encodeURIComponent(surveyId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw await errorFrom(response);
}

/** PM-04: sends it to the campaign's backers. One way. */
export async function sendSurvey(surveyId: string): Promise<Survey> {
  const response = await authorizedFetch(`/v1/surveys/${encodeURIComponent(surveyId)}/send`, {
    method: 'POST',
  });
  if (!response.ok) throw await errorFrom(response);

  return surveyFrom((await response.json()) as ContractSurvey);
}
