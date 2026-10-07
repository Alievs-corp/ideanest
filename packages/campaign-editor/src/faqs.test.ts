import { describe, expect, it } from 'vitest';
import type { ProjectFaq } from './contract';
import {
  FAQ_ANSWER_MAX_CHARACTERS,
  FAQ_QUESTION_MAX_CHARACTERS,
  faqPatchFrom,
  isEmptyFaqPatch,
  newFaqFrom,
  validateFaq,
} from './faqs';

/**
 * The FAQ form's rules — the editor half of #283.
 *
 * WHAT THESE COVER:
 *
 *   - **the service's bounds are met before the round trip, not instead of it.** §4.4 caps a
 *     question at 200 characters and an answer at 4000 and refuses a blank either side. A
 *     creator who pastes 4200 characters and is told so at once has lost nothing; one told by
 *     a refusal has lost the press. The service stays the authority — this is the first of
 *     two checks, never the only one.
 *   - **a patch carries only what changed.** A merge patch writing both fields back unchanged
 *     would move `updated_at` for nothing, and an empty one is not sent at all.
 *   - **the ends are trimmed and the middle is not.** Leading whitespace is not content; the
 *     line breaks inside an answer are the only structure plain text has, and the public tab
 *     renders them.
 */

const FAQ: ProjectFaq = {
  id: 'faq-a',
  question: 'Do you ship to Germany?',
  answer: 'Yes.',
};

describe('validating an entry', () => {
  it('refuses a blank question and a blank answer, separately', () => {
    const errors = validateFaq({ question: '   ', answer: '' });

    expect(errors.question).toMatch(/A question is needed/u);
    expect(errors.answer).toMatch(/An answer is needed/u);
  });

  it('accepts an entry at exactly the limit and refuses one past it', () => {
    expect(
      validateFaq({ question: 'q'.repeat(FAQ_QUESTION_MAX_CHARACTERS), answer: 'a' }).question,
    ).toBeUndefined();

    expect(
      validateFaq({ question: 'q'.repeat(FAQ_QUESTION_MAX_CHARACTERS + 3), answer: 'a' }).question,
    ).toMatch(/3 characters too long/u);

    expect(
      validateFaq({ question: 'q', answer: 'a'.repeat(FAQ_ANSWER_MAX_CHARACTERS + 1) }).answer,
    ).toMatch(/1 character too long/u);
  });

  it('says nothing about an entry that is within both bounds', () => {
    expect(validateFaq({ question: 'Do you ship to Germany?', answer: 'Yes.' })).toEqual({});
  });
});

describe('building the body', () => {
  it('trims the ends and keeps the line breaks in the middle', () => {
    expect(newFaqFrom({ question: '  How?  ', answer: '  First this.\n\nThen that.  ' })).toEqual({
      question: 'How?',
      answer: 'First this.\n\nThen that.',
    });
  });

  it('patches only the field that changed', () => {
    expect(faqPatchFrom({ question: FAQ.question, answer: 'Yes, and Austria.' }, FAQ)).toEqual({
      answer: 'Yes, and Austria.',
    });
  });

  it('produces an empty patch when nothing changed, which is not sent', () => {
    const patch = faqPatchFrom({ question: FAQ.question, answer: FAQ.answer }, FAQ);

    expect(patch).toEqual({});
    expect(isEmptyFaqPatch(patch)).toBe(true);
  });
});
