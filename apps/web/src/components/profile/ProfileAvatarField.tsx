'use client';

import { useState } from 'react';
import { Field, FileDropZone, InlineAlert, Media, Pill, TextInput } from '@ideanest/ui';
import { describeSize, measureImage } from '../../lib/projects/coverImage';
import type { ProfileAvatarCopy } from '../../lib/i18n/profile-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * §4.2's P-01, as much of it as the platform can do — the profile picture.
 *
 * <h2>P-01 IS "AVATAR UPLOAD AND CROP", AND NEITHER HALF EXISTS YET</h2>
 *
 * There is no object storage, no `media` table and no ingestion pipeline: §13.1 is a
 * different epic and nothing in this repository puts a file anywhere. **Upload and crop wait
 * on §13.1** and this control is not a down payment on them — when that pipeline lands, this
 * component is replaced rather than extended, exactly as
 * `components/campaign-editor/CoverImageField` says of itself.
 *
 * What the account *can* record is one column, `users.avatar_url`, so that is what this
 * collects: the address of a picture that is already published. The `InlineAlert` says so in
 * the first thing a reader meets, because a control that implied an upload and then did not
 * perform one would be a worse failure than the missing feature.
 *
 * <h2>The drop zone still earns its place, and it is not decoration</h2>
 *
 * `CoverImageField` makes the argument and it holds here with a different measurement at the
 * end of it. Somebody holding a photograph on their laptop has one question this browser can
 * actually answer — *what will this look like in a circle* — and dropping the file answers it
 * without publishing anything anywhere. So the zone measures, reports the pixel size, says
 * whether the image is square, and states plainly that nothing was uploaded. A `FileDropZone`
 * that silently did nothing would be worse than no drop zone at all.
 *
 * **No minimum is asserted**, unlike the cover's 1024×576. §5.3 makes that one a submission
 * requirement and this repository has no equivalent rule for an avatar; inventing a threshold
 * here would be this component taking a product decision inside a hint string.
 *
 * <h2>Square, because the frame is a circle</h2>
 *
 * `ProfileHeader` renders the avatar `rounded-full` with `object-cover`, so a portrait
 * photograph loses its top and bottom and a panorama loses its sides. That is the crop P-01
 * would let somebody choose and today cannot, which makes saying it out loud the only thing
 * this control can offer in its place.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 — "authentication, account settings: none, 150ms colour on
 * controls". Nothing here enters, fades or moves; the preview appears when the address does.
 */

export interface ProfileAvatarFieldProps {
  /** The address as typed, which is the whole of the value — there is nothing else to save. */
  readonly url: string;
  /** Whose picture it is, for the initials shown while there is none. */
  readonly name: string;
  readonly disabled?: boolean;
  /** The service's own refusal, when it named `avatarUrl`. */
  readonly error?: string;
  readonly onUrlChange: (url: string) => void;
  /** Every word this field draws, the two accessible names included — #82. */
  readonly copy: ProfileAvatarCopy;
}

type Note = { tone: 'info' | 'danger'; title?: string; text: string };

/** "Jane Doe" -> "JD", the same rule `Avatar` and `ProfileHeader` use. */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

export function ProfileAvatarField({
  url,
  name,
  disabled = false,
  error,
  onUrlChange,
  copy,
}: ProfileAvatarFieldProps) {
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  /*
   * An address the browser could not load as an image. Kept as the exact string rather than
   * as a boolean, so that correcting one character clears the fallback: a preview stuck on
   * "this did not load" after the typo was fixed is a preview nobody believes twice.
   */
  const [broken, setBroken] = useState<string | null>(null);

  const address = url.trim();
  /*
   * `https://` and nothing else, which is the service's rule rather than this component's —
   * `ProfileEditing.requiredHttpsUrl` refuses everything else and this does not second-guess
   * it. The prefix is read here only to decide whether to ATTEMPT a preview: pointing an
   * `<img>` at a half-typed address fires a request for `htt` on the way to `https://…`.
   */
  const previewable = address.startsWith('https://') && broken !== address;

  async function checkFile(file: File): Promise<void> {
    setChecking(true);
    setNote(null);
    try {
      const size = await measureImage(file);
      const square = size.width === size.height;

      setNote({
        tone: 'info',
        title: square ? copy.squareTitle : copy.notSquareTitle,
        text: fillPlaceholders(square ? copy.square : copy.notSquare, {
          file: file.name,
          size: describeSize(size),
        }),
      });
    } catch (cause) {
      setNote({
        tone: 'danger',
        text: cause instanceof Error ? cause.message : copy.unreadable,
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <Field
      grouped
      label={copy.label}
      hint={copy.hint}
      error={error}
    >
      <div className="flex flex-col gap-3">
        <InlineAlert variant="info" title={copy.pipelineTitle}>{copy.pipelineBody}</InlineAlert>

        <div className="flex items-center gap-4">
          <div className="size-20 shrink-0 overflow-hidden rounded-full border border-white/8 bg-surface-3">
            {previewable ? (
              /*
                NOT `next/image`. A preview has to show somebody the bytes they gave us, and
                the optimiser would re-encode them — they would be judging their own
                photograph by our AVIF of it. `next/image` also refuses a host that is not in
                `next.config.mjs`, which for an address just typed into a box is every host.
                `CoverImageField` takes the same decision for the same two reasons.

                DECORATIVE: the sentence beside it says what it is, and a picture somebody has
                this second chosen has no description this component could invent.
              */
              <Media src={address} ratio="1/1" decorative onError={() => setBroken(address)} />
            ) : (
              /*
                `role="img"` with a name rather than two letters read out as text — the same
                fallback `ProfileHeader` renders, so what this shows is what a visitor sees.
              */
              <span
                role="img"
                aria-label={fillPlaceholders(copy.noPicture, { name })}
                className="grid size-full place-items-center text-xl font-medium text-white/64"
              >
                {initialsOf(name)}
              </span>
            )}
          </div>

          <p className="text-sm text-white/40">
            {address !== '' && broken === address
              ? copy.broken
              : previewable
                ? copy.cropped
                : copy.initials}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            type="url"
            inputMode="url"
            value={url}
            disabled={disabled}
            /*
              The `Field` label names a group here, so it cannot name this control; without a
              label of its own the input is announced as "edit text" and nothing else.
            */
            aria-label={copy.address}
            placeholder={copy.addressPlaceholder}
            className="sm:flex-1"
            onChange={(event) => {
              setBroken(null);
              onUrlChange(event.target.value);
            }}
          />
          {address !== '' && (
            <Pill
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setBroken(null);
                setNote(null);
                onUrlChange('');
              }}
            >
              {copy.remove}
            </Pill>
          )}
        </div>

        <FileDropZone
          accept="image/*"
          disabled={disabled || checking}
          prompt={copy.prompt}
          dragPrompt={copy.dragPrompt}
          buttonLabel={copy.buttonLabel}
          hint={copy.dropHint}
          onFiles={(files) => {
            const [first] = files;
            if (first) void checkFile(first);
          }}
        />

        {/*
          The outcome of dropping a file has to be announced, or a screen-reader user presses
          "Choose a picture to measure" and hears nothing at all.

          Two regions rather than one, for the reason `CoverImageField` gives: `InlineAlert`
          already carries `role="alert"` for danger, and an alert inside a polite live region
          hands assistive technology two contradictory instructions about one sentence. The
          polite region is rendered on every pass so that it is registered before anything is
          put into it.
        */}
        <div role="status" aria-live="polite" className="empty:hidden">
          {note !== null && note.tone === 'info' && (
            <InlineAlert variant="info" title={note.title}>
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
