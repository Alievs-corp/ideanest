'use client';

import { useState } from 'react';
import { Field, FileDropZone, InlineAlert, Media, Pill, TextInput } from '@ideanest/ui';
import type { CoverImage } from '../../lib/projects/api';
import {
  COVER_MIN_HEIGHT,
  COVER_MIN_WIDTH,
  describeSize,
  meetsCoverMinimum,
} from '@ideanest/campaign-editor/cover-image';
import { measureImage } from '../../lib/projects/coverImage';
import { useImageUpload } from '../../lib/media/useImageUpload';

/**
 * The cover image.
 *
 * WHAT CHANGED, AND WHY BOTH HALVES HAD TO. This form used to say, in a banner, that it
 * could not store a file — there was no uploader, no object storage and no `media` table
 * (docs/architecture.md §13.1). It also refused any image below 1024×576. Together those
 * meant a creator holding an 800×600 photograph was stopped at the first screen of the
 * editor and told to go and publish a larger one somewhere else first.
 *
 * Both are gone. Dropping a file uploads it: the browser writes to a presigned address, the
 * service strips the metadata, reduces it to 1440px and measures it, and what comes back is
 * the cover — with §13.1's blur placeholder, from the server rather than from this component's
 * own sample. And the minimum is advice: a smaller image is saved and says so.
 *
 * THE ADDRESS FIELD STAYS. Every campaign that predates the uploader has a typed URL, and
 * pasting one still works. It is the path where nothing on the server has seen the image, so
 * the dimensions are read here in the browser and are the client's word — which is one of the
 * two reasons the size rule stopped blocking.
 */
import type { CoverImageCopy } from '@ideanest/campaign-editor/copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

export interface CoverImageFieldProps {
  /** This field's words, including what a refused upload is called. */
  copy: CoverImageCopy;
  /** The address as typed, which may not yet be a saved cover. */
  url: string;
  cover: CoverImage | null;
  disabled?: boolean;
  /** A message from the form's own validation. Size is no longer one of them. */
  error?: string;
  onUrlChange: (url: string) => void;
  onAccept: (cover: CoverImage) => void;
  onRemove: () => void;
}

type Note = { tone: 'success' | 'info' | 'danger'; title?: string; text: string };

const MINIMUM = `${COVER_MIN_WIDTH}×${COVER_MIN_HEIGHT}`;

export function CoverImageField({
  copy,
  url,
  cover,
  disabled = false,
  error,
  onUrlChange,
  onAccept,
  onRemove,
}: CoverImageFieldProps) {
  const [checking, setChecking] = useState(false);
  /*
   * The transfer itself, shared with every other field that takes a picture since #271:
   * `lib/media/useImageUpload.ts` abandons a superseded file rather than racing it.
   */
  const { stage, upload: send } = useImageUpload(copy);
  const [note, setNote] = useState<Note | null>(null);
  /*
   * The blur placeholder for the preview. For an upload it comes from the server, on the
   * media row, and survives a reload with the cover. For a typed address it is sampled here
   * from the load that measured the image (`lib/images/lqip.ts`) and is gone on the next page
   * load — which is honest, because for that path nothing on the server has seen the bytes.
   */
  const [placeholder, setPlaceholder] = useState<string | null>(null);

  function sizeAdvice(size: { width: number; height: number }): Note {
    return meetsCoverMinimum(size)
      ? { tone: 'success', text: fillPlaceholders(copy.set, { size: describeSize(size) }) }
      : {
          // Not `danger`. The image is saved and the campaign can be submitted; this is the
          // one thing the creator might want to change and not a thing they must.
          tone: 'info',
          title: copy.softTitle,
          /*
           * "Soft", not "stretched", and the distinction is the whole of what a creator
           * needs to know. Every surface that renders a cover uses `object-cover` --
           * `Media` defaults to it, and CampaignMedia and ProjectCard pass it explicitly --
           * so the proportions are kept and the frame crops. What a small image loses is
           * resolution, because it is scaled up to fill a 1440px header; it is not
           * distorted, and telling somebody their photograph will be squashed would send
           * them to fix a problem they do not have.
           */
          text: fillPlaceholders(copy.setSmall, {
            size: describeSize(size),
            minimum: MINIMUM,
          }),
        };
  }

  async function useAddress(): Promise<void> {
    const address = url.trim();
    if (address === '') {
      setNote({ tone: 'danger', text: copy.needUrlFirst });
      return;
    }

    setChecking(true);
    setNote(null);
    try {
      const size = await measureImage(address);

      setPlaceholder(size.placeholder);
      // `mediaId: null` and not omitted: this cover did not come from an upload, and leaving
      // a stale identifier beside a new address is exactly what the server refuses.
      onAccept({ url: address, width: size.width, height: size.height, mediaId: null });
      setNote(sizeAdvice(size));
    } catch (cause) {
      setNote({ tone: 'danger', text: cause instanceof Error ? cause.message : copy.unusable });
    } finally {
      setChecking(false);
    }
  }

  async function upload(file: File): Promise<void> {
    setChecking(true);
    setNote(null);
    try {
      const result = await send(file);
      // Abandoned for a newer file, which is the one this field now reports on.
      if (result === null) return;
      if ('refusal' in result) {
        setNote({ tone: 'danger', title: copy.notUsedTitle, text: result.refusal });
        return;
      }
      const { image } = result;

      setPlaceholder(image.blurDataUrl === '' ? null : image.blurDataUrl);
      onAccept({
        // The address and the dimensions are sent for the benefit of anything reading this
        // draft before it is saved; the server takes the identifier and fills them in from
        // what it measured.
        url: image.url,
        width: image.width,
        height: image.height,
        mediaId: image.mediaId,
      });
      setNote(sizeAdvice(image));
    } finally {
      setChecking(false);
    }
  }

  return (
    <Field
      grouped
      label={copy.label}
      hint={fillPlaceholders(copy.hint, { minimum: MINIMUM })}
      error={error}
    >
      <div className="flex flex-col gap-3">
        {cover !== null && (
          <figure className="overflow-hidden rounded-lg border border-white/8 bg-surface-2">
            {/*
              THE 16:9 CROP, NOT THE INTRINSIC SHAPE. This preview answers "what
              will the discovery card look like", and the card crops (§8.2). A
              creator whose 4:3 photograph loses its top and bottom there should
              see that here rather than discover it after launch.

              NOT `next/image`, AND THAT IS THE POINT. A preview has to show the
              creator the bytes they gave us; a re-encode would have them judging
              their own photograph by our AVIF of it. The file is also already in
              the browser cache — either measured here or just uploaded — so the
              optimiser would add a request rather than remove one, on the surface
              docs/motion-system.md §5 gives the tightest budget in the product.

              DECORATIVE: the caption carries the same information as text, and a
              preview of an image the creator has this second chosen has no
              description this component could invent.
            */}
            <Media
              src={cover.url}
              ratio="16/9"
              placeholder={placeholder ?? undefined}
              decorative
            />
            <figcaption className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] text-white/64">
              {/*
                Two whole sentences rather than one with a fragment appended. " · uploaded"
                was a literal here until #86, and a translator handed a dangling suffix has
                no way to put it where their language puts it.
              */}
              <span>
                {fillPlaceholders(cover.mediaId ? copy.sizeUploaded : copy.size, {
                  size: describeSize(cover),
                })}
              </span>
              <Pill
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  // The placeholder is a picture of the cover being removed.
                  setPlaceholder(null);
                  onRemove();
                }}
              >
                {copy.remove}
              </Pill>
            </figcaption>
          </figure>
        )}

        <FileDropZone
          accept="image/*"
          disabled={disabled || checking}
          prompt={copy.prompt}
          dragPrompt={copy.dragPrompt}
          buttonLabel={copy.buttonLabel}
          hint={fillPlaceholders(copy.dropHint, { minimum: MINIMUM })}
          onFiles={(files) => {
            const [first] = files;
            if (first) void upload(first);
          }}
        />

        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            type="url"
            inputMode="url"
            value={url}
            disabled={disabled}
            // The `Field` label names a group here, so it cannot name this
            // control; without a label of its own the input would be announced
            // as "edit text" and nothing else.
            aria-label={copy.urlLabel}
            placeholder={copy.urlPlaceholder}
            className="sm:flex-1"
            onChange={(event) => onUrlChange(event.target.value)}
          />
          <Pill variant="ghost" disabled={disabled || checking} onClick={() => void useAddress()}>
            {checking && stage === null ? copy.checking : copy.useAddress}
          </Pill>
        </div>

        {/*
          The outcome of pressing a button has to be announced, or a
          screen-reader user presses "Use this address" and hears nothing at all.

          Two regions rather than one: `InlineAlert` already carries
          role="alert" for danger — a measurement that failed is worth
          interrupting for — and putting an alert inside a polite live region
          gives assistive technology two contradictory instructions about the
          same text. The polite region is rendered on every pass so that it is
          registered before anything is put into it.
        */}
        <div role="status" aria-live="polite" className="empty:hidden">
          {/*
            THE WHOLE SENTENCE, not a word with " the image…" after it. That was the shape
            until #86: three translated stage words with an English tail appended in JSX,
            which reads as "Şəkil hazırlanır the image…" in every language but one.
          */}
          {stage !== null && <InlineAlert variant="info">{copy.stage[stage]}</InlineAlert>}
          {stage === null && note !== null && note.tone !== 'danger' && (
            <InlineAlert variant={note.tone} title={note.title}>
              {note.text}
            </InlineAlert>
          )}
        </div>

        {note !== null && note.tone === 'danger' && (
          <InlineAlert variant="danger" title={note.title}>
            {note.text}
          </InlineAlert>
        )}
      </div>
    </Field>
  );
}
