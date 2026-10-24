import { describe, expect, it } from 'vitest';
import { diffSequences, diffStory, diffText, foldUnchanged, storyLines, tokenise } from './revision-diff';

describe('diffSequences', () => {
  it('keeps what is common and splits the rest into removed and added', () => {
    const parts = diffSequences(['a', 'b', 'c'], ['a', 'x', 'c']);

    expect(parts).toEqual([
      { kind: 'same', value: 'a' },
      { kind: 'removed', value: 'b' },
      { kind: 'added', value: 'x' },
      { kind: 'same', value: 'c' },
    ]);
  });

  it('answers a pure insertion and a pure removal', () => {
    expect(diffSequences([], ['a'])).toEqual([{ kind: 'added', value: 'a' }]);
    expect(diffSequences(['a'], [])).toEqual([{ kind: 'removed', value: 'a' }]);
    expect(diffSequences<string>([], [])).toEqual([]);
  });
});

describe('diffText', () => {
  it('tokenises so that joining the tokens gives the text back', () => {
    const text = 'Two  words,\nand more';
    expect(tokenise(text).join('')).toBe(text);
  });

  it('marks only what each side lost or gained, word by word', () => {
    const { live, proposed } = diffText('A small garden of herbs', 'A large garden of herbs and spices');

    expect(live.filter((part) => part.kind === 'removed').map((part) => part.value)).toEqual(['small']);
    expect(live.map((part) => part.value).join('')).toBe('A small garden of herbs');
    expect(proposed.filter((part) => part.kind === 'added').map((part) => part.value.trim())).toEqual([
      'large',
      'and spices',
    ]);
    expect(proposed.map((part) => part.value).join('')).toBe('A large garden of herbs and spices');
  });

  it('marks nothing when the texts are equal', () => {
    const { live, proposed } = diffText('Same words', 'Same words');

    expect(live).toEqual([{ kind: 'same', value: 'Same words' }]);
    expect(proposed).toEqual(live);
  });
});

const doc = (...blocks: unknown[]) => ({ version: 1, blocks });
const paragraph = (text: string) => ({ type: 'paragraph', spans: [{ text, marks: [] }] });

describe('story comparison', () => {
  it('reads an absent story as no blocks and an unrecognised one as unreadable', () => {
    expect(storyLines(null)).toEqual([]);
    expect(storyLines({ version: 99, blocks: [] })).toBeNull();
  });

  it('compares block by block and says what each side shows', () => {
    const before = storyLines(doc(paragraph('One'), paragraph('Two'), paragraph('Three')));
    const after = storyLines(doc(paragraph('One'), paragraph('Two, rewritten'), paragraph('Three')));
    if (before === null || after === null) throw new Error('story did not parse');

    const sides = diffStory(before, after);

    expect(sides.live.map((part) => [part.kind, part.value.text])).toEqual([
      ['same', 'One'],
      ['removed', 'Two'],
      ['same', 'Three'],
    ]);
    expect(sides.proposed.map((part) => [part.kind, part.value.text])).toEqual([
      ['same', 'One'],
      ['added', 'Two, rewritten'],
      ['same', 'Three'],
    ]);
  });

  it('describes list items, headings and sections as readable text', () => {
    const lines = storyLines(
      doc(
        { type: 'heading', level: 2, id: 'a', text: 'Plans' },
        { type: 'list', ordered: true, items: [[{ text: 'First', marks: ['strong'] }], [{ text: 'Second', marks: [] }]] },
        { type: 'section', id: 's', title: 'Team', image: null, video: null, spans: [{ text: 'Four of us', marks: [] }] },
      ),
    );

    expect(lines?.[0]).toMatchObject({ kind: 'heading', text: 'Plans', level: 2 });
    expect(lines?.[1]).toMatchObject({ kind: 'orderedList', items: ['First', 'Second'] });
    expect(lines?.[2]).toMatchObject({ kind: 'section', text: 'Team\nFour of us' });
  });
});

describe('foldUnchanged', () => {
  const same = (value: number) => ({ kind: 'same' as const, value });

  it('folds a long unchanged run to its edges and leaves short ones alone', () => {
    const parts = [same(1), same(2), same(3), same(4), same(5), { kind: 'added' as const, value: 6 }];

    const folded = foldUnchanged(parts);

    expect(folded).toEqual([{ folded: 4 }, same(5), { kind: 'added', value: 6 }]);
    expect(foldUnchanged([same(1), same(2), { kind: 'removed' as const, value: 3 }])).toHaveLength(3);
  });
});
