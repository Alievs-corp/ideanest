/**
 * A campaign story, flattened to something a phone can render.
 *
 * <h2>What the story is</h2>
 *
 * `ProjectPageResponse.story` is the block document the campaign editor saves
 * (`apps/web/src/lib/projects/story.ts`, schema version 1):
 *
 * ```ts
 * { version: 1, blocks: [{ type: 'heading', text }, { type: 'paragraph', spans }, …] }
 * ```
 *
 * It used to be a TipTap document, and this file walked that shape. Once the
 * editor moved to blocks the walker found nothing to walk and every campaign
 * showed an empty story (#140). The walker is gone; nothing reads TipTap any more.
 *
 * <h2>Why it is still plain text</h2>
 *
 * This is the short-term fix #140 asks for, so the shipped screen is not blank.
 * The proper one belongs to the campaign-page work in the mobile parity epic
 * (#155): move the document's types and reader into a shared package, and render
 * every block natively — marks, lists, quotes, rules, images and embeds. Until
 * then each block with text becomes one paragraph, and the screen says that
 * formatting, images and video are on the web page.
 *
 * <h2>Versions</h2>
 *
 * A document whose `version` this build does not know answers nothing, which is
 * what the web's `readStoryDocument` does. Guessing at a newer shape would show
 * a reader half a story as if it were all of it.
 */

/** The schema version this reader understands. Matches the web's `STORY_SCHEMA_VERSION`. */
const STORY_SCHEMA_VERSION = 1;

/** Loose on purpose: this is data from the network, and nothing here may throw on it. */
type Loose = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A paragraph's, a quote's or a list item's spans, joined. Marks are dropped. */
function spansText(spans: unknown): string {
  if (!Array.isArray(spans)) return '';
  return spans
    .map((span) => (isRecord(span) && typeof span.text === 'string' ? span.text : ''))
    .join('');
}

/** The paragraphs one block contributes, before trimming. Blocks without text give none. */
function blockParagraphs(block: unknown): string[] {
  if (!isRecord(block)) return [];

  switch (block.type) {
    case 'heading':
      return typeof block.text === 'string' ? [block.text] : [];
    case 'paragraph':
    case 'quote':
      return [spansText(block.spans)];
    case 'list': {
      if (!Array.isArray(block.items)) return [];
      const ordered = block.ordered === true;
      // The marker is kept: without it a list reads as a run of short paragraphs.
      // Empty items are dropped before numbering, so an ordered list does not skip a number.
      return block.items
        .map((item) => spansText(item).trim())
        .filter((text) => text !== '')
        .map((text, index) => `${ordered ? `${index + 1}.` : '•'} ${text}`);
    }
    default:
      // `rule`, `image`, `embed`, and any type a newer editor adds: nothing to read.
      return [];
  }
}

/**
 * The story as paragraphs of plain text.
 *
 * Empty blocks are dropped rather than rendered as blank space — an empty
 * paragraph, or a list item with no text, is a scroll view that looks broken.
 *
 * @param story the `story` field, whatever it happens to be — this is called
 *     with data from the network and must not throw on a shape it did not expect
 */
export function storyParagraphs(story: unknown): string[] {
  if (!isRecord(story)) return [];
  if (story.version !== STORY_SCHEMA_VERSION) return [];
  if (!Array.isArray(story.blocks)) return [];

  return story.blocks
    .flatMap(blockParagraphs)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}
