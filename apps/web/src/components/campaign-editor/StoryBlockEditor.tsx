'use client';

import type {
  StoryBlocksCopy,
  StoryToolbarCopy,
  StoryVocabularyCopy,
} from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralise } from '../../lib/i18n/plurals';
import { useId, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Heading2,
  Image as ImageIcon,
  List,
  Minus,
  Quote,
  Text,
  Trash2,
  Video,
} from 'lucide-react';
import { InlineAlert, Media, Pill, Select, TextInput, cn } from '@ideanest/ui';
import { intrinsicSize } from '../../lib/images/source';
import { describeSize, measureImage } from '../../lib/projects/coverImage';
import {
  EMBED_PROVIDERS,
  blockProblem,
  describeBlock,
  insertBlock,
  isEmbedProvider,
  moveBlock,
  newBlock,
  parseSpans,
  removeBlock,
  replaceBlock,
  slugifyHeading,
  spansToText,
  uniqueHeadingId,
  type StoryBlock,
  type StoryBlockType,
  type StoryDocument,
} from '../../lib/projects/story';
import { StoryTextField } from './StoryTextField';

/**
 * The story, as a list of blocks made of real form controls.
 *
 * <h3>WHY THIS SHAPE AND NOT A RICH-TEXT SURFACE</h3>
 *
 * The document model exists so that a story is structured data rather than HTML,
 * and a `contentEditable` that emits HTML which is then parsed back into blocks is
 * the exact thing it exists to avoid — every round trip is a chance to lose a block,
 * and the parser is where the cross-site-scripting bugs live.
 *
 * The alternative to `contentEditable` for rich text is a hand-built editing surface
 * with its own caret, selection, and announcement model. That cannot be verified by
 * the tests this repository runs: jsdom has no caret and no selection, so every
 * assertion about "the creator selects a word and presses bold" would be an
 * assertion about a fiction. An accessible rich-text surface that cannot be tested
 * is, in practice, an inaccessible one — it works on the day it is written.
 *
 * So: one control per block, with add, remove, and move. Each block is an ordinary
 * `<li>` containing ordinary fields, which means the browser and the screen reader
 * already know how to work it, every control has a real accessible name, an error
 * sits beside the block it is about, and each of those is a test that means
 * something. Inline emphasis is a two-character syntax applied by a toolbar
 * (`StoryMarkToolbar`), so bold and italics do not require the surface this
 * component declines to build.
 *
 * <h3>KEYBOARD</h3>
 *
 * Tab reaches everything, in document order, because everything is a real control.
 * Nothing here captures Tab, Enter, or the arrow keys — a story with a hundred
 * blocks is navigable with the keys a creator already uses on every other page.
 * Ctrl+B and Ctrl+I apply the marks inside a text field, which the browser does
 * nothing with in a textarea.
 *
 * <h3>MOTION</h3>
 *
 * None. `docs/motion-system.md` §5 gives the campaign editor "none — autosave
 * indicator only". A block that animated into place would move the field under a
 * creator who has just pressed "move down" and is about to press it again.
 */

/**
 * The kinds a block can be, in the order the add menu offers them.
 *
 * NO `hint` ANY MORE — issue #324. What each kind is is catalogue copy, read as
 * `copy.hints[type]`, for the reason `tabs.ts` gives about its own sections.
 */
const ADDABLE: readonly { type: StoryBlockType; icon: typeof Text }[] = [
  { type: 'paragraph', icon: Text },
  { type: 'heading', icon: Heading2 },
  { type: 'list', icon: List },
  { type: 'quote', icon: Quote },
  { type: 'image', icon: ImageIcon },
  { type: 'embed', icon: Video },
  { type: 'rule', icon: Minus },
];

export interface StoryBlockEditorProps {
  /** The editor's own words. */
  copy: StoryBlocksCopy;
  /** How a block is named and what is wrong with it — shared with `lib/projects/story.ts`. */
  vocabulary: StoryVocabularyCopy;
  /** The two mark controls' words. */
  toolbar: StoryToolbarCopy;
  document: StoryDocument;
  disabled?: boolean;
  /** Per-block messages from the server, keyed by the index the path named. */
  serverProblems?: ReadonlyMap<number, string>;
  onChange: (document: StoryDocument) => void;
  /** Called when a field loses focus, so the tab can flush its autosave. */
  onFlush?: () => void;
}

export function StoryBlockEditor({
  copy,
  vocabulary,
  toolbar,
  document,
  disabled = false,
  serverProblems,
  onChange,
  onFlush,
}: StoryBlockEditorProps) {
  const blocks = document.blocks;
  const total = blocks.length;

  /**
   * What just happened, for a screen reader.
   *
   * Adding, moving, and removing a block all change a list the creator cannot see,
   * and the button they pressed does not describe the outcome — "Move down" is the
   * action, "Paragraph is now 4 of 7" is the result. Without this a screen-reader
   * user presses the button and hears nothing at all.
   */
  const [announcement, setAnnouncement] = useState('');

  function put(next: readonly StoryBlock[], said: string): void {
    onChange({ version: document.version, blocks: next });
    setAnnouncement(said);
  }

  function add(type: StoryBlockType): void {
    const headings = blocks.filter((block) => block.type === 'heading').map((block) => block.id);
    const block = newBlock(type, headings);
    // Appended rather than inserted at a focused position: there is no "current
    // block" when the focus is on the add row, and guessing would put a paragraph
    // somewhere the creator did not ask for.
    put(
      insertBlock(blocks, total, block),
      fillPlaceholders(copy.addedAnnouncement, {
        label: vocabulary.blockLabel[type],
        position: String(total + 1),
        total: String(total + 1),
      }),
    );
  }

  function move(index: number, by: -1 | 1): void {
    const block = blocks[index];
    if (block === undefined) return;
    put(
      moveBlock(blocks, index, index + by),
      fillPlaceholders(copy.movedAnnouncement, {
        label: vocabulary.blockLabel[block.type],
        position: String(index + by + 1),
        total: String(total),
      }),
    );
  }

  function remove(index: number): void {
    const block = blocks[index];
    if (block === undefined) return;
    put(
      removeBlock(blocks, index),
      fillPlaceholders(pluralise(vocabulary.locale, copy.removedAnnouncement, total - 1), {
        label: vocabulary.blockLabel[block.type],
      }),
    );
  }

  function update(index: number, block: StoryBlock): void {
    onChange({ version: document.version, blocks: replaceBlock(blocks, index, block) });
  }

  return (
    <section aria-labelledby="story-blocks-heading" className="flex flex-col gap-4">
      <h2 id="story-blocks-heading" className="text-lg font-semibold text-white">
        {copy.heading}
      </h2>

      {/*
        An ordered list, because the order is the meaning: a screen reader announces
        "list, 7 items" and then which item it is on, which is the position
        information every move control depends on.
      */}
      {total === 0 ? (
        <p className="rounded-lg border border-white/8 bg-surface-2 p-5 text-[15px] text-white/64">
          {copy.empty}
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {blocks.map((block, index) => (
            <BlockRow
            copy={copy}
            vocabulary={vocabulary}
            toolbar={toolbar}
              // The index, deliberately, and it is the one place index-as-key is
              // right: a block has no identity of its own in the contract's model,
              // and keying by content would remount the field a creator is typing
              // into on every keystroke.
              key={index}
              block={block}
              index={index}
              total={total}
              disabled={disabled}
              serverProblem={serverProblems?.get(index)}
              onMoveUp={index === 0 ? null : () => move(index, -1)}
              onMoveDown={index === total - 1 ? null : () => move(index, 1)}
              onRemove={() => remove(index)}
              onChange={(next) => update(index, next)}
              onFlush={onFlush}
              headingIdsInUse={blocks
                .filter((other, at) => other.type === 'heading' && at !== index)
                .map((other) => (other.type === 'heading' ? other.id : ''))}
            />
          ))}
        </ol>
      )}

      <div className="rounded-lg border border-white/8 bg-surface-2 p-4">
        <h3 className="text-[13px] font-medium tracking-[0.06em] text-white/40 uppercase">
          {copy.add}
        </h3>
        {/*
          A row of named buttons rather than a menu. Seven controls do not need to be
          hidden behind an eighth, and a menu would owe the arrow keys and a focus
          contract for no gain.
        */}
        <div className="mt-3 flex flex-wrap gap-2">
          {ADDABLE.map(({ type, icon: Icon }) => (
            <Pill
              key={type}
              variant="ghost"
              size="sm"
              disabled={disabled}
              iconLeft={<Icon aria-hidden="true" className="size-4" />}
              // The name is the action, not the noun: "Paragraph" alone would be
              // announced as though it were a heading in the page.
              aria-label={fillPlaceholders(copy.addOne, { kind: vocabulary.blockLabel[type].toLowerCase(), hint: copy.hints[type] })}
              onClick={() => add(type)}
            >
              {vocabulary.blockLabel[type]}
            </Pill>
          ))}
        </div>
      </div>

      {/*
        Rendered on every pass so the region is registered before anything is put in
        it — a live region created and filled in the same commit is not reliably
        announced. Polite, not assertive: the creator caused this, so it can wait for
        a pause in their typing.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * One block
 * ---------------------------------------------------------------------- */

interface BlockRowProps {
  copy: StoryBlocksCopy;
  vocabulary: StoryVocabularyCopy;
  toolbar: StoryToolbarCopy;
  block: StoryBlock;
  index: number;
  total: number;
  disabled: boolean;
  serverProblem: string | undefined;
  /** Null at the ends, which renders the control disabled rather than absent. */
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onRemove: () => void;
  onChange: (block: StoryBlock) => void;
  onFlush?: () => void;
  headingIdsInUse: readonly string[];
}

function BlockRow({
  copy,
  vocabulary,
  toolbar,
  block,
  index,
  total,
  disabled,
  serverProblem,
  onMoveUp,
  onMoveDown,
  onRemove,
  onChange,
  onFlush,
  headingIdsInUse,
}: BlockRowProps) {
  const name = describeBlock(block, index, total, vocabulary);
  const problem = serverProblem ?? blockProblem(block, vocabulary);
  const problemId = useId();

  return (
    <li
      className={cn(
        'rounded-lg border bg-surface-2 p-4',
        problem === null ? 'border-white/8' : 'border-danger',
      )}
    >
      {/*
        A group naming the block, so that everything inside it is announced in
        context: "Paragraph 2 of 7, group" then the field. Without it the seventh
        textarea on the page is announced identically to the first.
      */}
      <div role="group" aria-label={name} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-white/64">
            {vocabulary.blockLabel[block.type]}
            <span className="text-white/40">
              {' · '}
              {fillPlaceholders(vocabulary.describe.position, {
                index: String(index + 1),
                total: String(total),
              })}
            </span>
          </p>

          <div className="flex items-center gap-1">
            {/*
              Icon-only, so each carries the block's name as well as the verb.
              "Move up" repeated eleven times is eleven identical buttons to a
              screen reader; "Move Paragraph 2 of 7 up" is one of eleven distinct
              controls (docs/ui-kit.md §9.4).

              Disabled rather than absent at the ends: a control that disappears
              changes the tab order under a creator's fingers, and the count of
              buttons per block would differ between the first, the last, and the
              rest.
            */}
            <MoveButton
              label={fillPlaceholders(copy.moveUp, { name })}
              disabled={disabled || onMoveUp === null}
              icon={<ArrowUp aria-hidden="true" className="size-4" />}
              onClick={onMoveUp ?? undefined}
            />
            <MoveButton
              label={fillPlaceholders(copy.moveDown, { name })}
              disabled={disabled || onMoveDown === null}
              icon={<ArrowDown aria-hidden="true" className="size-4" />}
              onClick={onMoveDown ?? undefined}
            />
            <MoveButton
              label={fillPlaceholders(copy.remove, { name })}
              disabled={disabled}
              danger
              icon={<Trash2 aria-hidden="true" className="size-4" />}
              onClick={onRemove}
            />
          </div>
        </div>

        <BlockFields
          copy={copy}
          toolbar={toolbar}
          block={block}
          name={name}
          disabled={disabled}
          invalid={problem !== null}
          describedBy={problem === null ? undefined : problemId}
          onChange={onChange}
          onFlush={onFlush}
          headingIdsInUse={headingIdsInUse}
        />

        {problem !== null && (
          /*
            Text and an icon, never a colour on its own (docs/ui-kit.md §7.13). The
            message is wired to the control through `aria-describedby`, so it is
            heard when the field is reached rather than only seen.
          */
          <p id={problemId} className="flex items-start gap-1.5 text-[13px] text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {problem}
          </p>
        )}
      </div>
    </li>
  );
}

function MoveButton({
  label,
  icon,
  disabled,
  danger = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-grid size-8 place-items-center rounded-md border border-white/8 bg-surface-3',
        'transition-[background-color,color] duration-150 ease-in-out',
        'disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-danger hover:bg-surface-4' : 'text-white/64 hover:bg-surface-4 hover:text-white',
      )}
    >
      {icon}
    </button>
  );
}

/* -------------------------------------------------------------------------
 * The fields of each kind of block
 * ---------------------------------------------------------------------- */

interface BlockFieldsProps {
  copy: StoryBlocksCopy;
  toolbar: StoryToolbarCopy;
  block: StoryBlock;
  name: string;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (block: StoryBlock) => void;
  onFlush?: () => void;
  headingIdsInUse: readonly string[];
}

function BlockFields({
  copy,
  toolbar,
  block,
  name,
  disabled,
  invalid,
  describedBy,
  onChange,
  onFlush,
  headingIdsInUse,
}: BlockFieldsProps) {
  switch (block.type) {
    case 'heading':
      return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <label className="sr-only" htmlFor={`${name}-level`}>
            {fillPlaceholders(copy.levelOf, { name })}
          </label>
          <Select
            id={`${name}-level`}
            value={String(block.level)}
            disabled={disabled}
            aria-label={fillPlaceholders(copy.levelOf, { name })}
            className="sm:w-40"
            onChange={(event) =>
              onChange({ ...block, level: event.target.value === '3' ? 3 : 2 })
            }
          >
            <option value="2">{copy.section}</option>
            <option value="3">{copy.subsection}</option>
          </Select>

          <TextInput
            value={block.text}
            disabled={disabled}
            invalid={invalid}
            aria-label={fillPlaceholders(copy.textOf, { name })}
            aria-describedby={describedBy}
            placeholder={copy.headingPlaceholder}
            className="sm:flex-1"
            onChange={(event) => {
              const text = event.target.value;
              /*
                The anchor follows the text, but only while it is still the anchor
                that text would produce. Once a creator has an anchor somebody may
                have linked to, renaming the heading must not silently break the
                link — so a heading that has been given an unrelated anchor keeps
                it. Regenerating unconditionally would be the same mistake as
                recomputing a campaign's slug when its title is corrected.
               */
              const generated = slugifyHeading(block.text);
              const keepsItsAnchor = block.id !== generated && block.text !== '';
              onChange({
                ...block,
                text,
                id: keepsItsAnchor ? block.id : uniqueHeadingId(text, headingIdsInUse),
              });
            }}
            onBlur={onFlush}
          />
        </div>
      );

    case 'paragraph':
    case 'quote':
      return (
        <StoryTextField
          toolbar={toolbar}
          value={spansToText(block.spans)}
          label={name}
          invalid={invalid}
          disabled={disabled}
          describedBy={describedBy}
          rows={block.type === 'quote' ? 3 : 5}
          placeholder={
            block.type === 'quote'
              ? 'Something somebody said about this project'
              : 'Write a paragraph. Select text and use Bold or Italic, or type **bold** and *italic*.'
          }
          onChange={(text) => onChange({ ...block, spans: parseSpans(text) })}
          onBlur={onFlush}
        />
      );

    case 'list':
      return <ListFields copy={copy} toolbar={toolbar} block={block} name={name} disabled={disabled} onChange={onChange} onFlush={onFlush} />;

    case 'rule':
      return (
        <>
          {/* Decorative in the story, so it is decorative here: the block's own
              group label already says a divider is present. */}
          <hr aria-hidden="true" className="border-white/8" />
          <p className="text-[13px] text-white/40">
            {copy.ruleHint}
          </p>
        </>
      );

    case 'image':
      return (
        <ImageFields
          copy={copy}
          block={block}
          name={name}
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
          onChange={onChange}
          onFlush={onFlush}
        />
      );

    case 'embed':
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={block.provider}
              disabled={disabled}
              aria-label={fillPlaceholders(copy.providerOf, { name })}
              className="sm:w-40"
              onChange={(event) => {
                const provider = event.target.value;
                // Narrowed rather than cast: the option list is ours, but a value
                // coming out of the DOM is a string until something checks it.
                if (isEmbedProvider(provider)) onChange({ ...block, provider });
              }}
            >
              {EMBED_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {provider === 'youtube' ? 'YouTube' : 'Vimeo'}
                </option>
              ))}
            </Select>

            <TextInput
              type="url"
              inputMode="url"
              value={block.url}
              disabled={disabled}
              invalid={invalid}
              aria-label={fillPlaceholders(copy.addressOf, { name })}
              aria-describedby={describedBy}
              placeholder={copy.embedUrlPlaceholder}
              className="sm:flex-1"
              onChange={(event) => onChange({ ...block, url: event.target.value })}
              onBlur={onFlush}
            />
          </div>

          <TextInput
            value={block.title}
            disabled={disabled}
            invalid={invalid}
            aria-label={fillPlaceholders(copy.titleOf, { name })}
            placeholder={copy.embedTitlePlaceholder}
            onChange={(event) => onChange({ ...block, title: event.target.value })}
            onBlur={onFlush}
          />
          <p className="text-[13px] text-white/40">
            The title is what a screen reader announces instead of “frame”. Only YouTube and Vimeo
            can be embedded.
          </p>
        </div>
      );
  }
}

/* -------------------------------------------------------------------------
 * Lists
 * ---------------------------------------------------------------------- */

function ListFields({
  copy,
  toolbar,
  block,
  name,
  disabled,
  onChange,
  onFlush,
}: {
  copy: StoryBlocksCopy;
  toolbar: StoryToolbarCopy;
  block: Extract<StoryBlock, { type: 'list' }>;
  name: string;
  disabled: boolean;
  onChange: (block: StoryBlock) => void;
  onFlush?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Select
        value={block.ordered ? 'ordered' : 'bulleted'}
        disabled={disabled}
        aria-label={fillPlaceholders(copy.styleOf, { name })}
        className="sm:w-48"
        onChange={(event) => onChange({ ...block, ordered: event.target.value === 'ordered' })}
      >
        <option value="bulleted">{copy.bulleted}</option>
        <option value="ordered">{copy.numbered}</option>
      </Select>

      <ol className="flex flex-col gap-3">
        {block.items.map((item, at) => (
          <li key={at} className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex-1">
              <StoryTextField
                toolbar={toolbar}
                value={spansToText(item)}
                label={fillPlaceholders(copy.itemOf, { at: String(at + 1), count: String(block.items.length), name })}
                rows={2}
                disabled={disabled}
                onChange={(text) =>
                  onChange({
                    ...block,
                    items: block.items.map((existing, index) =>
                      index === at ? parseSpans(text) : existing,
                    ),
                  })
                }
                onBlur={onFlush}
              />
            </div>
            <MoveButton
              label={fillPlaceholders(copy.removeItemOf, { at: String(at + 1), count: String(block.items.length), name })}
              disabled={disabled || block.items.length === 1}
              danger
              icon={<Trash2 aria-hidden="true" className="size-4" />}
              onClick={() =>
                onChange({ ...block, items: block.items.filter((_, index) => index !== at) })
              }
            />
          </li>
        ))}
      </ol>

      <Pill
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={fillPlaceholders(copy.addItemTo, { name })}
        className="self-start"
        onClick={() => onChange({ ...block, items: [...block.items, []] })}
      >
        {copy.addItem}
      </Pill>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Images
 * ---------------------------------------------------------------------- */

function ImageFields({
  copy,
  block,
  name,
  disabled,
  invalid,
  describedBy,
  onChange,
  onFlush,
}: {
  copy: StoryBlocksCopy;
  block: Extract<StoryBlock, { type: 'image' }>;
  name: string;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (block: StoryBlock) => void;
  onFlush?: () => void;
}) {
  /**
   * The address as typed, which is not the same thing as the saved block.
   *
   * A URL only becomes part of the document once it has been measured, because the
   * document requires the dimensions — the public page reserves the image's box
   * before it loads so the story does not jump as the reader scrolls. Keeping the
   * typed value here means the field does not fight the document over every
   * keystroke.
   */
  const [typed, setTyped] = useState(block.url);
  const [measuring, setMeasuring] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  /*
   * The blur placeholder from the same load that measured the image
   * (`lib/images/lqip.ts`). The story document has no field for it — the server
   * validates that schema (#35) — so it lives here and is gone on reload, which
   * is exactly as far as a placeholder can travel until the media pipeline
   * stores one (docs/architecture.md §13.1).
   */
  const [placeholder, setPlaceholder] = useState<string | null>(null);

  async function measure(): Promise<void> {
    const address = typed.trim();
    if (address === '') {
      setNote({ tone: 'danger', text: copy.needUrlFirst });
      return;
    }

    setMeasuring(true);
    setNote(null);
    try {
      const size = await measureImage(address);
      setPlaceholder(size.placeholder);
      onChange({ ...block, url: address, width: size.width, height: size.height });
      setNote({ tone: 'success', text: fillPlaceholders(copy.measured, { size: describeSize(size) }) });
    } catch (cause) {
      setNote({
        tone: 'danger',
        text: cause instanceof Error ? cause.message : copy.notAnImage,
      });
    } finally {
      setMeasuring(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/*
        Said plainly rather than implied. There is no media table, no object storage,
        and no uploader (contract §3, docs/architecture.md §13): nothing this form
        does puts a file anywhere. A drop zone here would be a control that quietly
        did nothing, which is worse than no control.
      */}
      <InlineAlert variant="info" title={copy.nothingUploadedTitle}>
        Give the address of an image that is already published. Its size is read in your browser and
        stored with the story, so the page can reserve its space before it loads.
      </InlineAlert>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          type="url"
          inputMode="url"
          value={typed}
          disabled={disabled}
          invalid={invalid}
          aria-label={fillPlaceholders(copy.addressOf, { name })}
          aria-describedby={describedBy}
          placeholder={copy.imageUrlPlaceholder}
          className="sm:flex-1"
          onChange={(event) => setTyped(event.target.value)}
        />
        <Pill variant="ghost" disabled={disabled || measuring} onClick={() => void measure()}>
          {measuring ? copy.measuring : copy.measureAndAdd}
        </Pill>
      </div>

      {block.width > 0 && (
        <figure className="overflow-hidden rounded-lg border border-white/8 bg-surface-3">
          {/*
            THE PREVIEW RESERVES THE IMAGE'S OWN SHAPE, which is the whole
            reason the editor measures at all — the public story does the same
            with the same numbers, so the page does not jump as the reader
            scrolls past a picture.

            THE CAP IS ON WIDTH, NOT HEIGHT. A `max-height` on a box that has an
            aspect ratio and a full-width parent does not shrink the box, it
            breaks the ratio. Deriving the width a 16rem-tall version of THIS
            image would occupy keeps a portrait photograph from filling the
            editor while leaving the reservation exact.

            THE ALT TEXT AS IT STANDS, so the creator sees what a reader would
            get — including nothing at all, when they have not written it yet.
            That is why this is `alt` rather than `decorative`: an empty string
            here is a fact about the document, not a decision about the preview.

            NOT `next/image`, for the reason `CoverImageField` gives: a preview
            has to show the bytes the creator gave us, and `measureImage` has
            already put exactly those bytes in the browser cache.
          */}
          <div
            className="mx-auto w-full"
            style={
              intrinsicSize(block) === null
                ? undefined
                : { maxWidth: `calc(16rem * ${block.width} / ${block.height})` }
            }
          >
            <Media
              src={block.url}
              alt={block.alt}
              ratio={intrinsicSize(block) ?? '16/9'}
              fit="contain"
              placeholder={placeholder ?? undefined}
            />
          </div>
          <figcaption className="px-4 py-2 text-[13px] text-white/64">
            {describeSize(block)} pixels
          </figcaption>
        </figure>
      )}

      <TextInput
        value={block.alt}
        disabled={disabled}
        invalid={invalid}
        aria-label={fillPlaceholders(copy.descriptionOf, { name })}
        placeholder={copy.imageAltPlaceholder}
        onChange={(event) => onChange({ ...block, alt: event.target.value })}
        onBlur={onFlush}
      />
      <p className="text-[13px] text-white/40">
        Required. It is what a backer using a screen reader receives instead of the picture, so
        describe what it shows rather than naming the file.
      </p>

      {/*
        Two regions, for the reason `CoverImageField` gives: `InlineAlert` already
        carries role="alert" for a danger, and putting an alert inside a polite live
        region gives assistive technology two contradictory instructions about the
        same text.
      */}
      <div role="status" aria-live="polite" className="empty:hidden">
        {note !== null && note.tone === 'success' && (
          <InlineAlert variant="success">{note.text}</InlineAlert>
        )}
      </div>
      {note !== null && note.tone === 'danger' && (
        <InlineAlert variant="danger">{note.text}</InlineAlert>
      )}
    </div>
  );
}
