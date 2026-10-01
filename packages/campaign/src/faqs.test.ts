import { describe, expect, it } from 'vitest';
import { CAMPAIGN_FAQ_LIMIT, readFaqList } from './faqs';

/**
 * §4.4's FAQ tab, as the public read narrows — #283, shared since #155. The creator's order is
 * kept, an unusable row is dropped, and an answer's line breaks survive.
 */
describe('reading a campaign FAQ list', () => {
  it('keeps the order the service sent rather than sorting it', () => {
    const faqs = readFaqList({
      faqs: [
        { id: 'c', question: 'When does it ship?', answer: 'March.' },
        { id: 'a', question: 'Do you ship to Germany?', answer: 'Yes.' },
        { id: 'b', question: 'Is there a digital edition?', answer: 'Not yet.' },
      ],
    });

    expect(faqs.map((faq) => faq.id)).toEqual(['c', 'a', 'b']);
  });

  it('drops a row with no answer, no question or no identifier and keeps the ones beside it', () => {
    const faqs = readFaqList({
      faqs: [
        { id: 'a', question: 'Good', answer: 'Yes.' },
        { id: 'b', question: 'No answer' },
        { id: 'c', answer: 'No question.' },
        { question: 'No identifier', answer: 'Yes.' },
        { id: 'd', question: 'Also good', answer: 'Also yes.' },
      ],
    });

    expect(faqs.map((faq) => faq.id)).toEqual(['a', 'd']);
  });

  /**
   * A blank answer is refused by the service, so a blank one arriving means something else
   * went wrong. Either way it is not a row a reader can be shown.
   */
  it('treats a blank answer as no answer', () => {
    expect(readFaqList({ faqs: [{ id: 'a', question: 'Q', answer: '   ' }] })).toEqual([]);
  });

  it('keeps the line breaks inside an answer, because they are its only structure', () => {
    const faqs = readFaqList({
      faqs: [{ id: 'a', question: 'How?', answer: 'First this.\n\nThen that.' }],
    });

    expect(faqs[0]?.answer).toBe('First this.\n\nThen that.');
  });

  it('answers an empty list for a body that is not one', () => {
    expect(readFaqList(null)).toEqual([]);
    expect(readFaqList('nope')).toEqual([]);
    expect(readFaqList({ faqs: 'nope' })).toEqual([]);
  });

  /** Nothing may push into the list a campaign with no questions shares. */
  it('answers a frozen list rather than one a caller can append to', () => {
    expect(Object.isFrozen(readFaqList({}))).toBe(true);
  });
});

describe('the cap', () => {
  it('is fifty, restated rather than enforced', () => {
    expect(CAMPAIGN_FAQ_LIMIT).toBe(50);
  });
});
