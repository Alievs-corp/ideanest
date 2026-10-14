'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverFailureCode, CoverFailureCopy } from '@ideanest/campaign-editor/copy';
import { fillPlaceholders } from '../i18n/placeholders';
import { UploadFailed, uploadImage, type UploadedImage, type UploadStage } from './upload';

/**
 * One image upload, as a field holds it — shared by every control that takes a picture.
 *
 * The cover had this to itself until #271 gave the profile picture the same pipeline, and #313
 * gives it to the story's image blocks and to reward items. What the four have in common is
 * the part that is easy to get subtly wrong: a second file abandons the first rather than
 * racing it, a superseded upload never writes its stage over the current one, and leaving the
 * page stops the transfer. What they do NOT share is what happens with the result — a cover
 * keeps a media id, an avatar is saved at once, a story block and an item keep an address —
 * so this hands the image back and draws nothing.
 *
 * THE WORDS ARE THE COVER'S. `campaignEditor.cover` holds the three stage sentences and the
 * failure sentences for every code the service refuses an image with; they are about a file
 * and an image, not about a cover, and a second copy per field would be four translations of
 * one sentence free to drift. A field that needs a different sentence for one code — the
 * avatar's "still processing" — overrides that entry when its route resolves the copy.
 */

/** The service's floor, `MediaAsset.MINIMUM_EDGE`: below this on either side it answers `TOO_SMALL`. */
export const MEDIA_MINIMUM_EDGE = 320;

const MINIMUM = `${MEDIA_MINIMUM_EDGE}×${MEDIA_MINIMUM_EDGE}`;

/** What an upload has to be able to say. `CoverImageCopy` is one; every other field reuses it. */
export interface ImageUploadCopy {
  readonly stage: Readonly<Record<UploadStage, string>>;
  readonly notUsedTitle: string;
  readonly unusable: string;
  /** `TOO_SMALL` carries `{minimum}`, filled here with the service's floor. */
  readonly failures: CoverFailureCopy;
}

/**
 * The sentence for an upload that did not produce an image.
 *
 * Keyed on the service's code rather than rendering its sentence, because the sentence is
 * English for a log and this is read by somebody deciding what to do next. An unknown code
 * falls through to the service's own message: the deployment may refuse for a reason this
 * build has never heard of, and its sentence is better than silence. Anything that is not an
 * `UploadFailed` — a dropped connection, most realistically — is `unusable`, because the
 * browser's own message for it is English whatever the reader's language.
 */
export function describeUploadFailure(cause: unknown, copy: ImageUploadCopy): string {
  if (!(cause instanceof UploadFailed)) return copy.unusable;
  if (isKnownCode(cause.code, copy.failures)) {
    /*
     * The minimum is filled here and nowhere else. The cover rendered `{minimum}` literally
     * until this was shared, because its own code path never filled the one template among
     * the twelve.
     */
    return fillPlaceholders(copy.failures[cause.code], { minimum: MINIMUM });
  }
  return cause.message === '' ? copy.unusable : cause.message;
}

/**
 * Whether the copy has a sentence for this code. Asked of the copy rather than of
 * `COVER_FAILURE_CODES`, which is the same list: importing it puts the campaign editor's code
 * lists into `/settings/profile`, and that route's first-load budget has no room for them.
 */
function isKnownCode(code: string, failures: CoverFailureCopy): code is CoverFailureCode {
  return Object.prototype.hasOwnProperty.call(failures, code);
}

export interface ImageUpload {
  /** Where the current upload is, or `null` when nothing is being sent. */
  readonly stage: UploadStage | null;
  /**
   * Sends one file. Resolves with the ready image, or with `null` when the upload was
   * abandoned — superseded by another file, or the field left the page — in which case the
   * caller does nothing at all. Rejects with what `describeUploadFailure` explains.
   */
  readonly upload: (file: File) => Promise<UploadedImage | null>;
}

export function useImageUpload(): ImageUpload {
  const [stage, setStage] = useState<UploadStage | null>(null);
  /* Abandoning an upload when a different file is chosen, rather than racing it. */
  const inFlight = useRef<AbortController | null>(null);

  // A field that leaves the page takes its transfer with it, rather than finishing one whose
  // answer nothing is left to receive.
  useEffect(() => () => inFlight.current?.abort(), []);

  const upload = useCallback(async (file: File): Promise<UploadedImage | null> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const current = () => inFlight.current === controller;

    setStage('preparing');
    try {
      const image = await uploadImage(file, {
        signal: controller.signal,
        // A superseded upload can still report a stage on its way out; it is not the one shown.
        onStage: (next) => {
          if (current()) setStage(next);
        },
      });
      // Finished in the same moment another file was chosen: the newer one is what was meant.
      return controller.signal.aborted ? null : image;
    } catch (cause) {
      if (controller.signal.aborted) return null;
      throw cause;
    } finally {
      if (current()) {
        inFlight.current = null;
        setStage(null);
      }
    }
  }, []);

  return { stage, upload };
}
