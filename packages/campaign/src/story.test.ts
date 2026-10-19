import { describe, expect, it } from 'vitest';
import { EMBED_PROVIDERS, STORY_SCHEMA_VERSION, isEmbedProvider, readStoryDocument, storyAnchors } from './story';

/**
 * The story reader both campaign pages render through (#140, #155).
 *
 * The app rendered every real story as nothing because it read a different schema. What is
 * pinned here is the schema both clients now accept: version 1, the seven block types, and a
 * refusal — never a partial document — for anything else.
 */
describe('readStoryDocument', () => {
  it('reads the contract §5 document', () => {
    const wire = {
      version: 1,
      blocks: [
        { type: 'heading', level: 2, id: 'how-it-works', text: 'How it works' },
        { type: 'paragraph', spans: [{ text: 'Plain ', marks: [] }, { text: 'bold', marks: ['strong'] }] },
        { type: 'list', ordered: false, items: [[{ text: 'One', marks: [] }]] },
        { type: 'quote', spans: [] },
        { type: 'rule' },
        { type: 'image', url: 'https://a.example/b.jpg', width: 1600, height: 900, alt: 'A' },
        { type: 'embed', provider: 'youtube', url: 'https://y.example/1', title: 'A' },
      ],
    };

    expect(readStoryDocument(wire)?.blocks).toHaveLength(7);
  });

  it('reads a section, with and without its picture', () => {
    const image = { url: 'https://a.example/w.jpg', width: 1440, height: 960, alt: 'The bench' };
    const spans = [{ text: 'Where it is made.', marks: [] }];

    expect(
      readStoryDocument({
        version: 1,
        blocks: [
          { type: 'section', id: 'our-workshop', title: 'Our workshop', image, spans },
          { type: 'section', id: 'the-team', title: 'The team', image: null, spans: [] },
        ],
      })?.blocks,
    ).toEqual([
      { type: 'section', id: 'our-workshop', title: 'Our workshop', image, spans },
      { type: 'section', id: 'the-team', title: 'The team', image: null, spans: [] },
    ]);
  });

  it('reads a section whose null picture the service left out', () => {
    // `non_null` serialisation turns `image: null` into an absent key.
    expect(
      readStoryDocument({ version: 1, blocks: [{ type: 'section', id: 'a', title: 'A', spans: [] }] })?.blocks,
    ).toEqual([{ type: 'section', id: 'a', title: 'A', image: null, spans: [] }]);
  });

  it('refuses a malformed section', () => {
    const section = { type: 'section', id: 'a', title: 'A', image: null, spans: [] };
    expect(readStoryDocument({ version: 1, blocks: [{ ...section, title: 5 }] })).toBeNull();
    expect(readStoryDocument({ version: 1, blocks: [{ ...section, id: undefined }] })).toBeNull();
    expect(readStoryDocument({ version: 1, blocks: [{ ...section, spans: 'text' }] })).toBeNull();
    expect(
      readStoryDocument({ version: 1, blocks: [{ ...section, image: { url: 'u', width: 1.5, height: 2, alt: 'a' } }] }),
    ).toBeNull();
    expect(readStoryDocument({ version: 1, blocks: [{ ...section, image: 'https://a/b.jpg' }] })).toBeNull();
  });

  it('refuses a document it does not fully recognise', () => {
    // The story may have been written by a newer deployment of the editor.
    // Casting would put an unrecognised block into the editor's state, and the
    // next autosave would send it back mangled — destroying writing in a request
    // that looks like an ordinary save.
    expect(readStoryDocument({ version: 1, blocks: [{ type: 'marquee' }] })).toBeNull();
    expect(readStoryDocument({ version: 2, blocks: [] })).toBeNull();
    expect(readStoryDocument({ version: 1, blocks: [{ type: 'embed', provider: 'tiktok', url: 'https://t/1', title: 'A' }] })).toBeNull();
    expect(readStoryDocument({ version: 1, blocks: [{ type: 'heading', level: 1, id: 'a', text: 'A' }] })).toBeNull();
    expect(readStoryDocument({ version: 1 })).toBeNull();
    expect(readStoryDocument(null)).toBeNull();
    expect(readStoryDocument(5)).toBeNull();
  });

  it('refuses a span whose marks are not marks', () => {
    expect(
      readStoryDocument({
        version: 1,
        blocks: [{ type: 'paragraph', spans: [{ text: 'a', marks: ['blink'] }] }],
      }),
    ).toBeNull();
  });
});

describe('the schema version and the embed providers', () => {
  it('is version 1, and a version 2 document is refused rather than half-read', () => {
    expect(STORY_SCHEMA_VERSION).toBe(1);
    expect(
      readStoryDocument({ version: 2, blocks: [{ type: 'paragraph', spans: [{ text: 'a', marks: [] }] }] }),
    ).toBeNull();
    expect(readStoryDocument({ version: '1', blocks: [] })).toBeNull();
  });

  it('refuses a malformed document of the right version', () => {
    expect(readStoryDocument({ version: 1, blocks: {} })).toBeNull();
    expect(readStoryDocument({ version: 1, blocks: [null] })).toBeNull();
    expect(readStoryDocument({ version: 1, blocks: [{ type: 'paragraph', spans: 'text' }] })).toBeNull();
    expect(
      readStoryDocument({ version: 1, blocks: [{ type: 'image', url: 'u', width: 1.5, height: 2, alt: 'a' }] }),
    ).toBeNull();
    expect(readStoryDocument({ version: 1, blocks: [{ type: 'list', ordered: 'yes', items: [] }] })).toBeNull();
    // A TipTap tree, which is what the app's old walker expected: not this schema.
    expect(readStoryDocument({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull();
  });

  it('reads an empty story as an empty document, which renders no section', () => {
    expect(readStoryDocument({ version: 1, blocks: [] })).toEqual({ version: 1, blocks: [] });
  });

  it('knows YouTube and Vimeo and nothing else', () => {
    expect([...EMBED_PROVIDERS]).toEqual(['youtube', 'vimeo']);
    expect(isEmbedProvider('vimeo')).toBe(true);
    expect(isEmbedProvider('tiktok')).toBe(false);
    expect(isEmbedProvider(undefined)).toBe(false);
  });
});

describe('storyAnchors', () => {
  it('lists headings and sections in document order, a section as level 2', () => {
    expect(
      storyAnchors({
        version: 1,
        blocks: [
          { type: 'heading', level: 2, id: 'the-plan', text: 'The plan' },
          { type: 'paragraph', spans: [] },
          { type: 'heading', level: 3, id: 'stage-one', text: 'Stage one' },
          { type: 'section', id: 'our-workshop', title: 'Our workshop', image: null, spans: [] },
        ],
      }),
    ).toEqual([
      { id: 'the-plan', text: 'The plan', level: 2 },
      { id: 'stage-one', text: 'Stage one', level: 3 },
      { id: 'our-workshop', text: 'Our workshop', level: 2 },
    ]);
  });
});
