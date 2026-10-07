import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { StoryDocument } from '@ideanest/campaign/story';
import { CampaignStory } from './CampaignStory';
import { campaignStoryCopyFrom } from '../../lib/i18n/campaign-copy';
import { translatorFor } from '../../test-copy';
import az from '@ideanest/messages/az.json';

/**
 * The story, rendered — the content #119 exists to put in the HTML.
 *
 * What is asserted here is what a crawler and a screen reader get:
 *
 *   - the prose is in the markup, not fetched;
 *   - the story's headings are `<h2>`/`<h3>` under the page's one `<h1>`, with the anchors
 *     the editor generated;
 *   - a mark is a semantic element rather than a class;
 *   - an embed is a link with a name, because an `<iframe>` on this origin is a third
 *     party's script beside the session cookie;
 *   - nothing is injected as markup.
 */

function story(blocks: StoryDocument['blocks']): StoryDocument {
  return { version: 1, blocks };
}

function spans(text: string, marks: ('strong' | 'em')[] = []) {
  return [{ text, marks }];
}

afterEach(cleanup);

/** Through the builder the page calls, so an empty catalogue fails here (`src/test-copy.ts`). */
const COPY = campaignStoryCopyFrom(translatorFor('campaign.story'));

describe('the campaign story', () => {
  it('renders the prose into the markup', () => {
    render(
      <CampaignStory
        title="A coffee table book"
        copy={COPY}
        story={story([
          { type: 'paragraph', spans: spans('Two hundred photographs, printed in Baku.') },
        ])}
      />,
    );

    expect(screen.getByText('Two hundred photographs, printed in Baku.')).toBeInTheDocument();
  });

  /**
   * The campaign's title is the page's one `<h1>`. A story that opened with a second would
   * give a screen-reader user two documents in one page, which is why #35's editor offers
   * only levels 2 and 3 and why this renders exactly those.
   */
  it('renders headings at level two and three, with their anchors', () => {
    render(
      <CampaignStory
        title="A coffee table book"
        copy={COPY}
        story={story([
          { type: 'heading', level: 2, id: 'the-book', text: 'The book' },
          { type: 'heading', level: 3, id: 'the-paper', text: 'The paper' },
        ])}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'The book' })).toHaveAttribute(
      'id',
      'the-book',
    );
    expect(screen.getByRole('heading', { level: 3, name: 'The paper' })).toHaveAttribute(
      'id',
      'the-paper',
    );
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('renders a mark as the element that means it', () => {
    const { container } = render(
      <CampaignStory
        title="A coffee table book"
        copy={COPY}
        story={story([
          {
            type: 'paragraph',
            spans: [
              { text: 'Printed ', marks: [] },
              { text: 'locally', marks: ['strong'] },
              { text: ' and ', marks: [] },
              { text: 'slowly', marks: ['em'] },
            ],
          },
        ])}
      />,
    );

    expect(container.querySelector('strong')).toHaveTextContent('locally');
    expect(container.querySelector('em')).toHaveTextContent('slowly');
  });

  /**
   * A LINK, NOT AN IFRAME. An embedded player on the origin that holds the session cookie
   * is a third party's script with a view of the page, and several hundred kilobytes before
   * anybody presses play — which the First Load JS budget in CI exists to notice.
   */
  it('renders an embed as a named link rather than an iframe', () => {
    const { container } = render(
      <CampaignStory
        title="A coffee table book"
        copy={COPY}
        story={story([
          {
            type: 'embed',
            provider: 'youtube',
            url: 'https://www.youtube.com/watch?v=abc',
            title: 'How the book is bound',
          },
        ])}
      />,
    );

    expect(container.querySelector('iframe')).toBeNull();
    const link = screen.getByRole('link', { name: 'How the book is bound — watch on YouTube' });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  /**
   * The document is text a creator typed and it arrives from a public endpoint. Rendering
   * it as elements rather than as markup is what stops a campaign page becoming a
   * cross-site scripting vector on the origin that holds the session cookie.
   */
  it('renders markup in the prose as text', () => {
    const { container } = render(
      <CampaignStory
        title="A coffee table book"
        copy={COPY}
        story={story([
          { type: 'paragraph', spans: spans('<img src=x onerror="alert(1)">') },
        ])}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  });

  it('gives the story a heading the outline needs and the design does not show', () => {
    render(
      <CampaignStory
        title="A coffee table book"
        copy={COPY}
        story={story([{ type: 'paragraph', spans: spans('Prose.') }])}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'About A coffee table book' }),
    ).toBeInTheDocument();
  });

  /**
   * #155: both phrases were English literals on every campaign in every language. Azerbaijani
   * is the case that could not have passed before, and its suffix sits on a noun, never on the
   * title or the provider.
   */
  it('names the story and the embed in the reader’s language', () => {
    render(
      <CampaignStory
        title="Kitab"
        copy={{ about: az.campaign.story.about, watchOn: az.campaign.story.watchOn }}
        story={story([
          { type: 'embed', provider: 'vimeo', url: 'https://vimeo.com/1', title: 'Cildləmə' },
        ])}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Kitab haqqında' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cildləmə — Vimeo platformasında baxın' })).toBeInTheDocument();
  });
});
