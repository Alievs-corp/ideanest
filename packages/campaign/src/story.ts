/**
 * The story document as a reader receives it: its shape, and the one function that decides
 * whether a value off the wire is one.
 *
 * <h2>Why the reader is shared and the editor is not</h2>
 *
 * The app's campaign screen rendered every real story as nothing (#140): it walked a TipTap
 * tree, and the service has only ever sent and enforced `{version: 1, blocks: [...]}`
 * (`StoryDocuments`). The cure is not a second, corrected walker but this one, so both
 * clients accept and refuse exactly the same documents — a story that renders in a browser
 * and not on a phone is the bug, whichever side is right.
 *
 * The editor's half — anchors, character counts, the inline mark syntax, block moves and the
 * problems it reports — stays in `apps/web/src/lib/projects/story.ts`, which re-exports
 * everything here. It depends on the web's editor copy, and there is no editor in the app.
 *
 * THE SHAPE IS THE CONTRACT, VERBATIM. #37's checklist counts characters in this document and
 * both campaign pages render it, so a field invented here is a field the service will refuse.
 */

/* -------------------------------------------------------------------------
 * The document — contract §5, exactly
 * ---------------------------------------------------------------------- */

/** `strong` and `em`. §4.6 calls it "emphasis"; the contract names the two marks. */
export type StoryMark = 'strong' | 'em';

export interface StorySpan {
  text: string;
  marks: readonly StoryMark[];
}

/** A run of marked text: a paragraph's contents, a quote's, or one list item's. */
export type StorySpans = readonly StorySpan[];

/**
 * Level 2 and level 3.
 *
 * Level 1 is the campaign's title, which the page owns — a story that could emit a
 * second `h1` would give the page two documents' worth of outline. Below level 3
 * the anchor navigation §4.6 asks for stops being navigation.
 */
export type HeadingLevel = 2 | 3;

export interface HeadingBlock {
  type: 'heading';
  level: HeadingLevel;
  /** The anchor. A slug, unique in the document, because it ends up in a URL. */
  id: string;
  text: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  spans: StorySpans;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: readonly StorySpans[];
}

export interface QuoteBlock {
  type: 'quote';
  spans: StorySpans;
}

export interface RuleBlock {
  type: 'rule';
}

export interface ImageBlock {
  type: 'image';
  url: string;
  width: number;
  height: number;
  /** Never optional and never empty. See `IMAGE_ALT_REQUIRED`. */
  alt: string;
}

export const EMBED_PROVIDERS = ['youtube', 'vimeo'] as const;

export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export interface EmbedBlock {
  type: 'embed';
  provider: EmbedProvider;
  url: string;
  /** The frame's accessible name. Without it a screen reader announces "frame". */
  title: string;
}

export type StoryBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | QuoteBlock
  | RuleBlock
  | ImageBlock
  | EmbedBlock;

export type StoryBlockType = StoryBlock['type'];

/** The envelope. `version` is the whole forward-compatibility story. */
export interface StoryDocument {
  version: number;
  blocks: readonly StoryBlock[];
}

export const STORY_SCHEMA_VERSION = 1;


/* -------------------------------------------------------------------------
 * Reading a document off the wire
 * ---------------------------------------------------------------------- */

/**
 * Narrows whatever the API returned into a document, or refuses it.
 *
 * WHY THIS EXISTS WHEN THE SERVER ALREADY VALIDATES. A campaign's story may have
 * been written by a newer deployment of the editor, against a schema this build
 * does not know. Casting would put an unrecognised block into the editor's state
 * and the next autosave would send back a document with that block silently
 * dropped or mangled — destroying writing in a request that looks like a save.
 *
 * So this returns `null` for anything it does not fully recognise, and the panel
 * refuses to edit and says why. Refusing to edit is recoverable; a save that
 * quietly rewrote the document is not.
 */
export function readStoryDocument(value: unknown): StoryDocument | null {
  if (!isRecord(value)) return null;
  if (value.version !== STORY_SCHEMA_VERSION) return null;
  if (!Array.isArray(value.blocks)) return null;

  const blocks: StoryBlock[] = [];
  for (const raw of value.blocks) {
    const block = readBlock(raw);
    if (block === null) return null;
    blocks.push(block);
  }
  return { version: STORY_SCHEMA_VERSION, blocks };
}

function readBlock(raw: unknown): StoryBlock | null {
  if (!isRecord(raw)) return null;

  switch (raw.type) {
    case 'heading': {
      const level = raw.level === 2 || raw.level === 3 ? raw.level : null;
      if (level === null || typeof raw.id !== 'string' || typeof raw.text !== 'string') return null;
      return { type: 'heading', level, id: raw.id, text: raw.text };
    }
    case 'paragraph': {
      const spans = readSpans(raw.spans);
      return spans === null ? null : { type: 'paragraph', spans };
    }
    case 'quote': {
      const spans = readSpans(raw.spans);
      return spans === null ? null : { type: 'quote', spans };
    }
    case 'list': {
      if (typeof raw.ordered !== 'boolean' || !Array.isArray(raw.items)) return null;
      const items: StorySpans[] = [];
      for (const item of raw.items) {
        const spans = readSpans(item);
        if (spans === null) return null;
        items.push(spans);
      }
      return { type: 'list', ordered: raw.ordered, items };
    }
    case 'rule':
      return { type: 'rule' };
    case 'image': {
      if (
        typeof raw.url !== 'string' ||
        typeof raw.alt !== 'string' ||
        !Number.isInteger(raw.width) ||
        !Number.isInteger(raw.height)
      ) {
        return null;
      }
      return {
        type: 'image',
        url: raw.url,
        width: raw.width as number,
        height: raw.height as number,
        alt: raw.alt,
      };
    }
    case 'embed': {
      if (typeof raw.url !== 'string' || typeof raw.title !== 'string') return null;
      if (!isEmbedProvider(raw.provider)) return null;
      return { type: 'embed', provider: raw.provider, url: raw.url, title: raw.title };
    }
    default:
      return null;
  }
}

function readSpans(raw: unknown): StorySpans | null {
  if (!Array.isArray(raw)) return null;

  const spans: StorySpan[] = [];
  for (const candidate of raw) {
    if (!isRecord(candidate)) return null;
    if (typeof candidate.text !== 'string' || !Array.isArray(candidate.marks)) return null;

    const marks: StoryMark[] = [];
    for (const mark of candidate.marks) {
      if (mark !== 'strong' && mark !== 'em') return null;
      marks.push(mark);
    }
    spans.push({ text: candidate.text, marks });
  }
  return spans;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEmbedProvider(value: unknown): value is EmbedProvider {
  return typeof value === 'string' && (EMBED_PROVIDERS as readonly string[]).includes(value);
}
