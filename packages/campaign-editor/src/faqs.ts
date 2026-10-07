import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { pluralise } from '@ideanest/messages/plurals';
import type { SaveFailure } from './autosave';
import { characterCount } from './basics';
import type { NewProjectFaq, ProjectFaq, ProjectFaqPatch } from './contract';
import type { FaqOrderCopy, FaqPanelCopy, FaqValidationCopy } from './copy';

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
export function validateFaq(draft: FaqDraft, copy: FaqValidationCopy): FaqErrors {
  const errors: FaqErrors = {};

  const question = draft.question.trim();
  const answer = draft.answer.trim();

  if (question === '') {
    errors.question = copy.questionRequired;
  } else {
    const over = characterCount(question) - FAQ_QUESTION_MAX_CHARACTERS;
    if (over > 0) {
      errors.question = fillPlaceholders(pluralise(copy.locale, copy.questionTooLong, over), {
        max: String(FAQ_QUESTION_MAX_CHARACTERS),
      });
    }
  }

  if (answer === '') {
    errors.answer = copy.answerRequired;
  } else {
    const over = characterCount(answer) - FAQ_ANSWER_MAX_CHARACTERS;
    if (over > 0) {
      errors.answer = fillPlaceholders(pluralise(copy.locale, copy.answerTooLong, over), {
        max: String(FAQ_ANSWER_MAX_CHARACTERS),
      });
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

/* -------------------------------------------------------------------------
 * The reorder refusal, in words
 * ---------------------------------------------------------------------- */

/**
 * `FAQ_ORDER_INCOMPLETE`, as a sentence about questions rather than identifiers.
 *
 * `meta.missing` names entries the service holds that the order left out;
 * `meta.unexpected` names identifiers the order carried that the service does
 * not have. A creator can act on neither as a UUID, so each is turned back into
 * the question it belongs to wherever the caller still knows it, and counted
 * where it does not — an identifier the page has never seen is by definition
 * one it cannot name.
 *
 * Moved here from the web's `FaqPanel` (#162) so the app explains the same
 * refusal in the same words rather than in a second implementation. `faqs` is
 * every entry the caller knows of — the list as it was when the order was sent
 * as well as the list read again after the refusal, because an entry deleted
 * elsewhere is named only in the first and one added elsewhere only in the
 * second.
 */
export function describeOrderRefusal(
  failure: SaveFailure,
  faqs: readonly ProjectFaq[],
  copy: Pick<FaqPanelCopy, 'order' | 'locale'>,
): string {
  const missing = namesOf(failure.meta?.['missing'], faqs, copy);
  const unexpected = namesOf(failure.meta?.['unexpected'], faqs, copy);

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(fillPlaceholders(copy.order.missing, { items: joined(missing, copy.order) }));
  }
  if (unexpected.length > 0) {
    parts.push(fillPlaceholders(copy.order.unexpected, { items: joined(unexpected, copy.order) }));
  }

  const detail = parts.length === 0 ? copy.order.disagreed : parts.join(', ');
  return fillPlaceholders(copy.order.refusal, { detail });
}

function namesOf(
  value: unknown,
  faqs: readonly ProjectFaq[],
  copy: Pick<FaqPanelCopy, 'order' | 'locale'>,
): readonly string[] {
  if (!Array.isArray(value)) return [];

  const named: string[] = [];
  let unnamed = 0;
  for (const id of value as readonly unknown[]) {
    const known = typeof id === 'string' ? faqs.find((faq) => faq.id === id) : undefined;
    if (known === undefined) unnamed += 1;
    else named.push(fillPlaceholders(copy.order.quoted, { question: known.question }));
  }

  if (unnamed > 0) named.push(pluralise(copy.locale, copy.order.otherQuestions, unnamed));
  return named;
}

/** "a", "a and b", "a, b and c" — the conjunction is the catalogue's, not English. */
function joined(items: readonly string[], order: FaqOrderCopy): string {
  if (items.length <= 1) return items[0] ?? '';
  return fillPlaceholders(order.joinAnd, {
    head: items.slice(0, -1).join(', '),
    last: items[items.length - 1] ?? '',
  });
}
