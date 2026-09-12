import { describe, expect, it } from 'vitest';
import { STORY_COPY } from '../../test-editor-copy';
import {
  blockProblem,
  describeBlock,
  headingAnchors,
  isMarkActive,
  isSaveable,
  moveBlock,
  newBlock,
  parseSpans,
  readStoryDocument,
  removeBlock,
  slugifyHeading,
  spansToText,
  storyCharacterCount,
  storyProblems,
  toggleMark,
  uniqueHeadingId,
  type StoryBlock,
  type StoryDocument,
} from './story';

/**
 * The document model, at its edges.
 *
 * Appearance is reviewed in Storybook and behaviour in `StoryPanel.test.tsx`. What
 * is here is what fails silently: an anchor the server would fold differently, a
 * character count that disagrees with §5.3's minimum, a mark syntax that does not
 * round-trip, and a block move that loses a block. Every one of those produces a
 * story that looks right and is wrong.
 */

function document(blocks: readonly StoryBlock[]): StoryDocument {
  return { version: 1, blocks };
}

describe('slugifyHeading', () => {
  it('folds Azerbaijani the way the server does', () => {
    // The same foldings as `az.ideanest.shared.Slugs`. If these two disagree the
    // editor generates an anchor the server refuses, and the creator sees an
    // autosave fail for a reason nothing on screen explains.
    expect(slugifyHeading('Səbinənin planı')).toBe('sebinenin-plani');
    expect(slugifyHeading('İlk mərhələ')).toBe('ilk-merhele');
    expect(slugifyHeading('Çətinliklər və risklər')).toBe('cetinlikler-ve-riskler');
  });

  it('strips accents that Unicode does decompose', () => {
    expect(slugifyHeading('Café Réunion')).toBe('cafe-reunion');
  });

  it('collapses punctuation and trims the edges', () => {
    expect(slugifyHeading('  How it works — step 1!  ')).toBe('how-it-works-step-1');
    expect(slugifyHeading('---leading and trailing---')).toBe('leading-and-trailing');
  });

  it('returns nothing when nothing survives folding', () => {
    // A heading written entirely in a script the folding does not transliterate.
    // The caller decides what to do with it; inventing an anchor here would hide
    // the case, exactly as `Slugs` refuses to.
    expect(slugifyHeading('日本語')).toBe('');
  });
});

describe('uniqueHeadingId', () => {
  it('numbers a repeated anchor rather than randomising it', () => {
    // The anchor is a fragment somebody may share. `#the-plan-2` is a readable
    // address in a way that `#the-plan-a7f3` is not.
    expect(uniqueHeadingId('The plan', [])).toBe('the-plan');
    expect(uniqueHeadingId('The plan', ['the-plan'])).toBe('the-plan-2');
    expect(uniqueHeadingId('The plan', ['the-plan', 'the-plan-2'])).toBe('the-plan-3');
  });

  it('falls back to a usable anchor when the text folds to nothing', () => {
    expect(uniqueHeadingId('日本語', [])).toBe('section');
    expect(uniqueHeadingId('', ['section'])).toBe('section-2');
  });
});

describe('the inline mark syntax', () => {
  it('parses strong and emphasis', () => {
    expect(parseSpans('Plain **bold** and *italic*')).toEqual([
      { text: 'Plain ', marks: [] },
      { text: 'bold', marks: ['strong'] },
      { text: ' and ', marks: [] },
      { text: 'italic', marks: ['em'] },
    ]);
  });

  it('parses both marks at once', () => {
    expect(parseSpans('***everything***')).toEqual([{ text: 'everything', marks: ['strong', 'em'] }]);
  });

  it('merges neighbours carrying the same marks', () => {
    // Without merging, `**a****b**` is two identically marked spans and the
    // document would count as "changed" on the next save without anybody typing —
    // which writes a version history entry describing an edit that did not happen.
    expect(parseSpans('**a****b**')).toEqual([{ text: 'ab', marks: ['strong'] }]);
  });

  it('reads a toggle inside a toggle', () => {
    // `*a**b*` is emphasis with a strong toggle opened inside it, not two
    // emphasised runs. Marks are a property of each character, which is why the
    // parser tracks them rather than matching delimiters.
    expect(parseSpans('*a**b*')).toEqual([
      { text: 'a', marks: ['em'] },
      { text: 'b', marks: ['strong', 'em'] },
    ]);
  });

  it('treats an unclosed mark as running to the end', () => {
    // What somebody mid-keystroke means, and what the preview should show them.
    expect(parseSpans('**still typing')).toEqual([{ text: 'still typing', marks: ['strong'] }]);
  });

  it('round-trips canonical text through spans and back', () => {
    for (const text of [
      'Plain',
      'Plain **bold** and *italic*',
      '***both*** at once',
      'A literal \\* asterisk',
      'A backslash \\\\ and a star \\*',
    ]) {
      expect(spansToText(parseSpans(text))).toBe(text);
    }
  });

  it('round-trips any spans exactly, which is the invariant that matters', () => {
    // The document is the truth and the textarea is a view of it, so this is the
    // direction the editor depends on: a story loaded, shown, and saved unchanged
    // must produce the same document — otherwise merely opening the story tab
    // would write a version history entry.
    for (const spans of [
      [{ text: 'Plain', marks: [] }],
      [{ text: 'Plain ', marks: [] }, { text: 'bold', marks: ['strong'] as const }],
      [{ text: 'Rated 5*', marks: [] }],
      [{ text: 'C:\\Users\\creator', marks: [] }],
      [{ text: '🙂 and *stars*', marks: ['em'] as const }],
    ]) {
      expect(parseSpans(spansToText(spans))).toEqual(spans);
    }
  });

  it('normalises a lone backslash to the way this syntax writes one', () => {
    // The text direction is exact only for canonical text. A creator typing a
    // Windows path keeps it as they typed it — `\U` is not an escape — and the
    // stored span holds one backslash; the text shown on reload writes it as `\\`,
    // which is the same character.
    expect(parseSpans('C:\\Users')).toEqual([{ text: 'C:\\Users', marks: [] }]);
    expect(spansToText(parseSpans('C:\\Users'))).toBe('C:\\\\Users');
  });

  it('escapes an asterisk that came from the story rather than from the syntax', () => {
    // Without escaping, a creator whose product is called "5*" would reopen the
    // editor to find half their paragraph in italics.
    expect(spansToText([{ text: 'Rated 5*', marks: [] }])).toBe('Rated 5\\*');
    expect(parseSpans('Rated 5\\*')).toEqual([{ text: 'Rated 5*', marks: [] }]);
  });

  it('serialises strong outside emphasis, always', () => {
    // One canonical order, so the same spans always produce the same text and a
    // save that changed nothing is recognisable as such by the server.
    expect(spansToText([{ text: 'x', marks: ['em', 'strong'] }])).toBe('**\*x\***');
  });
});

describe('toggleMark', () => {
  it('wraps the selection and keeps hold of the same words', () => {
    const result = toggleMark('make this bold', 5, 9, 'strong');

    expect(result.text).toBe('make **this** bold');
    expect(result.applied).toBe(true);
    // The selection still covers "this" rather than the asterisks, so pressing
    // bold and then emphasis marks the same text twice.
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('this');
  });

  it('unwraps when the delimiters sit just outside the selection', () => {
    // Double-clicking a bold word selects the word, not the asterisks. A toggle
    // that could not see them would add a second pair.
    const result = toggleMark('make **this** bold', 7, 11, 'strong');

    expect(result.text).toBe('make this bold');
    expect(result.applied).toBe(false);
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('this');
  });

  it('unwraps when the delimiters are inside the selection', () => {
    const result = toggleMark('make **this** bold', 5, 13, 'strong');

    expect(result.text).toBe('make this bold');
    expect(result.applied).toBe(false);
  });

  it('normalises a reversed selection', () => {
    expect(toggleMark('abcd', 3, 1, 'em').text).toBe('a*bc*d');
  });

  it('reports whether the selection already carries the mark', () => {
    // What `aria-pressed` on the toolbar button reflects, so the state is
    // announced rather than only coloured.
    expect(isMarkActive('make **this** bold', 7, 11, 'strong')).toBe(true);
    // The case that broke the first implementation: `**` ends with `*`, so a
    // delimiter comparison answered "yes, emphasised" about a bold word — and
    // toggling emphasis off it turned the bold into italics.
    expect(isMarkActive('make **this** bold', 7, 11, 'em')).toBe(false);
    expect(isMarkActive('make this bold', 5, 9, 'strong')).toBe(false);
    // Both marks, nested, reported correctly for the same selection.
    expect(isMarkActive('***this***', 3, 7, 'strong')).toBe(true);
    expect(isMarkActive('***this***', 3, 7, 'em')).toBe(true);
  });

  it('is not active for a selection that is only partly marked', () => {
    // "Every" rather than "any". A selection spanning one bold word and one plain
    // one is not bold, and pressing the button should make all of it bold rather
    // than none of it.
    expect(isMarkActive('**bold** plain', 2, 14, 'strong')).toBe(false);
  });

  it('marks the whole selection when only part of it was marked', () => {
    const result = toggleMark('**bold** plain', 2, 14, 'strong');

    expect(result.applied).toBe(true);
    expect(parseSpans(result.text)).toEqual([{ text: 'bold plain', marks: ['strong'] }]);
  });

  it('leaves neighbouring marks alone when removing one', () => {
    // The regression the character model exists to prevent: removing emphasis from
    // a run that is also bold must not remove the bold.
    const result = toggleMark('***this***', 3, 7, 'em');

    expect(result.applied).toBe(false);
    expect(parseSpans(result.text)).toEqual([{ text: 'this', marks: ['strong'] }]);
  });

  it('opens an empty pair for a caret with nothing selected', () => {
    // "Make what I am about to write bold" is the only sensible reading, and it is
    // what every editor with this button does.
    const result = toggleMark('ab', 1, 1, 'strong');

    expect(result.text).toBe('a****b');
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe(3);
    expect(result.applied).toBe(true);
  });
});

describe('storyCharacterCount', () => {
  it('counts the prose §5.3 means', () => {
    expect(
      storyCharacterCount(
        document([
          { type: 'heading', level: 2, id: 'a', text: 'abcd' },
          { type: 'paragraph', spans: [{ text: 'ef', marks: [] }, { text: 'g', marks: ['strong'] }] },
          { type: 'quote', spans: [{ text: 'hi', marks: [] }] },
          { type: 'list', ordered: false, items: [[{ text: 'j', marks: [] }], [{ text: 'k', marks: [] }]] },
          { type: 'rule' },
        ]),
      ),
    ).toBe(11);
  });

  it('does not count an image description or an embed title', () => {
    // §5.3 asks for five hundred characters of STORY. A campaign could otherwise
    // reach the minimum with ten photographs and no writing at all — and the
    // server's count agrees, so a client that counted them would promise a
    // submission the checklist refuses.
    expect(
      storyCharacterCount(
        document([
          { type: 'image', url: 'https://a.example/b.jpg', width: 4, height: 3, alt: 'A long description' },
          { type: 'embed', provider: 'youtube', url: 'https://y.example/1', title: 'A long title' },
        ]),
      ),
    ).toBe(0);
  });

  it('counts an emoji once, as the storage does', () => {
    // `String.length` would say 2. Postgres counts code points and so does the
    // server, and a count that disagreed with either is a number on screen that
    // lies.
    expect(
      storyCharacterCount(document([{ type: 'paragraph', spans: [{ text: '🙂', marks: [] }] }])),
    ).toBe(1);
  });
});

describe('headingAnchors', () => {
  it('generates the navigation from the headings, in document order', () => {
    expect(
      headingAnchors(
        document([
          { type: 'paragraph', spans: [] },
          { type: 'heading', level: 2, id: 'the-plan', text: 'The plan' },
          { type: 'heading', level: 3, id: 'stage-one', text: 'Stage one' },
        ]),
      ),
    ).toEqual([
      { id: 'the-plan', text: 'The plan', level: 2 },
      { id: 'stage-one', text: 'Stage one', level: 3 },
    ]);
  });
});

describe('editing the block list', () => {
  const blocks: readonly StoryBlock[] = [
    { type: 'heading', level: 2, id: 'a', text: 'A' },
    { type: 'rule' },
    { type: 'quote', spans: [] },
  ];

  it('moves a block without losing one', () => {
    expect(moveBlock(blocks, 0, 2).map((block) => block.type)).toEqual(['rule', 'quote', 'heading']);
    expect(moveBlock(blocks, 2, 0).map((block) => block.type)).toEqual(['quote', 'heading', 'rule']);
    expect(moveBlock(blocks, 0, 2)).toHaveLength(blocks.length);
  });

  it('clamps a move past either end instead of throwing', () => {
    // "Move up" on the first block should do nothing visible, not put the editor
    // into a state the creator has to recover from.
    expect(moveBlock(blocks, 0, -1)).toBe(blocks);
    expect(moveBlock(blocks, 2, 9).map((block) => block.type)).toEqual(['heading', 'rule', 'quote']);
    expect(moveBlock(blocks, 5, 0)).toBe(blocks);
  });

  it('removes exactly one block', () => {
    expect(removeBlock(blocks, 1).map((block) => block.type)).toEqual(['heading', 'quote']);
  });

  it('gives a new heading an anchor nothing else is using', () => {
    // A heading added with an empty anchor would produce a document the server
    // refuses on the very first autosave.
    const first = newBlock('heading', []);
    const second = newBlock('heading', ['section']);

    expect(first).toEqual({ type: 'heading', level: 2, id: 'section', text: '' });
    expect(second).toMatchObject({ id: 'section-2' });
  });

  it('gives a new list one item to type into', () => {
    expect(newBlock('list')).toEqual({ type: 'list', ordered: false, items: [[]] });
  });

  it('gives a new image no dimensions, so it cannot be saved unmeasured', () => {
    expect(newBlock('image')).toEqual({ type: 'image', url: '', width: 0, height: 0, alt: '' });
  });
});

describe('blockProblem', () => {
  it('refuses an image with no description', () => {
    expect(
      blockProblem({ type: 'image', url: 'https://a.example/b.jpg', width: 4, height: 3, alt: '  ' }, STORY_COPY.vocabulary),
    ).toBe(STORY_COPY.vocabulary.problems.imageNeedsAlt);
  });

  it('refuses an unmeasured image', () => {
    expect(
      blockProblem({ type: 'image', url: 'https://a.example/b.jpg', width: 0, height: 0, alt: 'A' }, STORY_COPY.vocabulary),
    ).toContain('measured');
  });

  it('refuses a scheme that is not http or https', () => {
    // The story is rendered on a public page, so `javascript:` in an address is
    // executed by whichever renderer interpolates it. The server refuses it too;
    // this is so the creator is told at the field rather than by a 400.
    expect(
      blockProblem({ type: 'image', url: 'javascript:alert(1)', width: 4, height: 3, alt: 'A' }, STORY_COPY.vocabulary),
    ).toContain('http://');
  });

  it('refuses an embed with no title', () => {
    expect(
      blockProblem({ type: 'embed', provider: 'vimeo', url: 'https://v.example/1', title: '' }, STORY_COPY.vocabulary),
    ).toContain('screen reader');
  });

  it('accepts an empty paragraph', () => {
    // Only what is WRONG, not what is missing. A creator has just added it.
    expect(blockProblem({ type: 'paragraph', spans: [] }, STORY_COPY.vocabulary)).toBeNull();
  });

  it('refuses a heading with no text', () => {
    expect(blockProblem({ type: 'heading', level: 2, id: 'a', text: ' ' }, STORY_COPY.vocabulary)).toContain('text');
  });
});

describe('storyProblems', () => {
  it('reports two headings sharing an anchor, against the second one', () => {
    const problems = storyProblems(
      document([
        { type: 'heading', level: 2, id: 'the-plan', text: 'The plan' },
        { type: 'heading', level: 3, id: 'the-plan', text: 'Again' },
      ]),
      STORY_COPY.vocabulary,
    );

    expect(problems.get(0)).toBeUndefined();
    expect(problems.get(1)).toContain('anchor');
  });

  it('finds an empty document saveable', () => {
    // The state the editor is in when a creator opens the tab. Refusing it would
    // make the first autosave fail.
    expect(isSaveable(document([]), STORY_COPY.vocabulary)).toBe(true);
  });
});

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

describe('describeBlock', () => {
  it('names the kind, the position, and enough contents to tell blocks apart', () => {
    // "Move up" eleven times in a row is a screen reader reading out eleven
    // identical buttons. The position is what makes them distinguishable.
    expect(describeBlock({ type: 'heading', level: 2, id: 'a', text: 'The plan' }, 0, 3, STORY_COPY.vocabulary)).toBe(
      'Heading 1 of 3: The plan',
    );
    expect(describeBlock({ type: 'rule' }, 2, 3, STORY_COPY.vocabulary)).toBe('Divider 3 of 3');
    expect(
      describeBlock({ type: 'list', ordered: true, items: [[], []] }, 1, 3, STORY_COPY.vocabulary),
    ).toBe('Numbered list 2 of 3, 2 items');
    expect(
      describeBlock({ type: 'image', url: 'https://a/b', width: 4, height: 3, alt: '' }, 0, 1, STORY_COPY.vocabulary),
    ).toContain('no description yet');
  });

  it('says "empty" rather than nothing for a block with no contents', () => {
    expect(describeBlock({ type: 'paragraph', spans: [] }, 0, 1, STORY_COPY.vocabulary)).toBe('Paragraph 1 of 1: empty');
  });
});
