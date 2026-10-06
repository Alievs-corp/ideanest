import type { BackerSurvey, QuestionType, SurveyAnswer, SurveyQuestion } from '@ideanest/account/surveys';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.8's PM-05 and PM-06 — the surveys a backer is being asked, and their answers.
 *
 * <h2>Two endpoints and one shape</h2>
 *
 * `GET /v1/me/surveys` returns the whole survey — questions, the reader's own answers, and
 * whether it is still open — and `POST /v1/surveys/{id}/respond` answers with the same shape
 * updated. So a submission needs no re-read to be correct on screen, and the form has one
 * type to render rather than a definition and a response that could disagree.
 *
 * <h2>Answering twice is the same row, not a second one</h2>
 *
 * `BackerSurveyController` answers 200 even on a first submission, deliberately: PM-06 makes
 * this one row that moves. The form therefore says **Save answers** rather than Submit, and
 * says so again after the first save.
 *
 * <h2>An ADDRESS question stores no answer</h2>
 *
 * The one question type that is a prompt rather than a field. `QuestionType.ADDRESS` explains
 * it: the answer is the pledge's row in `shipping_addresses` — encrypted at rest, validated,
 * lockable — and copying it into `survey_answers` would give the platform two addresses per
 * backer that can disagree, in a table §17.4's erasure does not know to look at. The form
 * points at `/pledges/{id}/address` (#290) instead of collecting one, and sends nothing for
 * that question.
 */

/* The survey's shape and its ordering rules are shared with the app (#159), so they live in
 * `@ideanest/account/surveys`. */
export type { BackerSurvey, QuestionType, SurveyAnswer, SurveyQuestion };

/** Every survey this account is being asked — `GET /v1/me/surveys`. */
export async function listMySurveys(signal?: AbortSignal): Promise<readonly BackerSurvey[]> {
  const response = await authorizedFetch('/v1/me/surveys', { signal });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as { readonly surveys?: readonly BackerSurvey[] };
  return body.surveys ?? [];
}

/**
 * Records the answers — `POST /v1/surveys/{surveyId}/respond`.
 *
 * The pledge travels in the body because one account can hold two pledges on one campaign
 * and the survey is asked of a pledge, not of a person. It comes from the survey the service
 * itself returned rather than from anything the form chose.
 */
export async function respondToSurvey(
  surveyId: string,
  pledgeId: string,
  answers: readonly SurveyAnswer[],
): Promise<BackerSurvey> {
  const response = await authorizedFetch(
    `/v1/surveys/${encodeURIComponent(surveyId)}/respond`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pledgeId, answers }),
    },
  );

  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as BackerSurvey;
}
