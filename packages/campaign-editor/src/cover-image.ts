/**
 * The cover image guidance — §5.3's 1024×576, as advice.
 *
 * WHAT CHANGED. §5.3's 1024×576 used to refuse a submission and is now advice — see
 * `ChecklistRequirement.COVER_IMAGE_SIZE` for both reasons, the short version being that the
 * number came from a browser and so caught the honest and missed everybody else, and that it
 * stopped creators at the first screen of the editor on a platform with nowhere to upload a
 * larger file.
 *
 * ONLY THE RULE IS HERE. How an image is measured is each client's own: the web loads it into
 * an `HTMLImageElement` (`apps/web/src/lib/projects/coverImage.ts`, which also takes the blur
 * placeholder from the same load), and the app asks React Native's `Image.getSize`. Both
 * produce an {@link ImageSize}, and both ask this module what it means.
 */

export const COVER_MIN_WIDTH = 1024;
export const COVER_MIN_HEIGHT = 576;

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * 16:9 at the recommended size, which is the aspect the discovery card is cut to.
 *
 * ADVICE, NOT A GATE. A cover below this is saved and the campaign is submittable; what it
 * earns is a note in the editor and an advisory row on the checklist.
 */
export function meetsCoverMinimum(size: ImageSize): boolean {
  return size.width >= COVER_MIN_WIDTH && size.height >= COVER_MIN_HEIGHT;
}

/** `1024×576` — the size as the editor's sentences quote it. */
export function describeSize(size: ImageSize): string {
  return `${size.width}×${size.height}`;
}
