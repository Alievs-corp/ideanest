import type { components } from '@ideanest/api-client';
import type { QuestionType } from '@ideanest/account/surveys';

/**
 * The survey builder's rules with one right answer — §4.8's PM-01 to PM-04, shared by
 * `apps/web` and `apps/mobile` (#163). Moved here from the web's `lib/dashboard/surveys.ts`
 * and `SurveyBuilder.tsx`; the endpoints stay with each client's own fetch.
 *
 * The question types are the backer side's (`@ideanest/account/surveys`): one contract, one
 * union. What differs is the question's shape — the builder holds a draft the creator is still
 * typing, the backer reads a survey that has been sent.
 *
 * <h2>The types are the contract's, narrowed</h2>
 *
 * springdoc marks every field optional because Java cannot tell it otherwise. These bodies are
 * serialised with `JsonInclude.ALWAYS`, so the only genuinely absent fields are the ones a draft
 * has no answer for — `sentAt`, `sentTo` — and narrowing the rest here is what keeps the screen
 * free of `?.` on fields that cannot be missing.
 */

export type { QuestionType };

type ContractSurvey = components['schemas']['SurveyResponseBody'];
type ContractQuestion = components['schemas']['SurveyQuestionBody'];

/**
 * §4.8's PM-03, in the order the builder offers them.
 *
 * Text first because it is what a creator reaches for when they have not decided; address last
 * because it is the one that stores no answer here.
 */
export const QUESTION_TYPES = [
  'TEXT',
  'CHOICE',
  'MULTI_CHOICE',
  'DATE',
  'ADDRESS',
] as const satisfies readonly QuestionType[];

/** The service's length limits, which the builder's fields enforce as they are typed. */
export const SURVEY_LIMITS = {
  title: 150,
  message: 2000,
  prompt: 300,
} as const;

/** Whether this type carries a list of options. Mirrors `QuestionType.hasChoices()`. */
export function hasChoices(type: QuestionType): boolean {
  return type === 'CHOICE' || type === 'MULTI_CHOICE';
}

/**
 * Whether "this has to be answered" applies. An ADDRESS question is answered on the pledge,
 * where the address is required by its own rules, so the builder offers no checkbox for it.
 */
export function offersRequired(type: QuestionType): boolean {
  return type !== 'ADDRESS';
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
   * PM-02. Empty means every backer is asked; a tier means only the backers who chose it. Empty
   * rather than `undefined` so a picker has a value to bind to — the conversion to an absent
   * field happens once, on the way out.
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

/** What a create or a save sends: the survey without the fields the service owns. */
export interface SurveyDraft {
  readonly title: string;
  readonly message?: string;
  readonly respondBy?: string;
  readonly questions: readonly SurveyQuestion[];
}

/** What PM-02's selector needs of a reward tier. */
export interface RewardTier {
  readonly id: string;
  readonly title: string;
}

/** A blank question, for the "add" button. */
export function emptyQuestion(): SurveyQuestion {
  return { prompt: '', type: 'TEXT', required: false, choices: [], rewardTierId: '' };
}

/**
 * The question with a new answer type.
 *
 * The options are cleared when the type stops having any, rather than kept and hidden: the
 * service refuses options on a type that has none, and a hidden value that causes a refusal is
 * one a creator cannot see to remove.
 */
export function withType(question: SurveyQuestion, type: QuestionType): SurveyQuestion {
  return { ...question, type, choices: hasChoices(type) ? question.choices : [] };
}

/** The options a multi-line field holds: one per line, trimmed, blank lines dropped. */
export function choicesFrom(text: string): readonly string[] {
  return text
    .split('\n')
    .map((choice) => choice.trim())
    .filter((choice) => choice !== '');
}

/**
 * Whether the survey's questions are a record rather than a form.
 *
 * Once a survey is sent the service refuses a change to its questions, because a question
 * edited after people answered it changes what they were asked without changing what they said.
 * The builder disables the controls so a creator is not offered an edit that is known to be
 * refused; the refusal is still what holds.
 */
export function questionsLocked(survey: Survey | null): boolean {
  return survey?.sent ?? false;
}

/**
 * The body the service takes for both a create and an update.
 *
 * A question's `id` and `position` are read-only on the wire — the order is the array's, and the
 * service rewrites the rows — so neither is sent. An empty `rewardTierId` becomes an absent
 * field, because "" is not an identifier and the service reads absent as "ask everybody".
 */
export function surveyBody(survey: SurveyDraft) {
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

export function questionFrom(question: ContractQuestion): SurveyQuestion {
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

export function surveyFrom(survey: ContractSurvey): Survey {
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

/** The list with `saved` first and any older copy of it removed: newest first, as the service sorts. */
export function withSurvey(surveys: readonly Survey[], saved: Survey): readonly Survey[] {
  return [saved, ...surveys.filter((survey) => survey.id !== saved.id)];
}
