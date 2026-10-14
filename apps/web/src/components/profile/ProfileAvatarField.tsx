'use client';

import { useId, useState } from 'react';
import { Field, FileDropZone, InlineAlert, Media, Pill, TextInput } from '@ideanest/ui';
import type { ProfileAvatarCopy } from '../../lib/i18n/profile-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { describeUploadFailure, useImageUpload } from '../../lib/media/useImageUpload';

/**
 * §4.2's P-01 — the profile picture. Issue #271.
 *
 * <h2>An upload first, and an address second</h2>
 *
 * This used to take only the address of a picture already published somewhere, because
 * there was nowhere to put a file. §13.1's pipeline exists now and the cover has used it since
 * #86, so choosing a file sends it there — `lib/media/useImageUpload.ts`, the same transfer
 * the cover makes — and the address the service answers with becomes `avatarUrl`. The address
 * field stays, below the drop zone, for a picture that is already hosted, which is what the
 * app (#268) offers behind "Use an image address" too.
 *
 * <h2>An uploaded picture is saved at once, and an address waits for the form</h2>
 *
 * The bytes exist the moment the upload is ready. Holding the address in the draft until
 * "Save profile" would leave a stored picture belonging to nobody whenever somebody left the
 * page first, so `onUploaded` saves it on its own, leaving the rest of the draft as it is —
 * the app's `saveAvatar` makes the same choice. A typed address costs nothing to abandon, so
 * it stays part of the form, and `addressHint` says so beside it.
 *
 * <h2>What the service does not do, said so the next reader does not assume it</h2>
 *
 * - **No crop.** P-01 names one and there is none: `ProfileHeader` renders the avatar
 *   `rounded-full` with `object-cover`, so the preview below shows the circle the middle of
 *   the picture is cut to, and `dropHint` recommends a square one.
 * - **A replaced picture stays in storage.** The profile stores an address rather than a
 *   media id, and `deleteAbandoned` only removes rows that never finished uploading.
 * - **A deployment whose `MEDIA_PUBLIC_BASE_URL` is not https** answers the save with
 *   `PROFILE_FIELD_INVALID` on `avatarUrl`, because the column takes https only. The panel
 *   puts that sentence under this field like any other refusal of it.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5 — "authentication, account settings: none, 150ms colour on
 * controls". Nothing here enters, fades or moves; the stage sentences replace one another.
 */

export interface ProfileAvatarFieldProps {
  /** The address as the form holds it — typed, or the one an upload was saved with. */
  readonly url: string;
  /** Whose picture it is, for the initials shown while there is none. */
  readonly name: string;
  readonly disabled?: boolean;
  /** The service's own refusal, when it named `avatarUrl`. */
  readonly error?: string;
  readonly onUrlChange: (url: string) => void;
  /** Saves an uploaded picture's address on its own; `false` when the save was refused. */
  readonly onUploaded: (url: string) => Promise<boolean>;
  /** Every word this field draws, the two accessible names included — #82. */
  readonly copy: ProfileAvatarCopy;
}

type Note = { tone: 'success' | 'danger'; title?: string; text: string };

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
  onUploaded,
  copy,
}: ProfileAvatarFieldProps) {
  const { stage, upload: send } = useImageUpload();
  /* Between a ready upload and the answer to its save, which is a request of its own. */
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  /*
   * An address the browser could not load as an image. Kept as the exact string rather than
   * as a boolean, so that correcting one character clears the fallback: a preview stuck on
   * "this did not load" after the typo was fixed is a preview nobody believes twice.
   */
  const [broken, setBroken] = useState<string | null>(null);
  const addressHintId = useId();

  const busy = stage !== null || saving;
  const address = url.trim();
  /*
   * `https://` and nothing else, which is the service's rule rather than this component's —
   * `ProfileEditing.requiredHttpsUrl` refuses everything else and this does not second-guess
   * it. The prefix is read here only to decide whether to ATTEMPT a preview: pointing an
   * `<img>` at a half-typed address fires a request for `htt` on the way to `https://…`.
   */
  const previewable = address.startsWith('https://') && broken !== address;

  async function upload(file: File): Promise<void> {
    setNote(null);
    try {
      const image = await send(file);
      // Abandoned for a newer file, which is the one this field now reports on.
      if (image === null) return;

      setSaving(true);
      setBroken(null);
      /*
       * A refused save says nothing here. The panel puts the service's sentence under this
       * field, where every refusal of `avatarUrl` goes, and a second one in this region would
       * have somebody read about one failure twice.
       */
      if (await onUploaded(image.url)) setNote({ tone: 'success', text: copy.uploaded });
    } catch (cause) {
      setNote({
        tone: 'danger',
        title: copy.upload.notUsedTitle,
        text: describeUploadFailure(cause, copy.upload),
      });
    } finally {
      setSaving(false);
    }
  }

  const progress = stage !== null ? copy.upload.stage[stage] : saving ? copy.saving : null;

  return (
    <Field
      grouped
      label={copy.label}
      hint={copy.hint}
      error={error}
    >
      <div className="flex flex-col gap-3">
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

        <FileDropZone
          accept="image/*"
          disabled={disabled || busy}
          prompt={copy.prompt}
          dragPrompt={copy.dragPrompt}
          buttonLabel={copy.buttonLabel}
          hint={copy.dropHint}
          onFiles={(files) => {
            const [first] = files;
            if (first) void upload(first);
          }}
        />

        {/*
          Where the upload is, and that it was saved, has to be announced, or a screen-reader
          user chooses a picture and hears nothing for the seconds the service takes.

          Two regions rather than one, for the reason `CoverImageField` gives: `InlineAlert`
          already carries `role="alert"` for danger, and an alert inside a polite live region
          hands assistive technology two contradictory instructions about one sentence. The
          polite region is rendered on every pass so that it is registered before anything is
          put into it.
        */}
        <div role="status" aria-live="polite" className="empty:hidden">
          {progress !== null && <InlineAlert variant="info">{progress}</InlineAlert>}
          {progress === null && note !== null && note.tone === 'success' && (
            <InlineAlert variant="success">{note.text}</InlineAlert>
          )}
        </div>

        {note !== null && note.tone === 'danger' && (
          <InlineAlert variant="danger" title={note.title}>
            {note.text}
          </InlineAlert>
        )}

        <p id={addressHintId} className="text-[13px] text-white/64">
          {copy.addressHint}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            type="url"
            inputMode="url"
            value={url}
            disabled={disabled || busy}
            /*
              The `Field` label names a group here, so it cannot name this control; without a
              label of its own the input is announced as "edit text" and nothing else.
            */
            aria-label={copy.address}
            aria-describedby={addressHintId}
            placeholder={copy.addressPlaceholder}
            className="sm:flex-1"
            onChange={(event) => {
              setBroken(null);
              setNote(null);
              onUrlChange(event.target.value);
            }}
          />
          {address !== '' && (
            <Pill
              type="button"
              variant="ghost"
              disabled={disabled || busy}
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
      </div>
    </Field>
  );
}
