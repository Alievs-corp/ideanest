import type { PluralForms } from './plurals';

/**
 * Every word the backer survey screens draw — issue #84, under epic #78.
 *
 * <h2>Why it is a prop, like the rest</h2>
 *
 * `SurveyList` fetches with a bearer token the server never sees, `SurveyCard` holds a draft
 * and submits it, and `SurveyQuestionField` is a controlled form. All three are client
 * components and have to be, so none can call `getTranslations` — and `lib/i18n/shell-copy.ts`
 * carries the measurement (+24.7 KiB on every route in the group) that made a
 * `NextIntlClientProvider` the wrong answer for a surface like this one. The route resolves
 * the words once; the components draw them.
 *
 * <h2>One object for three components, because it is one screen</h2>
 *
 * The list renders the cards and the cards render the fields. Three accessors would be three
 * `getTranslations` calls over one namespace and three props to thread through a tree that is
 * already threading one, so {@link SurveysCopy} is resolved whole and each component is handed
 * the part it draws.
 *
 * <h2>The privacy sentence is a promise, not a hint</h2>
 *
 * `card.savedBody` — "the creator can see your answers" — tells somebody who else reads what
 * they have just typed, and `question.addressNote` tells them why the one answer that is not
 * in this form is not in it. A reader who cannot read those is answering without being told,
 * which is the reason this group is worth more than its ten strings. Neither may be softened
 * into a thank-you on the way through a translation.
 *
 * <h2>Two of these words are `common`'s</h2>
 *
 * "Browse campaigns" is the way out of every empty list on the platform — the saved, following
 * and pledge lists draw the same button — so the empty state reads it from `common` rather
 * than carrying a fourth spelling of it. Everything else here is this screen's: "Save answers"
 * is deliberately not `common.save`, because PM-06 makes a second submission the same row
 * moving and the control says so.
 */

/** A message lookup over a namespace, narrowed to what these builders need. */
export interface SurveysTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** The list at `/account/surveys` — §4.8 PM-05. */
export interface SurveyListCopy {
  /** The skeleton's accessible name, which says what is being waited for. */
  readonly loading: string;
  readonly failedTitle: string;
  /** What is shown when the service answered, and said no. */
  readonly refused: string;
  /** What is shown when it did not answer at all. */
  readonly unreachable: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** The way out of the empty state, which is `common`'s. */
  readonly emptyAction: string;
  /**
   * How many creators are waiting, declined.
   *
   * A ternary would be right in English and wrong in Russian, which picks between three forms
   * by the last digit. `lib/i18n/plurals.ts` carries the whole of that reasoning; the count is
   * only known in the browser, so it cannot be ICU resolved on the server.
   */
  readonly waitingTitle: PluralForms;
  readonly waitingBody: string;
}

/** One survey and the form that answers it — §4.8 PM-05 and PM-06. */
export interface SurveyCardCopy {
  /** The three state tags. §9.2: each says in words what its colour says. */
  readonly needsAnAnswer: string;
  readonly answered: string;
  readonly closed: string;
  /** Carries `{time}`. */
  readonly respondBy: string;
  readonly noDate: string;
  /** Carries `{time}`. */
  readonly answeredOn: string;
  readonly closedTitle: string;
  readonly closedBody: string;
  readonly failedTitle: string;
  readonly refused: string;
  readonly unreachable: string;
  readonly savedTitle: string;
  /** Who else reads the answers, and for how long they can be changed. */
  readonly savedBody: string;
  /** Beside the field, not at the top of the page — docs/ui-kit.md §9.2. */
  readonly required: string;
  readonly saving: string;
  /** "Save answers", before and after. A submission is the same row moving — PM-06. */
  readonly submit: string;
  readonly question: SurveyQuestionCopy;
}

/** The one question type that is not a field — `QuestionType.ADDRESS`. */
export interface SurveyQuestionCopy {
  /** Why the address is not asked for here: it is held separately and encrypted. */
  readonly addressNote: string;
  readonly addressLink: string;
}

/** Everything `/account/surveys` draws below its heading. */
export interface SurveysCopy {
  readonly list: SurveyListCopy;
  readonly card: SurveyCardCopy;
}

export function surveysCopyFrom(t: SurveysTranslator, common: SurveysTranslator): SurveysCopy {
  return {
    list: {
      loading: t('list.loading'),
      failedTitle: t('list.failedTitle'),
      refused: t('list.refused'),
      unreachable: t('list.unreachable'),
      emptyTitle: t('list.emptyTitle'),
      emptyBody: t('list.emptyBody'),
      emptyAction: common('browseCampaigns'),
      waitingTitle: t.raw('list.waitingTitle') as PluralForms,
      waitingBody: t('list.waitingBody'),
    },
    card: {
      needsAnAnswer: t('card.needsAnAnswer'),
      answered: t('card.answered'),
      closed: t('card.closed'),
      respondBy: String(t.raw('card.respondBy')),
      noDate: t('card.noDate'),
      answeredOn: String(t.raw('card.answeredOn')),
      closedTitle: t('card.closedTitle'),
      closedBody: t('card.closedBody'),
      failedTitle: t('card.failedTitle'),
      refused: t('card.refused'),
      unreachable: t('card.unreachable'),
      savedTitle: t('card.savedTitle'),
      savedBody: t('card.savedBody'),
      required: t('card.required'),
      saving: t('card.saving'),
      submit: t('card.submit'),
      question: {
        addressNote: t('question.addressNote'),
        addressLink: t('question.addressLink'),
      },
    },
  };
}
