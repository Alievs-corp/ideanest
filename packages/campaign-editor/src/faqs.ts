import { characterCount } from './basics';
import type { NewProjectFaq, ProjectFaq, ProjectFaqPatch } from './contract';

/** §4.4's bounds. Refused by the service; shown to the creator before it is. */
export const FAQ_QUESTION_MAX_CHARACTERS = 200;
export const FAQ_ANSWER_MAX_CHARACTERS = 4000;

/**
 * §4.4's server-side cap on how many entries one campaign may publish.
 *
 * Restated so the editor can say "this campaign is at the limit" before a
 * creator types an entry the service will refuse. The service is still the
 * thing that enforces it.
 */
export const MAX_PROJECT_FAQS = 50;

/**
 * The FAQ form's own state, and the rules §4.4 refuses an entry against.
 *
 * Separate from `./contract` for the same reason `./rewards` is: that module is the
 * shape of the wire and this is the shape of a half-typed form. A draft holds
 * the strings the controls hold, so that "  " is a thing a creator can be part
 * way through typing rather than a value the client has already decided is
 * invalid.
 *
 * <h2>The bounds are the service's, restated so the creator meets them first</h2>
 *
 * The service refuses a blank question, a blank answer, a question over 200
 * characters and an answer over 4000, with an RFC 9457 problem detail. Every one
 * of those is checked here too — not instead. A creator who pastes 4200
 * characters and is told so before pressing Save has lost nothing; one who is
 * told by a round trip has lost the press. The service stays the authority: when
 * it refuses anyway, its own sentence wins (`fieldErrorsFrom`).
 */

export interface FaqDraft {
  question: string;
  answer: string;
}

export type FaqField = keyof FaqDraft;

export type FaqErrors = Partial<Record<FaqField, string>>;

export const EMPTY_FAQ: FaqDraft = Object.freeze({ question: '', answer: '' });

/** Whether a name the service used in a refusal is a control this form has. */
export function isFaqField(value: string): value is FaqField {
  return value === 'question' || value === 'answer';
}

export function faqDraftFrom(faq: ProjectFaq): FaqDraft {
  return { question: faq.question, answer: faq.answer };
}

/**
 * What is wrong with the draft, keyed by the control it is about.
 *
 * A message per field rather than a banner, because §7.13 puts the error on the
 * control: "that is too long" above a form with two fields in it is a sentence a
 * creator has to guess at.
 *
 * The over-length message says how many characters too many rather than how many
 * are allowed. The creator can already see the limit under the field; what they
 * cannot see is how much to cut.
 */
export function validateFaq(draft: FaqDraft): FaqErrors {
  const errors: FaqErrors = {};

  const question = draft.question.trim();
  const answer = draft.answer.trim();

  if (question === '') {
    errors.question = 'A question is needed. It is what a backer scans the list for.';
  } else {
    const over = characterCount(question) - FAQ_QUESTION_MAX_CHARACTERS;
    if (over > 0) {
      errors.question = `That is ${over} character${over === 1 ? '' : 's'} too long. A question is at most ${FAQ_QUESTION_MAX_CHARACTERS}.`;
    }
  }

  if (answer === '') {
    errors.answer = 'An answer is needed. A question with no answer reads as a refusal to give one.';
  } else {
    const over = characterCount(answer) - FAQ_ANSWER_MAX_CHARACTERS;
    if (over > 0) {
      errors.answer = `That is ${over} character${over === 1 ? '' : 's'} too long. An answer is at most ${FAQ_ANSWER_MAX_CHARACTERS}.`;
    }
  }

  return errors;
}

/**
 * The creation body.
 *
 * Trimmed, because the service refuses a blank and leading whitespace is not
 * content — but only at the ends. The line breaks inside an answer are the only
 * structure plain text has, and the public tab renders them.
 */
export function newFaqFrom(draft: FaqDraft): NewProjectFaq {
  return { question: draft.question.trim(), answer: draft.answer.trim() };
}

/**
 * Only what changed.
 *
 * A merge patch that wrote both fields back unchanged would still move
 * `updated_at` for no reason, and would still be refused by any future field
 * lock — both for nothing. An empty patch is not sent at all; see
 * {@link isEmptyFaqPatch}.
 */
export function faqPatchFrom(draft: FaqDraft, faq: ProjectFaq): ProjectFaqPatch {
  const patch: ProjectFaqPatch = {};

  const question = draft.question.trim();
  const answer = draft.answer.trim();

  if (question !== faq.question) patch.question = question;
  if (answer !== faq.answer) patch.answer = answer;

  return patch;
}

export function isEmptyFaqPatch(patch: ProjectFaqPatch): boolean {
  return Object.keys(patch).length === 0;
}
