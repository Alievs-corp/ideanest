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
 * problems it reports — lives in `@ideanest/campaign-editor/story`, which re-exports
 * everything here. It depends on the editor's copy, which a reader of the page never needs.
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
  /** Never optional; empty when the creator has not written one, which renders as decorative (#543). */
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

/** A section's picture: an image block without its `type`, under the same rules. */
export interface SectionImage {
  url: string;
  width: number;
  height: number;
  /** As `ImageBlock.alt`: always present, possibly empty. */
  alt: string;
}

/**
 * A section's clip (#551): an upload the service transcoded, under the campaign video's rules.
 *
 * Every field but `mediaId` is the service's own measurement. It replaces them on every save
 * (`ProjectEditingService`), so a client can name only an upload of its own and never point a
 * story at somebody else's file or an arbitrary address.
 */
export interface SectionVideo {
  mediaId: string;
  /** An H.264 MP4 of at most 720p, playable by a plain `<video>` element. */
  url: string;
  /** The still shown before it is pressed. */
  posterUrl: string;
  width: number;
  height: number;
  durationMs: number;
}

/**
 * A titled part of the story: a title, an optional picture or clip under it, and its text.
 *
 * Rendered as its own `<section>` with an `h2`, and listed in the anchor navigation like a
 * level-2 heading. `id` is an anchor in the same namespace as the headings' — one set, unique
 * across both, because both end up as the fragment of the same URL.
 *
 * An image or a video, never both. A document written before #551 has no `video` key, which
 * reads as null.
 */
export interface SectionBlock {
  type: 'section';
  id: string;
  /** At most 200 code points, like a heading's text. */
  title: string;
  image: SectionImage | null;
  video: SectionVideo | null;
  spans: StorySpans;
}

export type StoryBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | QuoteBlock
  | RuleBlock
  | ImageBlock
  | EmbedBlock
  | SectionBlock;

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
    case 'section': {
      if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
      // An absent `image` reads as null: the service serialises `non_null`, so a null the
      // editor sent may come back as a missing key, and both mean "no picture".
      const image = raw.image == null ? null : readSectionImage(raw.image);
      if (raw.image != null && image === null) return null;
      const video = raw.video == null ? null : readSectionVideo(raw.video);
      if (raw.video != null && video === null) return null;
      if (image !== null && video !== null) return null;
      const spans = readSpans(raw.spans);
      if (spans === null) return null;
      return { type: 'section', id: raw.id, title: raw.title, image, video, spans };
    }
    default:
      return null;
  }
}

function readSectionImage(raw: unknown): SectionImage | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.url !== 'string' ||
    typeof raw.alt !== 'string' ||
    !Number.isInteger(raw.width) ||
    !Number.isInteger(raw.height)
  ) {
    return null;
  }
  return { url: raw.url, width: raw.width as number, height: raw.height as number, alt: raw.alt };
}

function readSectionVideo(raw: unknown): SectionVideo | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.mediaId !== 'string' ||
    typeof raw.url !== 'string' ||
    typeof raw.posterUrl !== 'string' ||
    !isPositiveInteger(raw.width) ||
    !isPositiveInteger(raw.height) ||
    !isPositiveInteger(raw.durationMs)
  ) {
    return null;
  }
  return {
    mediaId: raw.mediaId,
    url: raw.url,
    posterUrl: raw.posterUrl,
    width: raw.width,
    height: raw.height,
    durationMs: raw.durationMs,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/* -------------------------------------------------------------------------
 * The anchor navigation
 * ---------------------------------------------------------------------- */

/** One entry of the story's anchor navigation (§4.6). */
export interface StoryAnchor {
  id: string;
  text: string;
  level: HeadingLevel;
}

/**
 * The anchor navigation, in document order: every heading, and every section as a level-2
 * entry. Here rather than in the editor so the campaign page lists exactly what the editor's
 * anchor menu lists.
 */
export function storyAnchors(document: StoryDocument): readonly StoryAnchor[] {
  const anchors: StoryAnchor[] = [];
  for (const block of document.blocks) {
    if (block.type === 'heading') anchors.push({ id: block.id, text: block.text, level: block.level });
    else if (block.type === 'section') anchors.push({ id: block.id, text: block.title, level: 2 });
  }
  return anchors;
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
