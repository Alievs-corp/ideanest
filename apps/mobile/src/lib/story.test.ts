import { storyParagraphs } from './story';

/**
 * A version-1 block document as `GET /v1/projects/{creatorSlug}/{projectSlug}`
 * returns it: every block type the editor can save, in the JSON the server
 * validates (`StoryDocuments`). Parsed from text rather than written as an object
 * literal, so nothing about it is shaped by this test's types.
 */
const PUBLISHED_STORY = JSON.parse(`{
  "version": 1,
  "blocks": [
    { "type": "heading", "level": 2, "id": "the-lamp", "text": "The lamp" },
    { "type": "paragraph", "spans": [
      { "text": "Built ", "marks": [] },
      { "text": "entirely", "marks": ["strong"] },
      { "text": " by hand.", "marks": [] }
    ] },
    { "type": "image", "url": "https://media.ideanest.az/a.webp", "width": 1200, "height": 800, "alt": "The lamp on a desk" },
    { "type": "heading", "level": 3, "id": "the-plan", "text": "The plan" },
    { "type": "list", "ordered": true, "items": [
      [{ "text": "Tooling", "marks": [] }],
      [{ "text": "Assembly", "marks": ["em"] }]
    ] },
    { "type": "list", "ordered": false, "items": [
      [{ "text": "Solar", "marks": [] }],
      [{ "text": "Recyclable", "marks": [] }]
    ] },
    { "type": "rule" },
    { "type": "quote", "spans": [{ "text": "It lit the whole room.", "marks": ["em"] }] },
    { "type": "embed", "provider": "youtube", "url": "https://www.youtube.com/watch?v=abc", "title": "The lamp at night" }
  ]
}`) as unknown;

/**
 * The story arrives from the network, so the one property that matters beyond
 * reading it is that nothing here throws on a shape it did not expect — a
 * campaign page that crashes on an unusual story is worse than one that shows
 * fewer paragraphs.
 */
describe('storyParagraphs', () => {
  it('reads every block with text from a published version-1 document', () => {
    expect(storyParagraphs(PUBLISHED_STORY)).toEqual([
      'The lamp',
      'Built entirely by hand.',
      'The plan',
      '1. Tooling',
      '2. Assembly',
      '• Solar',
      '• Recyclable',
      'It lit the whole room.',
    ]);
  });

  it('drops empty blocks and empty list items without skipping a number', () => {
    expect(
      storyParagraphs({
        version: 1,
        blocks: [
          { type: 'paragraph', spans: [{ text: 'One.', marks: [] }] },
          { type: 'paragraph', spans: [] },
          { type: 'paragraph', spans: [{ text: '   ', marks: [] }] },
          { type: 'heading', level: 2, id: 'x', text: '' },
          {
            type: 'list',
            ordered: true,
            items: [[{ text: 'First', marks: [] }], [], [{ text: 'Second', marks: [] }]],
          },
        ],
      }),
    ).toEqual(['One.', '1. First', '2. Second']);
  });

  it('answers nothing for a version this build does not know, as the web does', () => {
    expect(
      storyParagraphs({ version: 2, blocks: [{ type: 'paragraph', spans: [{ text: 'Later.', marks: [] }] }] }),
    ).toEqual([]);
  });

  it('no longer reads the TipTap shape stories used to have', () => {
    expect(
      storyParagraphs({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A solar lamp.' }] }],
      }),
    ).toEqual([]);
  });

  it('skips a block it cannot read rather than dropping the story', () => {
    expect(
      storyParagraphs({
        version: 1,
        blocks: [null, 'text', { type: 'marquee', text: 'Hi' }, { type: 'paragraph', spans: 'x' }, { type: 'paragraph', spans: [{ text: 'Kept.' }] }],
      }),
    ).toEqual(['Kept.']);
  });

  it('answers nothing rather than throwing for a shape it did not expect', () => {
    expect(storyParagraphs(null)).toEqual([]);
    expect(storyParagraphs(undefined)).toEqual([]);
    expect(storyParagraphs('a string')).toEqual([]);
    expect(storyParagraphs(42)).toEqual([]);
    expect(storyParagraphs({})).toEqual([]);
    expect(storyParagraphs({ version: 1 })).toEqual([]);
    expect(storyParagraphs([])).toEqual([]);
  });
});
