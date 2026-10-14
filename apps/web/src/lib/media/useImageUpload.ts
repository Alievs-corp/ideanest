'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageUploadCopy } from '@ideanest/campaign-editor/copy';
import type { UploadedImage, UploadStage } from './upload';

/**
 * One image upload, as a field holds it — shared by every control that takes a picture.
 *
 * The cover had this to itself until #271 gave the profile picture the same pipeline, and #313
 * gives it to the story's image blocks and to reward items. What the four have in common is
 * the part that is easy to get subtly wrong: a second file abandons the first rather than
 * racing it, a superseded upload never writes its stage over the current one, and leaving the
 * page stops the transfer. What they do NOT share is what happens with the result — a cover
 * keeps a media id, an avatar is saved at once, a story block and an item keep an address —
 * so this hands back the image, or the sentence for why there is none, and draws nothing.
 *
 * THE TRANSFER IS LOADED WHEN A FILE IS CHOSEN, not with the page: `./imageTransfer` says
 * why. The import happens while the field already says "Preparing the image…", so it is not a
 * wait anybody sees on its own.
 *
 * THE WORDS ARE THE COVER'S, as `ImageUploadCopy` in `@ideanest/campaign-editor/copy`: the
 * stage sentences and a sentence for every code the service refuses an image with. A field
 * that needs a different sentence for one code — the avatar's "still processing" — overrides
 * that entry when its route resolves the copy.
 */

/** A finished upload: the image, or the sentence a person reads instead of one. */
export type ImageUploadResult =
  | { readonly image: UploadedImage }
  | { readonly refusal: string };

export interface ImageUpload {
  /** Where the current upload is, or `null` when nothing is being sent. */
  readonly stage: UploadStage | null;
  /**
   * Sends one file. Resolves with `null` when the upload was abandoned — superseded by another
   * file, or the field left the page — in which case the caller does nothing at all.
   */
  readonly upload: (file: File) => Promise<ImageUploadResult | null>;
}

type Transfer = typeof import('./imageTransfer');

/** Fetched once for every field on the page, and only when a file is first chosen. */
let transfer: Promise<Transfer> | null = null;

function loadTransfer(): Promise<Transfer> {
  // A failed fetch is forgotten, so the next file tries again rather than failing for ever.
  transfer ??= import('./imageTransfer').catch((cause: unknown) => {
    transfer = null;
    throw cause;
  });
  return transfer;
}

export function useImageUpload(copy: ImageUploadCopy): ImageUpload {
  const [stage, setStage] = useState<UploadStage | null>(null);
  /* Abandoning an upload when a different file is chosen, rather than racing it. */
  const inFlight = useRef<AbortController | null>(null);

  // A field that leaves the page takes its transfer with it, rather than finishing one whose
  // answer nothing is left to receive.
  useEffect(() => () => inFlight.current?.abort(), []);

  const upload = useCallback(
    async (file: File): Promise<ImageUploadResult | null> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const current = () => inFlight.current === controller;

      setStage('preparing');
      try {
        let loaded: Transfer;
        try {
          loaded = await loadTransfer();
        } catch {
          // The code that sends the file did not arrive, which is a connection problem.
          return controller.signal.aborted ? null : { refusal: copy.unusable };
        }
        // Superseded while the module loaded: the newer file is already on its way.
        if (controller.signal.aborted) return null;

        try {
          const image = await loaded.uploadImage(file, {
            signal: controller.signal,
            // A superseded upload can still report a stage on its way out; it is not the one shown.
            onStage: (next) => {
              if (current()) setStage(next);
            },
          });
          // Finished in the same moment another file was chosen: the newer one is what was meant.
          return controller.signal.aborted ? null : { image };
        } catch (cause) {
          if (controller.signal.aborted) return null;
          return { refusal: loaded.describeUploadFailure(cause, copy) };
        }
      } finally {
        if (current()) {
          inFlight.current = null;
          setStage(null);
        }
      }
    },
    [copy],
  );

  return { stage, upload };
}
