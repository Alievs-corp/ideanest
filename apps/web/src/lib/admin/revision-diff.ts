import { readStoryDocument, type StoryBlock, type StorySpans } from '@ideanest/campaign/story';

/**
 * The comparisons the edit review draws — issue #560, part of epic #557.
 *
 * <h2>Two sides, not one merged text</h2>
 *
 * A diff is shown as the live version beside the proposed one, each with only its own changes
 * marked: the left shows what goes, the right what arrives. A single merged run of struck and
 * inserted words reads as a third document nobody wrote, and a moderator is deciding whether
 * the second may replace the first.
 *
 * <h2>Why a longest-common-subsequence and not a library</h2>
 *
 * The inputs are a campaign's title, blurb, risks and story: a few thousand tokens at the very
 * most, and a quadratic table over that is a few million cells, built once on a moderator's
 * click. A dependency would be bundle weight on a route with a budget, for a function this
 * short.
 */

export type DiffKind = 'same' | 'removed' | 'added';

export interface DiffPart<T> {
  readonly kind: DiffKind;
  readonly value: T;
}

/** A pair this large is compared by its ends only; see {@link diffSequences}. */
const MAX_CELLS = 4_000_000;

/**
 * The shortest edit script from `before` to `after`, as one list in reading order.
 *
 * <p>Past {@link MAX_CELLS} the table is not built: the common prefix and suffix are kept and
 * everything between is shown as removed then added. That is a coarser answer and never a
 * wrong one, and it keeps a pathological story from freezing the tab of the person reviewing it.
 */
export function diffSequences<T>(
  before: readonly T[],
  after: readonly T[],
  equal: (a: T, b: T) => boolean = (a, b) => a === b,
): readonly DiffPart<T>[] {
  let start = 0;
  while (start < before.length && start < after.length && equal(before[start] as T, after[start] as T)) {
    start += 1;
  }

  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && equal(before[endBefore - 1] as T, after[endAfter - 1] as T)) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const head: DiffPart<T>[] = before.slice(0, start).map((value) => ({ kind: 'same', value }));
  const tail: DiffPart<T>[] = before.slice(endBefore).map((value) => ({ kind: 'same', value }));
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);

  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) {
    return [
      ...head,
      ...a.map((value): DiffPart<T> => ({ kind: 'removed', value })),
      ...b.map((value): DiffPart<T> => ({ kind: 'added', value })),
      ...tail,
    ];
  }

  // lengths[i][j] is the length of the longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] = equal(a[i] as T, b[j] as T)
        ? (lengths[(i + 1) * width + j + 1] as number) + 1
        : Math.max(lengths[(i + 1) * width + j] as number, lengths[i * width + j + 1] as number);
    }
  }

  const middle: DiffPart<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (equal(a[i] as T, b[j] as T)) {
      middle.push({ kind: 'same', value: a[i] as T });
      i += 1;
      j += 1;
    } else if ((lengths[(i + 1) * width + j] as number) >= (lengths[i * width + j + 1] as number)) {
      middle.push({ kind: 'removed', value: a[i] as T });
      i += 1;
    } else {
      middle.push({ kind: 'added', value: b[j] as T });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) middle.push({ kind: 'removed', value: a[i] as T });
  for (; j < b.length; j += 1) middle.push({ kind: 'added', value: b[j] as T });

  return [...head, ...middle, ...tail];
}

/** Words and the whitespace between them, so that joining the tokens gives the text back. */
export function tokenise(text: string): readonly string[] {
  return text.match(/\s+|[^\s]+/gu) ?? [];
}

export interface TextSides {
  readonly live: readonly DiffPart<string>[];
  readonly proposed: readonly DiffPart<string>[];
}

/**
 * A text compared word by word, split into what each side shows.
 *
 * <p>Adjacent tokens of one kind are joined, so a screen reader meets one changed span rather
 * than one per word.
 */
export function diffText(before: string, after: string): TextSides {
  const parts = diffSequences(tokenise(before), tokenise(after));

  return {
    live: coalesce(parts.filter((part) => part.kind !== 'added')),
    proposed: coalesce(parts.filter((part) => part.kind !== 'removed')),
  };
}

function coalesce(parts: readonly DiffPart<string>[]): readonly DiffPart<string>[] {
  const joined: DiffPart<string>[] = [];

  for (const part of parts) {
    const last = joined[joined.length - 1];
    if (last !== undefined && last.kind === part.kind) {
      joined[joined.length - 1] = { kind: last.kind, value: last.value + part.value };
    } else {
      joined.push(part);
    }
  }
  return joined;
}

/* -------------------------------------------------------------------------
 * The story
 * ---------------------------------------------------------------------- */

/**
 * One block of the story as a moderator reads it: what kind of block it is, its text, and the
 * pictures or clip it carries.
 *
 * `key` is what two blocks are compared by. It is the whole content, so a block counts as
 * unchanged only when nothing in it moved.
 */
export interface StoryLine {
  readonly key: string;
  readonly kind: StoryLineKind;
  readonly text: string;
  readonly image?: { readonly url: string; readonly width: number; readonly height: number; readonly alt: string };
  readonly video?: { readonly url: string; readonly posterUrl: string; readonly width: number; readonly height: number };
  /** An ordered list's items, one per line, when the block is a list. */
  readonly items?: readonly string[];
  /** Heading level, when the block is one. */
  readonly level?: number;
}

export type StoryLineKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'orderedList'
  | 'quote'
  | 'rule'
  | 'image'
  | 'embed'
  | 'section';

function spansText(spans: StorySpans): string {
  return spans.map((span) => span.text).join('');
}

function lineFor(block: StoryBlock): StoryLine {
  const key = JSON.stringify(block);

  switch (block.type) {
    case 'heading':
      return { key, kind: 'heading', text: block.text, level: block.level };
    case 'paragraph':
      return { key, kind: 'paragraph', text: spansText(block.spans) };
    case 'quote':
      return { key, kind: 'quote', text: spansText(block.spans) };
    case 'list':
      return {
        key,
        kind: block.ordered ? 'orderedList' : 'list',
        text: '',
        items: block.items.map(spansText),
      };
    case 'rule':
      return { key, kind: 'rule', text: '' };
    case 'image':
      return { key, kind: 'image', text: block.alt, image: block };
    case 'embed':
      return { key, kind: 'embed', text: block.title === '' ? block.url : `${block.title} (${block.url})` };
    case 'section':
      return {
        key,
        kind: 'section',
        text: [block.title, spansText(block.spans)].filter((part) => part !== '').join('\n'),
        ...(block.image === null ? {} : { image: block.image }),
        ...(block.video === null ? {} : { video: block.video }),
      };
  }
}

/**
 * A story as a list of blocks to compare, or `null` when it cannot be read.
 *
 * <p>An absent story is an empty list. A story the reader does not recognise — written by a
 * newer editor than this build — is `null`, and the screen says so rather than comparing a
 * document it would be guessing at.
 */
export function storyLines(story: unknown): readonly StoryLine[] | null {
  if (story === null || story === undefined) return [];

  const document = readStoryDocument(story);
  return document === null ? null : document.blocks.map(lineFor);
}

export interface StorySides {
  readonly live: readonly DiffPart<StoryLine>[];
  readonly proposed: readonly DiffPart<StoryLine>[];
}

export function diffStory(before: readonly StoryLine[], after: readonly StoryLine[]): StorySides {
  const parts = diffSequences(before, after, (a, b) => a.key === b.key);

  return {
    live: parts.filter((part) => part.kind !== 'added'),
    proposed: parts.filter((part) => part.kind !== 'removed'),
  };
}

/**
 * Runs of unchanged blocks longer than `keep * 2` folded to their ends, so a long story with
 * one edited paragraph shows the paragraph and a little around it.
 *
 * @returns each part, or the number of unchanged blocks folded away in its place
 */
export function foldUnchanged<T>(
  parts: readonly DiffPart<T>[],
  keep = 1,
): readonly (DiffPart<T> | { readonly folded: number })[] {
  const result: (DiffPart<T> | { readonly folded: number })[] = [];
  let index = 0;

  while (index < parts.length) {
    const part = parts[index] as DiffPart<T>;
    if (part.kind !== 'same') {
      result.push(part);
      index += 1;
      continue;
    }

    let end = index;
    while (end < parts.length && (parts[end] as DiffPart<T>).kind === 'same') end += 1;

    const run = parts.slice(index, end);
    const leading = index === 0 ? 0 : keep;
    const trailing = end === parts.length ? 0 : keep;

    if (run.length <= leading + trailing + 1) {
      result.push(...run);
    } else {
      result.push(...run.slice(0, leading));
      result.push({ folded: run.length - leading - trailing });
      result.push(...run.slice(run.length - trailing));
    }
    index = end;
  }

  return result;
}
