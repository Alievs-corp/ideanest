/**
 * How long a chosen video runs, read in the browser before a byte of it is uploaded — #331.
 *
 * A detached `<video preload="metadata">` pointed at an object URL for the file. The browser
 * reads the container's header from the local disk and reports `duration`; nothing is decoded,
 * nothing is sent, and the element is never attached to the document. It exists so that a
 * creator holding a ninety-second clip hears "trim it" now rather than after a ten-minute upload
 * — the service measures the length again and refuses with `TOO_LONG` either way.
 *
 * <h2>`null` is an answer, and it means "let the service decide"</h2>
 *
 * Three ordinary things produce it. A codec this browser cannot parse — Chrome on Windows with
 * an HEVC `.mov` from an iPhone — fires `error` on a file the service's ffmpeg transcodes
 * happily. A WebM straight out of `MediaRecorder` has no duration in its header and reports
 * `Infinity` until somebody seeks to the end. And a header the browser does not finish reading
 * within the time allowed. None of those is a reason to refuse the file, so none of them is
 * reported as one; the caller treats an unknown length as worth uploading.
 */

/** How long to wait for the header before giving up and letting the service measure it. */
const METADATA_TIMEOUT_MS = 10_000;

export function readVideoDuration(file: Blob, signal?: AbortSignal): Promise<number | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const address = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    /*
     * Every exit releases the file. An object URL keeps the whole Blob alive for as long as the
     * document does, and for a 200MB clip that is 200MB held for nothing after the one number
     * this wanted has been read.
     */
    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(address);
      outcome();
    };
    const onAbort = (): void => finish(() => reject(new DOMException('Aborted', 'AbortError')));
    const timer = setTimeout(() => finish(() => resolve(null)), METADATA_TIMEOUT_MS);

    video.preload = 'metadata';
    video.muted = true;
    video.addEventListener('loadedmetadata', () => {
      const seconds = video.duration;
      const known = Number.isFinite(seconds) && seconds > 0;
      finish(() => resolve(known ? Math.round(seconds * 1000) : null));
    });
    video.addEventListener('error', () => finish(() => resolve(null)));
    signal?.addEventListener('abort', onAbort, { once: true });

    video.src = address;
  });
}
