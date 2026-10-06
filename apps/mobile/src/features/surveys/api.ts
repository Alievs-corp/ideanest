import { useQuery } from '@tanstack/react-query';
import type { components } from '@ideanest/api-client';
import type { BackerSurvey, SurveyAnswer, SurveyQuestion } from '@ideanest/account/surveys';
import { api, sendJson } from '../../api/client';
import { queryKeys } from '../../api/queries';

type SurveyBody = components['schemas']['BackerSurveyBody'];
type QuestionBody = components['schemas']['SurveyQuestionBody'];

/**
 * The service serialises with `non_null`, so an empty field is absent rather than null. The
 * shared shape (`@ideanest/account/surveys`) says null, which is what the screens test against.
 */
function questionFrom(body: QuestionBody): SurveyQuestion {
  return {
    id: body.id ?? '',
    position: body.position ?? null,
    prompt: body.prompt ?? '',
    helpText: body.helpText ?? null,
    type: body.type ?? 'TEXT',
    required: body.required === true,
    choices: body.choices ?? [],
    rewardTierId: body.rewardTierId ?? null,
  };
}

export function surveyFrom(body: SurveyBody): BackerSurvey {
  return {
    surveyId: body.surveyId ?? '',
    projectId: body.projectId ?? '',
    pledgeId: body.pledgeId ?? '',
    title: body.title ?? '',
    message: body.message ?? null,
    respondBy: body.respondBy ?? null,
    open: body.open === true,
    answered: body.answered === true,
    submittedAt: body.submittedAt ?? null,
    questions: (body.questions ?? []).map(questionFrom),
    answers: (body.answers ?? []).map((answer) => ({
      questionId: answer.questionId ?? '',
      value: answer.value ?? [],
    })),
  };
}

/** Every survey this account is being asked — `GET /v1/me/surveys`. */
export async function listMySurveys(signal?: AbortSignal): Promise<readonly BackerSurvey[]> {
  const body = await api().get('/v1/me/surveys', signal === undefined ? {} : { signal });
  return (body.surveys ?? []).map(surveyFrom);
}

/**
 * Records the answers — `POST /v1/surveys/{surveyId}/respond`. The pledge travels in the body:
 * one account can hold two pledges on one campaign, and the survey is asked of a pledge. The
 * service answers with the survey updated; a body-less answer keeps the sent answers on screen.
 */
export async function respondToSurvey(
  survey: BackerSurvey,
  answers: readonly SurveyAnswer[],
): Promise<BackerSurvey> {
  const body = await sendJson('POST', `/v1/surveys/${encodeURIComponent(survey.surveyId)}/respond`, {
    pledgeId: survey.pledgeId,
    answers,
  });
  return body === null ? { ...survey, answered: true, answers } : surveyFrom(body as SurveyBody);
}

/** The list, persisted under `surveys` (`lib/offline.ts`). Nothing polls it: pull to refresh. */
export function useSurveys(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.surveys(),
    enabled,
    queryFn: ({ signal }) => listMySurveys(signal),
  });
}
