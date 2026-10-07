/**
 * The story document: its shape, its rules, and the operations the editor
 * performs on it.
 *
 * <p>Kept out of the components for the reason `basics.ts` gives — these are the
 * rules of the epic contract §5 and `docs/architecture.md` §5.3, and rules that
 * live inside a form are rules nobody can test at the boundaries. Anchors,
 * character counts, block moves, and the inline mark syntax all have exact edges,
 * so they are exactly what is worth testing.
 *
 * THE SHAPE IS THE CONTRACT, VERBATIM. #37's checklist counts characters in this
 * document and the public project page renders it, so a field invented here is a
 * field two other issues will not know about. The server validates the same schema
 * (`StoryDocuments`), and where the two could disagree — what a heading anchor
 * folds to, how a character is counted — this file matches the server rather than
 * doing what is convenient in JavaScript.
 */

import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { pluralise } from '@ideanest/messages/plurals';
import type { StoryVocabularyCopy } from './copy';
import {
  STORY_SCHEMA_VERSION,
  type HeadingBlock,
  type HeadingLevel,
  type StoryBlock,
  type StoryBlockType,
  type StoryDocument,
  type StoryMark,
  type StorySpan,
  type StorySpans,
} from '@ideanest/campaign/story';

/* -------------------------------------------------------------------------
 * The document — contract §5, exactly
 *
 * The shape and its reader are `@ideanest/campaign/story` since #155, so the app renders the
 * documents this editor writes and refuses the ones it refuses. Re-exported under the same
 * names, not copied; the editor's operations below are this module's alone, and since #162
 * both clients' editors call them.
 * ---------------------------------------------------------------------- */

export {
  EMBED_PROVIDERS,
  STORY_SCHEMA_VERSION,
  isEmbedProvider,
  readStoryDocument,
  type EmbedBlock,
  type EmbedProvider,
  type HeadingBlock,
  type HeadingLevel,
  type ImageBlock,
  type ListBlock,
  type ParagraphBlock,
  type QuoteBlock,
  type RuleBlock,
  type StoryBlock,
  type StoryBlockType,
  type StoryDocument,
  type StoryMark,
  type StorySpan,
  type StorySpans,
} from '@ideanest/campaign/story';

/** §5.3: a story is at least five hundred characters by submission. */
export const STORY_MIN_CHARACTERS = 500;

/** §5.3: risks and challenges are required, and at least two hundred characters. */
export const RISKS_MIN_CHARACTERS = 200;

export function emptyStory(): StoryDocument {
  return { version: STORY_SCHEMA_VERSION, blocks: [] };
}

/* -------------------------------------------------------------------------
 * Anchors
 * ---------------------------------------------------------------------- */

/**
 * The Azerbaijani letters Unicode normalisation will not decompose.
 *
 * COPIED FROM `az.ideanest.shared.Slugs`, DELIBERATELY, and it has to stay in
 * step. `ə` has no decomposition, so a library that assumed Latin-1 would leave it
 * in the URL; `ı` lowercases differently under a Turkish locale. If the client and
 * the server folded a heading differently, the anchor the editor generated would be
 * the anchor the server refused — which is a save that fails for a reason a creator
 * cannot see.
 */
const FOLDINGS: readonly (readonly [string, string])[] = [
  ['ə', 'e'],
  ['Ə', 'e'],
  ['ı', 'i'],
  ['İ', 'i'],
  ['ğ', 'g'],
  ['Ğ', 'g'],
  ['ş', 's'],
  ['Ş', 's'],
  ['ç', 'c'],
  ['Ç', 'c'],
  ['ö', 'o'],
  ['Ö', 'o'],
  ['ü', 'u'],
  ['Ü', 'u'],
];

/** The slug for a heading, or `''` when nothing survives folding. */
export function slugifyHeading(raw: string): string {
  let folded = raw;
  for (const [from, to] of FOLDINGS) folded = folded.split(from).join(to);

  // Decomposes the accented characters that do decompose — é to e plus a combining
  // acute — so that stripping the marks leaves the letter.
  folded = folded
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

  return folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * An anchor for this heading that nothing else in the document is using.
 *
 * Numbered rather than randomised: the anchor is the fragment of a URL a backer
 * may share, and `#the-plan-2` is a readable address in a way that
 * `#the-plan-a7f3` is not. The fallback for a heading that folds to nothing —
 * a title written entirely in a script the folding does not transliterate — is
 * `section`, mirroring the server's `project` fallback for a campaign slug.
 */
export function uniqueHeadingId(text: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugifyHeading(text) || 'section';

  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  // Unreachable in practice: a document with a thousand headings of the same name
  // is not a story. Falling back to something unique is still better than
  // returning a duplicate the server will refuse.
  return `${base}-${used.size + 1}`;
}

export interface StoryAnchor {
  id: string;
  text: string;
  level: HeadingLevel;
}

/** The anchor navigation of §4.6, generated from the headings and nothing else. */
export function headingAnchors(document: StoryDocument): readonly StoryAnchor[] {
  return document.blocks
    .filter((block): block is HeadingBlock => block.type === 'heading')
    .map((heading) => ({ id: heading.id, text: heading.text, level: heading.level }));
}

/* -------------------------------------------------------------------------
 * Counting
 * ---------------------------------------------------------------------- */

/**
 * Characters, counted the way the storage and the server count them.
 *
 * Code points rather than UTF-16 code units, so an emoji counts once. See
 * `basics.ts`: a counter that says 501 while Postgres and `StoryDocuments` say 500
 * is a counter that lies, and this is the number §5.3's minimum is measured
 * against.
 */
export function characterCount(value: string): number {
  return Array.from(value).length;
}

/**
 * How much prose the story holds — the number §5.3's five hundred applies to.
 *
 * Heading text, paragraph and quote spans, and list items. NOT an image's
 * description or an embed's title: those describe media rather than being the
 * story, and a campaign could otherwise reach the minimum with ten photographs and
 * no writing at all. `StoryDocuments.characterCount` counts the same things, and
 * the two must agree or the checklist and the editor will disagree about whether a
 * campaign can be submitted.
 */
export function storyCharacterCount(document: StoryDocument): number {
  let total = 0;
  for (const block of document.blocks) {
    switch (block.type) {
      case 'heading':
        total += characterCount(block.text);
        break;
      case 'paragraph':
      case 'quote':
        total += spanCharacters(block.spans);
        break;
      case 'list':
        for (const item of block.items) total += spanCharacters(item);
        break;
      default:
        break;
    }
  }
  return total;
}

function spanCharacters(spans: StorySpans): number {
  let total = 0;
  for (const span of spans) total += characterCount(span.text);
  return total;
}

/* -------------------------------------------------------------------------
 * The inline mark syntax
 * ---------------------------------------------------------------------- */

/**
 * Text with marks in it, as a creator types it, and the spans it becomes.
 *
 * `**strong**` and `*em*`, with `\*` for a literal asterisk. This pair of
 * functions is what lets a plain `<textarea>` produce the contract's span model,
 * and that is the whole reason the editor needs no `contentEditable` surface: the
 * browser's own text editing — caret, selection, undo, the screen-reader echo,
 * dictation, an IME — all keep working because the control is a real one.
 *
 * WHY A MARKUP CONVENTION RATHER THAN A RICH-TEXT SURFACE. The two honest options
 * were a `contentEditable` region with a hand-built selection and announcement
 * model, or a real control with a syntax. The first cannot be verified by the tests
 * this repository runs — jsdom has no caret and no selection — and an unverifiable
 * accessible rich-text surface is in practice an inaccessible one. The syntax is
 * two characters most people already know from every messaging application, the
 * toolbar applies it to the selection so nobody has to type it, and everything a
 * text field does for free continues to work.
 *
 * A TOGGLE THAT IS NEVER CLOSED MARKS THE REST OF THE TEXT. That is what somebody
 * mid-keystroke means, and it is what the preview shows them.
 */

/**
 * One visible character, the marks that apply to it, and where it sits in the text.
 *
 * EVERYTHING IN THIS SECTION GOES THROUGH THIS, and that is the second attempt.
 * The first matched delimiters against the string either side of the selection,
 * which cannot tell `**` from the second `*` of a `*` — so asking "is this
 * emphasised" about a **bold** word answered yes, and toggling emphasis off it
 * turned the bold into italics. Marks are a property of a character, so the
 * functions that ask about marks work on characters.
 *
 * Walked in UTF-16 units rather than code points because `selectionStart` on a
 * textarea is a UTF-16 offset. A delimiter is never part of a surrogate pair, so
 * the two agree about where the marks change.
 */
interface MarkedCharacter {
  /** The character as it appears to a reader, with any escape already resolved. */
  character: string;
  marks: readonly StoryMark[];
  /** Where it starts in the source text. */
  at: number;
  /** How much source text it occupies: two for an escaped `\*`, otherwise one. */
  width: number;
}

function marksOf(strong: boolean, em: boolean): readonly StoryMark[] {
  const marks: StoryMark[] = [];
  if (strong) marks.push('strong');
  if (em) marks.push('em');
  return marks;
}

/** The text as a run of marked characters, with the delimiters consumed. */
function walkMarks(text: string): readonly MarkedCharacter[] {
  const characters: MarkedCharacter[] = [];
  let strong = false;
  let em = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index] as string;

    if (character === '\\') {
      const next = text[index + 1];
      // Only the two characters the syntax uses are escapable. A backslash before
      // anything else is a backslash, because a creator writing a Windows path
      // should not have to know this function exists.
      if (next === '*' || next === '\\') {
        characters.push({ character: next, marks: marksOf(strong, em), at: index, width: 2 });
        index++;
        continue;
      }
      characters.push({ character, marks: marksOf(strong, em), at: index, width: 1 });
      continue;
    }

    if (character === '*') {
      if (text[index + 1] === '*') {
        strong = !strong;
        index++;
        continue;
      }
      em = !em;
      continue;
    }

    characters.push({ character, marks: marksOf(strong, em), at: index, width: 1 });
  }

  return characters;
}

/** The spans for the text a creator has typed. */
export function parseSpans(text: string): StorySpans {
  return groupIntoSpans(walkMarks(text));
}

/**
 * Joins neighbours that carry the same marks.
 *
 * The canonical form, and it matters more than it looks: without it `**a****b**`
 * is two identically marked spans, and the document would count as changed on the
 * next save without anybody having typed anything — writing a version history entry
 * describing an edit that did not happen.
 */
function groupIntoSpans(characters: readonly MarkedCharacter[]): StorySpans {
  const spans: StorySpan[] = [];

  for (const entry of characters) {
    const last = spans[spans.length - 1];
    if (last !== undefined && sameMarks(last.marks, entry.marks)) {
      spans[spans.length - 1] = { text: last.text + entry.character, marks: last.marks };
      continue;
    }
    spans.push({ text: entry.character, marks: entry.marks });
  }

  return spans;
}

/**
 * The text a creator sees for a run of spans. The inverse of {@link parseSpans}.
 *
 * `parseSpans(spansToText(spans))` is exactly `spans` for any canonical spans, and
 * that is the invariant the editor depends on — the document is the truth and the
 * textarea is a view of it. The other direction holds only for text that is already
 * canonical: a lone backslash normalises to `\\` on the way out, which is the same
 * character written the way this syntax writes it.
 */
export function spansToText(spans: StorySpans): string {
  let text = '';
  for (const span of spans) {
    const escaped = span.text.replace(/[\\*]/g, (match) => `\\${match}`);
    const strong = span.marks.includes('strong');
    const em = span.marks.includes('em');
    // Strong outside emphasis, consistently, so that the same spans always
    // serialise to the same text and a save that changed nothing is recognisable as
    // such by the server.
    text += `${strong ? '**' : ''}${em ? '*' : ''}${escaped}${em ? '*' : ''}${strong ? '**' : ''}`;
  }
  return text;
}

function sameMarks(left: readonly StoryMark[], right: readonly StoryMark[]): boolean {
  return left.length === right.length && left.every((mark) => right.includes(mark));
}

/**
 * How many visible characters precede this offset in the source text.
 *
 * The bridge between a selection, which is measured in source text, and the marks,
 * which are a property of visible characters.
 */
function visibleIndexAt(characters: readonly MarkedCharacter[], offset: number): number {
  let index = 0;
  while (index < characters.length && (characters[index] as MarkedCharacter).at < offset) index++;
  return index;
}

/**
 * Whether every character the creator has selected carries this mark.
 *
 * Drives `aria-pressed` on the toolbar, which is how the formatting state is
 * ANNOUNCED rather than only coloured (docs/ui-kit.md §9.2). "Every" rather than
 * "any": a selection spanning one bold word and one plain one is not bold, and
 * pressing the button should make all of it bold rather than none.
 *
 * For a caret rather than a range, the answer is the state of the character to its
 * left — which is the mark the next keystroke would inherit, and therefore what the
 * button is about to do.
 */
export function isMarkActive(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  mark: StoryMark,
): boolean {
  const characters = walkMarks(text);
  const from = visibleIndexAt(characters, Math.min(selectionStart, selectionEnd));
  const to = visibleIndexAt(characters, Math.max(selectionStart, selectionEnd));

  if (to <= from) {
    const before = characters[from - 1];
    return before !== undefined && before.marks.includes(mark);
  }
  return characters.slice(from, to).every((entry) => entry.marks.includes(mark));
}

export interface MarkToggle {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  /** Whether the mark is now on. What the toolbar announces and reflects. */
  applied: boolean;
}

/**
 * Applies or removes a mark over the selection, and says where the selection now is.
 *
 * Returned rather than applied, so the caller owns the control's value — a React
 * controlled component cannot have its value written from underneath it, and the
 * caret has to be restored after the re-render either way.
 *
 * The selection is preserved over the same CHARACTERS, not the same offsets, so
 * pressing bold and then emphasis marks the same words twice rather than the second
 * press landing on the delimiters the first one inserted.
 */
export function toggleMark(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  mark: StoryMark,
): MarkToggle {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const delimiter = mark === 'strong' ? '**' : '*';

  const characters = walkMarks(text);
  const from = visibleIndexAt(characters, start);
  const to = visibleIndexAt(characters, end);

  if (to <= from) {
    /*
     * A caret with nothing selected. An empty pair with the caret between them, so
     * that what is typed next is marked — the behaviour of every editor that has
     * this button, and the only sensible reading of "make what I am about to write
     * bold". Rewriting the whole text through the span model would produce no change
     * at all here, because there are no characters to mark.
     */
    return {
      text: text.slice(0, start) + delimiter + delimiter + text.slice(start),
      selectionStart: start + delimiter.length,
      selectionEnd: start + delimiter.length,
      applied: true,
    };
  }

  const selected = characters.slice(from, to);
  const applied = !selected.every((entry) => entry.marks.includes(mark));

  const rewritten = characters.map((entry, index) => {
    if (index < from || index >= to) return entry;
    return {
      ...entry,
      marks: applied
        ? [...entry.marks, ...(entry.marks.includes(mark) ? [] : [mark])]
        : entry.marks.filter((existing) => existing !== mark),
    };
  });

  const nextText = spansToText(groupIntoSpans(rewritten));

  // Where those same characters ended up. Read back from the rewritten text rather
  // than computed by counting delimiters, because the delimiters that moved depend
  // on which neighbours merged.
  const nextCharacters = walkMarks(nextText);
  const firstMoved = nextCharacters[from];
  const lastMoved = nextCharacters[to - 1];

  return {
    text: nextText,
    selectionStart: firstMoved?.at ?? nextText.length,
    selectionEnd: lastMoved === undefined ? nextText.length : lastMoved.at + lastMoved.width,
    applied,
  };
}

/* -------------------------------------------------------------------------
 * Editing the block list
 * ---------------------------------------------------------------------- */

/** A new block of this kind, in the state it is added in. */
export function newBlock(type: StoryBlockType, existingIds: Iterable<string> = []): StoryBlock {
  switch (type) {
    case 'heading':
      // The anchor is allocated now, from the placeholder text, and re-derived when
      // the heading is renamed. Leaving it empty would produce a document the
      // server refuses on the very first autosave.
      return { type: 'heading', level: 2, id: uniqueHeadingId('Section', existingIds), text: '' };
    case 'paragraph':
      return { type: 'paragraph', spans: [] };
    case 'quote':
      return { type: 'quote', spans: [] };
    case 'list':
      // One empty item, so the control the creator types into exists. A list with
      // no items is valid but presents nothing to edit.
      return { type: 'list', ordered: false, items: [[]] };
    case 'rule':
      return { type: 'rule' };
    case 'image':
      // Zero dimensions are invalid on purpose: the block is not saveable until the
      // image has been measured, which is what stops a URL being stored without the
      // size the checklist needs. See `IMAGE_ALT_REQUIRED` and `blockProblem`.
      return { type: 'image', url: '', width: 0, height: 0, alt: '' };
    case 'embed':
      return { type: 'embed', provider: 'youtube', url: '', title: '' };
  }
}

export function replaceBlock(
  blocks: readonly StoryBlock[],
  index: number,
  block: StoryBlock,
): readonly StoryBlock[] {
  return blocks.map((existing, at) => (at === index ? block : existing));
}

export function insertBlock(
  blocks: readonly StoryBlock[],
  index: number,
  block: StoryBlock,
): readonly StoryBlock[] {
  const next = [...blocks];
  next.splice(index, 0, block);
  return next;
}

export function removeBlock(blocks: readonly StoryBlock[], index: number): readonly StoryBlock[] {
  return blocks.filter((_, at) => at !== index);
}

/**
 * Moves a block, clamping rather than throwing at the ends.
 *
 * Clamping because the buttons that call this are disabled at the ends and a
 * keyboard shortcut is not: "move up" on the first block should do nothing
 * visible, not put the editor into a state the creator has to recover from.
 */
export function moveBlock(
  blocks: readonly StoryBlock[],
  from: number,
  to: number,
): readonly StoryBlock[] {
  if (from < 0 || from >= blocks.length) return blocks;
  const target = Math.max(0, Math.min(blocks.length - 1, to));
  if (target === from) return blocks;

  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return blocks;
  next.splice(target, 0, moved);
  return next;
}

/* -------------------------------------------------------------------------
 * What is wrong with a block
 * ---------------------------------------------------------------------- */



/**
 * The client's copy of the server's rules, for immediate feedback.
 *
 * NOT the authority. `StoryDocuments` is, and this exists so a creator learns
 * about a missing image description while they are looking at the image rather
 * than from a failed autosave a second later. Where the two could disagree this
 * one is deliberately the same list of rules in the same order.
 *
 * ONLY WHAT IS WRONG, NOT WHAT IS MISSING — the distinction `basics.ts` draws.
 * An empty paragraph is not an error; a creator has just added it. An image with
 * no description is an error, because it is a picture that has been chosen.
 */
export function blockProblem(block: StoryBlock, copy: StoryVocabularyCopy): string | null {
  switch (block.type) {
    case 'heading': {
      if (block.text.trim() === '') return copy.problems.headingNeedsText;
      if (slugifyHeading(block.id) !== block.id || block.id === '') {
        return copy.problems.anchorUnusable;
      }
      return null;
    }
    case 'image': {
      if (block.url.trim() === '') return copy.problems.imageNeedsUrl;
      if (!isWebUrl(block.url)) return copy.problems.urlScheme;
      if (block.width <= 0 || block.height <= 0) {
        return copy.problems.imageNotMeasured;
      }
      if (block.alt.trim() === '') return copy.problems.imageNeedsAlt;
      return null;
    }
    case 'embed': {
      if (block.url.trim() === '') return copy.problems.embedNeedsUrl;
      if (!isWebUrl(block.url)) return copy.problems.urlScheme;
      if (block.title.trim() === '') {
        return copy.problems.embedNeedsTitle;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * `http` or `https`, and nothing else.
 *
 * The same allow-list the server applies, and for the same reason: the story is
 * rendered on a public page, and `javascript:` in an image address is executed by
 * whichever renderer interpolates it. Checked here so the creator is told at the
 * field rather than by a 400.
 */
export function isWebUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/** Every problem in the document, with the block each belongs to. */
export function storyProblems(
  document: StoryDocument,
  copy: StoryVocabularyCopy,
): ReadonlyMap<number, string> {
  const problems = new Map<number, string>();
  const anchors = new Set<string>();

  document.blocks.forEach((block, index) => {
    const problem = blockProblem(block, copy);
    if (problem !== null) {
      problems.set(index, problem);
      return;
    }
    if (block.type === 'heading') {
      // Duplicated anchors are the failure that looks like it works: every link in
      // the navigation resolves and half of them scroll to the wrong heading.
      if (anchors.has(block.id)) {
        problems.set(index, copy.problems.anchorDuplicate);
        return;
      }
      anchors.add(block.id);
    }
  });

  return problems;
}

/** Whether the document is one the server will accept. */
export function isSaveable(document: StoryDocument, copy: StoryVocabularyCopy): boolean {
  return storyProblems(document, copy).size === 0;
}

/**
 * The block a refused save names, when it names one.
 *
 * `STORY_DOCUMENT_INVALID` carries `meta.path` — `blocks[7].alt` — and the index is pulled out
 * so the server's message lands on the block it is about rather than in a banner alone: a story
 * is hundreds of blocks long, and "the story is invalid" is not something a creator can act on.
 * Any other refusal, or a path that is not about a block, names none. Shared by both clients'
 * story tabs (#162), so the two read the server's path the same way.
 */
export function rejectedBlockIndex(
  failure: { readonly code: string | null; readonly meta?: Readonly<Record<string, unknown>> | null } | null,
): number | null {
  if (failure?.code !== 'STORY_DOCUMENT_INVALID') return null;

  const path = failure.meta?.path;
  if (typeof path !== 'string') return null;

  const match = /^blocks\[(\d+)\]/.exec(path);
  if (match === null) return null;

  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

/**
 * A heading with new text, and the anchor that goes with it.
 *
 * The anchor follows the text, but only while it is still the anchor that text would produce.
 * Once a creator has an anchor somebody may have linked to — one they wrote themselves, or one
 * left over from an earlier wording that a link may already point at — renaming the heading must
 * not silently break the link, so a heading whose anchor is not its text's own keeps it.
 * Regenerating unconditionally would be the same mistake as recomputing a campaign's slug when
 * its title is corrected. A heading that has never had text takes its anchor from the first
 * words typed, so `newBlock`'s placeholder anchor does not outlive the placeholder.
 *
 * `taken` is every other heading's anchor, so the regenerated one stays unique.
 */
export function renameHeading(
  block: HeadingBlock,
  text: string,
  taken: Iterable<string>,
): HeadingBlock {
  const generated = slugifyHeading(block.text);
  const keepsItsAnchor = block.id !== generated && block.text !== '';
  return { ...block, text, id: keepsItsAnchor ? block.id : uniqueHeadingId(text, taken) };
}

/* -------------------------------------------------------------------------
 * Naming a block
 * ---------------------------------------------------------------------- */



/**
 * How a block is announced: what kind it is, where it is, and enough of its
 * contents to tell it from its neighbours.
 *
 * Every add, move, and remove control in the editor carries one of these. "Move
 * up" repeated eleven times in a row is a screen reader reading out eleven
 * identical buttons, and the position is the only thing that makes them
 * distinguishable — so the position is in the name rather than only in the
 * markup.
 */
export function describeBlock(
  block: StoryBlock,
  index: number,
  total: number,
  copy: StoryVocabularyCopy,
): string {
  const position = fillPlaceholders(copy.describe.position, {
    index: String(index + 1),
    total: String(total),
  });

  switch (block.type) {
    case 'heading':
      return fillPlaceholders(copy.describe.heading, {
        position,
        text: block.text.trim() === '' ? copy.describe.headingEmpty : block.text,
      });
    case 'paragraph':
    case 'quote':
      return fillPlaceholders(copy.describe.withPreview, {
        label: copy.blockLabel[block.type],
        position,
        preview: preview(spansToText(block.spans)),
      });
    case 'list':
      return fillPlaceholders(
        pluralise(copy.locale, copy.describe.list, block.items.length),
        { style: block.ordered ? copy.describe.numbered : copy.describe.bulleted, position },
      );
    case 'rule':
      return fillPlaceholders(copy.describe.rule, { position });
    case 'image':
      return fillPlaceholders(copy.describe.image, {
        position,
        alt: block.alt.trim() === '' ? copy.describe.imageNoAlt : block.alt,
      });
    case 'embed':
      return fillPlaceholders(copy.describe.embed, {
        provider: block.provider,
        position,
        title: block.title.trim() === '' ? copy.describe.embedNoTitle : block.title,
      });
  }
}

function preview(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  const characters = Array.from(trimmed);
  return characters.length <= 40 ? trimmed : `${characters.slice(0, 40).join('')}…`;
}
