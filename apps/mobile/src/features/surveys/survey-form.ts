import {
  answerFor,
  needsAnAnswer,
  orderedQuestions,
  type BackerSurvey,
  type SurveyAnswer,
} from '@ideanest/account/surveys';

/**
 * The survey screen's pure rules, kept out of the components so they can be tested without a
 * render. The rules both clients share (question order, "needs an answer") are
 * `@ideanest/account/surveys`; these are the form's.
 */

export type Draft = Readonly<Record<string, readonly string[]>>;

/** One account can hold two pledges on one campaign, so a survey is a survey *and* a pledge. */
export function surveyKey(survey: BackerSurvey): string {
  return `${survey.surveyId}:${survey.pledgeId}`;
}

/** What is still owed comes first; within each group the service's order is kept. */
export function outstandingFirst(surveys: readonly BackerSurvey[]): readonly BackerSurvey[] {
  return [...surveys.filter(needsAnAnswer), ...surveys.filter((survey) => !needsAnAnswer(survey))];
}

/**
 * The list in the order it was last sorted, while it holds the same surveys. Saving an answer
 * moves a survey out of the outstanding group; re-sorting then would move the card away from
 * under the reader, with its "Saved" confirmation. A new or removed survey, or a pull to refresh
 * (`previous` null), sorts again.
 */
export function keepOrder(
  previous: readonly string[] | null,
  surveys: readonly BackerSurvey[],
): readonly BackerSurvey[] {
  const byKey = new Map(surveys.map((survey) => [surveyKey(survey), survey]));
  if (previous === null || previous.length !== byKey.size || !previous.every((key) => byKey.has(key))) {
    return outstandingFirst(surveys);
  }
  return previous.map((key) => byKey.get(key)).filter((survey): survey is BackerSurvey => survey !== undefined);
}

export function draftFrom(survey: BackerSurvey): Draft {
  const draft: Record<string, readonly string[]> = {};
  for (const question of survey.questions) draft[question.id] = answerFor(survey, question.id);
  return draft;
}

/** The required questions left empty, checked before anything is sent. ADDRESS is never one. */
export function missingAnswers(survey: BackerSurvey, draft: Draft): readonly string[] {
  return orderedQuestions(survey)
    .filter((question) => question.required && question.type !== 'ADDRESS')
    .filter((question) => (draft[question.id] ?? []).length === 0)
    .map((question) => question.id);
}

/**
 * The request's answers. ADDRESS questions are left out rather than sent empty: they store no
 * answer, and an empty row would be a record that somebody answered nothing.
 */
export function answersToSend(survey: BackerSurvey, draft: Draft): readonly SurveyAnswer[] {
  return orderedQuestions(survey)
    .filter((question) => question.type !== 'ADDRESS')
    .map((question) => ({ questionId: question.id, value: draft[question.id] ?? [] }));
}

/**
 * A MULTI_CHOICE answer after one box changed. The saved order is the creator's `choices` order,
 * not the order the boxes were ticked in: read back beside the question, it lists the answers the
 * way the question lists them.
 */
export function toggleChoice(
  choices: readonly string[],
  value: readonly string[],
  choice: string,
  checked: boolean,
): readonly string[] {
  return checked
    ? choices.filter((option) => option === choice || value.includes(option))
    : value.filter((option) => option !== choice);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A DATE answer: `YYYY-MM-DD`, the string the web's `<input type=date>` sends, read from the
 * phone's own calendar day. Never through `toISOString`, which converts to UTC and, east of
 * Greenwich, turns the first minutes of a day into the day before.
 */
export function dateAnswerOf(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DATE_ANSWER = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar day a DATE answer names, at local noon; `null` for a value that is not one. */
export function dateOfAnswer(answer: string | undefined): Date | null {
  const match = answer === undefined ? null : DATE_ANSWER.exec(answer);
  if (match === null) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return dateAnswerOf(date) === answer ? date : null;
}
