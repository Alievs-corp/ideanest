import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CampaignFaq } from '../../lib/community/faqs';
import { CampaignFaqs } from './CampaignFaqs';
import CATALOGUE from '@ideanest/messages/en.json';
import { resolveServerTree } from '../../test-support/server-tree';
import { expectNoViolations } from '../../test-axe';

/*
 * The real catalogue, through next-intl's own formatter.
 *
 * `createTranslator` rather than a hand-rolled substitution, because these messages carry ICU
 * plurals — `{days, plural, one {# day left} other {# days left}}` — and a regex that swapped
 * `{days}` for a number would produce a sentence no language actually renders. Asserting
 * against `messages/en.json` formatted the way the application formats it is what makes this
 * suite fail when a translation is edited to something the component no longer draws.
 */
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');

  return {
    getLocale: async () => 'en',
    /*
     * `namespace` is a plain string here and a union of every valid path in next-intl's own
     * types. The cast is at the mock's edge rather than at each call: what a component asks
     * for is whatever it asks for, and a namespace that does not exist fails as a missing
     * message — which is the failure worth seeing.
     */
    getTranslations: async (namespace: string) =>
      createTranslator({
        locale: 'en',
        messages: CATALOGUE,
        namespace: namespace as never,
      }),
  };
});



/**
 * §4.4's FAQ tab — #283.
 *
 * WHAT THESE COVER:
 *
 *   - **the entries are on screen in the order the service sent them.** `sort_order` is what
 *     the editor's move controls write and what a backer reads down. A component that sorted
 *     would discard the creator's decision about which question is read first.
 *   - **"could not be loaded" and "has answered nothing" are different sentences.** This is
 *     the distinction the tab waited for an endpoint in order to be able to make: before
 *     `project_faqs` existed, the second sentence would have been printed on every campaign
 *     on the platform, as a claim about each creator that was really a statement about the
 *     software.
 *   - **an answer is text, never markup**, and its line breaks survive. An answer reaches
 *     this component as a string a creator typed, from a public endpoint, with no schema
 *     behind it at all — injecting it as markup would make the campaign page a cross-site
 *     scripting vector on the origin that holds the session.
 *   - **every question is a heading**, so a screen-reader user can move between them instead
 *     of reading every answer to find the next question.
 *   - **nothing is hidden behind a disclosure.** The component's own doc comment argues it:
 *     collapsed text is text the browser's find-in-page does not match, and a backer looking
 *     for "Germany" concludes the campaign never said.
 */

function faq(overrides: Partial<CampaignFaq> = {}): CampaignFaq {
  return {
    id: 'faq-1',
    question: 'Do you ship to Germany?',
    answer: 'Yes — shipping is calculated at checkout.',
    ...overrides,
  };
}

afterEach(cleanup);

describe('the FAQ tab', () => {
  it('renders the entries in the order the service sent them', async () => {
    render(
      await resolveServerTree(
        <CampaignFaqs
        faqs={[
          faq({ id: 'a', question: 'When does it ship?' }),
          faq({ id: 'b', question: 'Do you ship to Germany?' }),
          faq({ id: 'c', question: 'Is there a digital edition?' }),
        ]}
      />,
      ),
    );

    const questions = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(questions).toEqual([
      'When does it ship?',
      'Do you ship to Germany?',
      'Is there a digital edition?',
    ]);
  });

  it('gives every question a heading and prints its answer beside it', async () => {
    render(await resolveServerTree(<CampaignFaqs faqs={[faq()]} />));

    expect(
      screen.getByRole('heading', { level: 3, name: 'Do you ship to Germany?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Yes — shipping is calculated at checkout.')).toBeInTheDocument();
  });

  it('renders an answer as text, never as markup', async () => {
    render(await resolveServerTree(<CampaignFaqs faqs={[faq({ answer: '<img src=x onerror="alert(1)">' })]} />));

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  /**
   * Paragraph breaks are the only structure a plain-text answer has. They survive because
   * the answer is rendered into a `whitespace-pre-line` paragraph rather than collapsed by
   * the normal HTML whitespace rules.
   */
  it('keeps the line breaks in an answer', async () => {
    render(await resolveServerTree(<CampaignFaqs faqs={[faq({ answer: 'First this.\n\nThen that.' })]} />));

    const answer = screen.getByText(/First this\./u);
    expect(answer.textContent).toBe('First this.\n\nThen that.');
    expect(answer).toHaveClass('whitespace-pre-line');
  });

  it('says the campaign has answered nothing only when the campaign has answered nothing', async () => {
    render(await resolveServerTree(<CampaignFaqs faqs={[]} />));

    expect(screen.getByText(/has not answered any questions yet/u)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/u)).not.toBeInTheDocument();
  });

  it('blames the service, not the creator, when the read was refused', async () => {
    render(await resolveServerTree(<CampaignFaqs faqs={null} />));

    expect(screen.getByText(/could not be loaded/u)).toBeInTheDocument();
    expect(screen.queryByText(/has not answered any questions yet/u)).not.toBeInTheDocument();
  });

  /**
   * The order is content, so it is a list rather than a stack of boxes: a screen reader
   * saying "3 of 6" is telling the reader something true about the campaign.
   */
  it('is an ordered list, because the order is the creator’s', async () => {
    const { container } = render(await resolveServerTree(<CampaignFaqs faqs={[faq({ id: 'a' }), faq({ id: 'b' })]} />));

    const list = container.querySelector('ol');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll('li')).toHaveLength(2);
  });

  /**
   * Collapsed text is text the browser's own find-in-page does not match in several
   * browsers. A backer searching the page for "Germany" would conclude the campaign never
   * said — which is the opposite of why this tab is server-rendered.
   */
  it('hides no answer behind a disclosure', async () => {
    const { container } = render(await resolveServerTree(<CampaignFaqs faqs={[faq()]} />));

    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Yes — shipping is calculated at checkout.')).toBeVisible();
  });
});

describe('accessibility', () => {
  /** #129. A list of question-and-answer pairs, which is where a heading ladder goes wrong. */
  it('leaves no automatically detectable violation', async () => {
    const { container } = render(await resolveServerTree(<CampaignFaqs faqs={[faq()]} />));

    await expectNoViolations(container);
  });
});
