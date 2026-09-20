import type { components } from '@ideanest/api-client';
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
 * <h2>The types are the contract's, narrowed</h2>
 *
 * springdoc marks every field optional because Java cannot tell it otherwise. These
 * bodies are serialised with `JsonInclude.ALWAYS`, so the only genuinely absent fields
 * are the ones a draft has no answer for — `sentAt`, `sentTo` — and narrowing the rest
 * here is what keeps the screen free of `?.` on fields that cannot be missing.
 */

type ContractSurvey = components['schemas']['SurveyResponseBody'];
type ContractQuestion = components['schemas']['SurveyQuestionBody'];

/**
 * §4.8's PM-03, in the order the builder offers them.
 *
 * Text first because it is what a creator reaches for when they have not decided;
 * address last because it is the one that stores no answer here.
 */
export const QUESTION_TYPES = ['TEXT', 'CHOICE', 'MULTI_CHOICE', 'DATE', 'ADDRESS'] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/*
 * What each type is called on screen used to be a constant here, in English — #79.
 *
 * It is `dashboard.surveys.types` in the catalogue now, resolved by the route and handed to
 * the builder as part of its copy. A module-level map cannot read a catalogue: it is
 * evaluated before any request exists, which is the same reason `lib/moderation/describe.ts`
 * takes its reasons as an argument rather than owning them. The wire names are shouted and
 * stay that way; only the words a creator reads moved.
 */

/** Whether this type carries a list of options. Mirrors `QuestionType.hasChoices()`. */
export function hasChoices(type: QuestionType): boolean {
  return type === 'CHOICE' || type === 'MULTI_CHOICE';
}

/** One question, as the builder holds it. */
export interface SurveyQuestion {
  /** Absent on a question the creator has just added and not yet saved. */
  readonly id?: string;
  readonly prompt: string;
  readonly helpText?: string;
  readonly type: QuestionType;
  readonly required: boolean;
  readonly choices: readonly string[];
  /**
   * PM-02. Empty means every backer is asked; a tier means only the backers who chose
   * it. Empty rather than `undefined` so the `<select>` has a value to bind to — the
   * conversion to an absent field happens once, on the way out.
   */
  readonly rewardTierId: string;
}

/** One survey, as its creator sees it. */
export interface Survey {
  readonly id: string;
  readonly title: string;
  readonly message?: string;
  /** ISO-8601 instant. PM-06's cut-off; absent when none has been set, which is not "closed". */
  readonly respondBy?: string;
  readonly sent: boolean;
  readonly sentAt?: string;
  /** How many backers it reached, frozen at the send. Absent on a draft. */
  readonly sentTo?: number;
  readonly responseCount: number;
  readonly questions: readonly SurveyQuestion[];
}

/** A blank question, for the "add" button. */
export function emptyQuestion(): SurveyQuestion {
  return { prompt: '', type: 'TEXT', required: false, choices: [], rewardTierId: '' };
}

function questionFrom(question: ContractQuestion): SurveyQuestion {
  return {
    id: question.id,
    prompt: question.prompt ?? '',
    helpText: question.helpText ?? undefined,
    type: (question.type ?? 'TEXT') as QuestionType,
    required: question.required ?? false,
    choices: question.choices ?? [],
    rewardTierId: question.rewardTierId ?? '',
  };
}

function surveyFrom(survey: ContractSurvey): Survey {
  return {
    id: survey.id as string,
    title: survey.title ?? '',
    message: survey.message ?? undefined,
    respondBy: survey.respondBy ?? undefined,
    sent: survey.sent ?? false,
    sentAt: survey.sentAt ?? undefined,
    sentTo: survey.sentTo ?? undefined,
    responseCount: survey.responseCount ?? 0,
    questions: (survey.questions ?? []).map(questionFrom),
  };
}

/**
 * The body the service takes for both a create and an update.
 *
 * A question's `id` and `position` are read-only on the wire — the order is the array's,
 * and the service rewrites the rows — so neither is sent. An empty `rewardTierId` becomes
 * an absent field, because "" is not an identifier and the service reads absent as
 * "ask everybody".
 */
function bodyFor(survey: {
  readonly title: string;
  readonly message?: string;
  readonly respondBy?: string;
  readonly questions: readonly SurveyQuestion[];
}) {
  return {
    title: survey.title,
    message: survey.message?.trim() ? survey.message : undefined,
    respondBy: survey.respondBy?.trim() ? survey.respondBy : undefined,
    questions: survey.questions.map((question) => ({
      prompt: question.prompt,
      helpText: question.helpText?.trim() ? question.helpText : undefined,
      type: question.type,
      required: question.required,
      choices: hasChoices(question.type) ? question.choices : [],
      rewardTierId: question.rewardTierId || undefined,
    })),
  };
}

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
export async function createSurvey(
  projectId: string,
  survey: { readonly title: string; readonly message?: string; readonly respondBy?: string;
    readonly questions: readonly SurveyQuestion[] },
): Promise<Survey> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bodyFor(survey)),
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
export async function updateSurvey(
  surveyId: string,
  survey: { readonly title: string; readonly message?: string; readonly respondBy?: string;
    readonly questions: readonly SurveyQuestion[] },
): Promise<Survey> {
  const response = await authorizedFetch(`/v1/surveys/${encodeURIComponent(surveyId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bodyFor(survey)),
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
