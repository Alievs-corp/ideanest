/**
 * How the browser measures an image it is given.
 *
 * The guidance itself — §5.3's 1024×576, `meetsCoverMinimum`, `describeSize` — is
 * `@ideanest/campaign-editor/cover-image` since #162, shared with the app. What stays here is
 * the part only a browser can do.
 *
 * WHAT THIS MODULE IS FOR. An address a creator pastes: nothing on the server has seen that
 * image, so the browser remains the only place its intrinsic size can be read. For an upload
 * it is not used at all — `lib/media/upload.ts` gets the dimensions the server measured, along
 * with §13.1's blur placeholder.
 */

import type { ImageSize } from '@ideanest/campaign-editor/cover-image';
import { placeholderFrom } from '../images/lqip';

/**
 * A measurement, plus the blur placeholder taken from the same load.
 *
 * The placeholder is `null` far more often than not, and that is by design
 * rather than by failure — `lib/images/lqip.ts` says exactly when and why. A
 * cover without one still reserves its box; the box comes from the dimensions,
 * not from the placeholder.
 */
export interface MeasuredImage extends ImageSize {
  placeholder: string | null;
}

/**
 * Loads an image once and reports what that load can be asked.
 *
 * `naturalWidth` and `naturalHeight` rather than `width`/`height`: the latter
 * pair report the layout box, which for an image that never entered the
 * document is zero, and a cover silently recorded as 0×0 would fail the
 * checklist for a reason nobody could see.
 *
 * `cors` decides whether the pixels can be read back. Intrinsic dimensions are
 * readable from any image; PIXEL DATA IS NOT — drawing a cross-origin image
 * onto a canvas taints it unless the request carried `crossOrigin` and the host
 * answered with the CORS header. Requesting it is therefore the only way to get
 * a placeholder, and it is also a way to make an image that would have loaded
 * fail outright, on every host that does not send the header. Hence two
 * attempts rather than one flag.
 */
function loadImage(src: string, cors: boolean): Promise<MeasuredImage> {
  return new Promise<MeasuredImage>((resolve, reject) => {
    const image = new Image();
    if (cors) image.crossOrigin = 'anonymous';

    image.onload = () =>
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        placeholder: placeholderFrom(image),
      });

    image.onerror = () => reject(new Error('load failed'));

    image.src = src;
  });
}

/**
 * Reads the intrinsic pixel size of an image, and its blur placeholder when the
 * host allows the pixels to be read.
 *
 * A URL is tried with CORS first and retried without it, so a host that sends
 * the header gets a placeholder and a host that does not still gets measured.
 * The retry costs a second request only on the path where the first one failed,
 * which is a load the browser has usually already cached the response headers
 * for. A local file needs no retry: a blob URL is same-origin by definition.
 */
export async function measureImage(source: string | File): Promise<MeasuredImage> {
  if (typeof source !== 'string') {
    const objectUrl = URL.createObjectURL(source);
    try {
      return await loadImage(objectUrl, false);
    } catch {
      throw new Error('That file could not be read as an image.');
    } finally {
      // The blob URL holds the whole file in memory until it is revoked, and a
      // creator trying four photographs would otherwise leak all four.
      URL.revokeObjectURL(objectUrl);
    }
  }

  try {
    return await loadImage(source, true);
  } catch {
    try {
      return await loadImage(source, false);
    } catch {
      throw new Error('That address could not be loaded as an image.');
    }
  }
}
