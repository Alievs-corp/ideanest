'use client';

import type { StoryBlocksCopy, StoryToolbarCopy } from '@ideanest/campaign-editor/copy';
import { useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { FileDropZone, InlineAlert, Media, Pill, TextInput } from '@ideanest/ui';
import { describeSize } from '@ideanest/campaign-editor/cover-image';
import {
  parseSpans,
  renameSection,
  spansToText,
  type StoryBlock,
} from '@ideanest/campaign-editor/story';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { intrinsicSize } from '../../lib/images/source';
import { useImageUpload } from '../../lib/media/useImageUpload';
import { StoryTextField } from './StoryTextField';

/* -------------------------------------------------------------------------
 * Sections
 * ---------------------------------------------------------------------- */

/**
 * A section: its title, an optional picture uploaded through the image block's pipeline, and
 * its text, edited with the paragraph's field and mark toolbar.
 *
 * Upload only, with no address field: the contract holds the picture to the image block's
 * rules (a measured size, and a description that may be empty), and an upload meets the
 * first by construction.
 */
export function SectionFields({
  copy,
  toolbar,
  block,
  name,
  disabled,
  invalid,
  describedBy,
  altDescribedBy,
  onChange,
  onFlush,
  anchorsInUse,
}: {
  copy: StoryBlocksCopy;
  toolbar: StoryToolbarCopy;
  block: Extract<StoryBlock, { type: 'section' }>;
  name: string;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  altDescribedBy: string | undefined;
  onChange: (block: StoryBlock) => void;
  onFlush?: () => void;
  anchorsInUse: readonly string[];
}) {
  const words = copy.sectionBlock;
  const imageHintId = useId();
  const [note, setNote] = useState<{
    tone: 'success' | 'danger';
    title?: string;
    text: string;
  } | null>(null);
  // For the reason `ImageFields` keeps one: the story document has no field for it.
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const { stage, upload: send } = useImageUpload(copy.upload);
  // The block as it stands now, for the reason `ImageFields` gives.
  const current = useRef(block);
  current.current = block;
  const image = block.image;

  async function upload(file: File): Promise<void> {
    setNote(null);
    const result = await send(file);
    if (result === null) return;
    if ('refusal' in result) {
      setNote({ tone: 'danger', title: copy.upload.notUsedTitle, text: result.refusal });
      return;
    }
    const uploaded = result.image;
    setPlaceholder(uploaded.blurDataUrl === '' ? null : uploaded.blurDataUrl);
    onChange({
      ...current.current,
      image: {
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
        // A replaced picture keeps the description already written for the section.
        alt: current.current.image?.alt ?? '',
      },
    });
    setNote({ tone: 'success', text: fillPlaceholders(copy.measured, { size: describeSize(uploaded) }) });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {/* Visible words; the control's name carries the block's, as every field here does. */}
        <p aria-hidden="true" className="text-[13px] font-medium text-fg-64">
          {words.title}
        </p>
        <TextInput
          value={block.title}
          disabled={disabled}
          invalid={invalid}
          aria-label={fillPlaceholders(copy.titleOf, { name })}
          aria-describedby={describedBy}
          placeholder={words.titlePlaceholder}
          onChange={(event) =>
            // The anchor follows the title under the heading's rule (`renameSection`).
            onChange(renameSection(block, event.target.value, anchorsInUse))
          }
          onBlur={onFlush}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p aria-hidden="true" className="text-[13px] font-medium text-fg-64">
          {words.image}
        </p>
        <p id={imageHintId} className="text-[13px] text-fg-40">
          {words.imageHint}
        </p>

        {image !== null && (
          <figure className="overflow-hidden rounded-lg border border-fg/8 bg-surface-3">
            {/* The image block's preview, for its reasons: the picture's own shape, its alt as written. */}
            <div
              className="mx-auto w-full"
              style={
                intrinsicSize(image) === null
                  ? undefined
                  : { maxWidth: `calc(16rem * ${image.width} / ${image.height})` }
              }
            >
              <Media
                src={image.url}
                alt={image.alt}
                ratio={intrinsicSize(image) ?? '16/9'}
                fit="contain"
                placeholder={placeholder ?? undefined}
              />
            </div>
            <figcaption className="px-4 py-2 text-[13px] text-fg-64">
              {fillPlaceholders(copy.pixels, { size: describeSize(image) })}
            </figcaption>
          </figure>
        )}

        <FileDropZone
          accept="image/*"
          disabled={disabled || stage !== null}
          aria-label={fillPlaceholders(image === null ? words.addImageTo : words.replaceImageOf, { name })}
          aria-describedby={imageHintId}
          prompt={copy.imagePrompt}
          dragPrompt={copy.imageDragPrompt}
          buttonLabel={image === null ? words.addImage : words.replaceImage}
          hint={copy.imageDropHint}
          onFiles={(files) => {
            const [first] = files;
            if (first) void upload(first);
          }}
        />

        {image !== null && (
          <>
            <p aria-hidden="true" className="text-[13px] font-medium text-fg-64">
              {words.imageAlt}
            </p>
            <TextInput
              value={image.alt}
              disabled={disabled}
              invalid={invalid}
              aria-label={fillPlaceholders(copy.descriptionOf, { name })}
              aria-describedby={altDescribedBy}
              placeholder={copy.imageAltPlaceholder}
              onChange={(event) => onChange({ ...block, image: { ...image, alt: event.target.value } })}
              onBlur={onFlush}
            />
            <p className="text-[13px] text-fg-40">{copy.altHint}</p>
            <Pill
              variant="ghost"
              size="sm"
              disabled={disabled || stage !== null}
              aria-label={fillPlaceholders(words.removeImageFrom, { name })}
              iconLeft={<Trash2 aria-hidden="true" className="size-4" />}
              className="self-start"
              onClick={() => {
                setNote(null);
                setPlaceholder(null);
                onChange({ ...block, image: null });
              }}
            >
              {words.removeImage}
            </Pill>
          </>
        )}

        {/* Two regions, for the reason `ImageFields` gives. */}
        <div role="status" aria-live="polite" className="empty:hidden">
          {stage !== null && <InlineAlert variant="info">{copy.upload.stage[stage]}</InlineAlert>}
          {stage === null && note !== null && note.tone === 'success' && (
            <InlineAlert variant="success">{note.text}</InlineAlert>
          )}
        </div>
        {note !== null && note.tone === 'danger' && (
          <InlineAlert variant="danger" title={note.title}>
            {note.text}
          </InlineAlert>
        )}
      </div>

      <p aria-hidden="true" className="text-[13px] font-medium text-fg-64">
        {words.text}
      </p>
      <StoryTextField
        toolbar={toolbar}
        value={spansToText(block.spans)}
        label={fillPlaceholders(copy.textOf, { name })}
        disabled={disabled}
        rows={5}
        placeholder={words.textPlaceholder}
        onChange={(text) => onChange({ ...block, spans: parseSpans(text) })}
        onBlur={onFlush}
      />
    </div>
  );
}
