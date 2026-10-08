/**
 * Uploading the campaign video — issue #331, docs/architecture.md §13.2.
 *
 * §13.1's three calls, borrowed from `./upload.ts` — a presigned address, the bytes straight to
 * the bucket, `complete` — and a poll, declared with a `video/*` type so the service treats the
 * upload as a video. It differs from the image path in two places, and each is a reason it has
 * its own entry point. The PUT goes through `XMLHttpRequest`, because a 200MB transfer is minutes
 * on a phone connection and `fetch` has no upload progress to show for them. And it is polled for
 * minutes rather than seconds, because the server transcodes it with two threads on a shared
 * host.
 *
 * A separate module from `./upload.ts` for the bundle's sake: the cover field is on four editor
 * routes and this one is on one, and a module is shipped whole.
 */

import {
  UploadFailed,
  announceArrival,
  pause,
  readState,
  requestAddress,
  type UploadOptions,
  type UploadTicket,
} from './upload';


/** What the editor gets back once the video has been transcoded. */
export interface UploadedVideo {
  mediaId: string;
  /** The H.264 MP4 a plain `<video>` element plays. */
  url: string;
  posterUrl: string;
  width: number;
  height: number;
  durationMs: number;
  blurDataUrl: string | null;
}

export interface VideoUploadOptions extends UploadOptions {
  /**
   * The `video/*` type to declare. The caller's, because a `.mov` arrives from some browsers
   * with no type at all and `@ideanest/campaign-editor/video` reads it from the extension.
   */
  contentType: string;
  /** How much of the file has reached storage, from 0 to 1. Only during `uploading`. */
  onProgress?: (fraction: number) => void;
}

/**
 * Every two seconds for at most five minutes.
 *
 * The video sweep runs every five seconds and takes one video a pass, and a sixty-second clip
 * takes up to about a minute to transcode on the shared host (§13.2) — so the ordinary answer
 * arrives within the first thirty polls, and the image's 700ms would be a request a second
 * spent learning nothing. Five minutes is the ceiling for a creator who uploaded behind two
 * others; past it they are told the truth rather than left watching a spinner.
 */
const VIDEO_POLL_INTERVAL_MS = 2_000;
const VIDEO_POLL_LIMIT = Math.ceil(300_000 / VIDEO_POLL_INTERVAL_MS);

/**
 * The poll ran out with the clip still converting — which is not the clip failing.
 *
 * It carries the upload, because the bytes are on the server and the transcode is in its queue:
 * {@link resumeVideo} waits on the same upload again, and a creator is never asked to send a
 * 200MB file twice because the server was busy.
 */
export class VideoStillProcessing extends UploadFailed {
  readonly mediaId: string;

  constructor(mediaId: string) {
    super('UPLOAD_STILL_PROCESSING', '');
    this.name = 'VideoStillProcessing';
    this.mediaId = mediaId;
  }
}

export async function uploadVideo(file: File, options: VideoUploadOptions): Promise<UploadedVideo> {
  const { onStage, onProgress, signal, contentType } = options;

  onStage?.('preparing');
  const ticket = await requestAddress(contentType, file.size, signal);

  onStage?.('uploading');
  await sendWithProgress(ticket, file, onProgress, signal);

  onStage?.('processing');
  await announceArrival(ticket.mediaId, signal);

  return await waitForVideo(ticket.mediaId, signal);
}

/**
 * The PUT, through `XMLHttpRequest` for its upload progress.
 *
 * The same request `putBytes` makes — the signed type and nothing else, no `Authorization`
 * header, no cookies (`withCredentials` stays false) — so the store sees no difference. Aborting
 * the signal aborts the transfer itself, not merely the wait for it: a creator who cancels a
 * 200MB upload on a metered connection means stop sending.
 */
function sendWithProgress(
  ticket: UploadTicket,
  file: File,
  onProgress: ((fraction: number) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const request = new XMLHttpRequest();
    const abort = (): void => request.abort();
    const failed = (): void => reject(new UploadFailed('UPLOAD_TRANSFER_FAILED', ''));

    request.open('PUT', ticket.uploadUrl);
    request.setRequestHeader('Content-Type', ticket.contentType);

    request.upload.onprogress = (event) => {
      // Some stacks report no total. The file's own size is the same number.
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      if (total > 0) onProgress?.(Math.min(1, event.loaded / total));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        failed();
      }
    };
    request.onerror = failed;
    request.ontimeout = failed;
    request.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    request.onloadend = () => signal?.removeEventListener('abort', abort);

    signal?.addEventListener('abort', abort, { once: true });
    request.send(file);
  });
}

/** Waits on an upload that outlasted an earlier poll, for another five minutes at most. */
export function resumeVideo(
  mediaId: string,
  options: { signal?: AbortSignal } = {},
): Promise<UploadedVideo> {
  return waitForVideo(mediaId, options.signal);
}

async function waitForVideo(mediaId: string, signal?: AbortSignal): Promise<UploadedVideo> {
  for (let attempt = 0; attempt < VIDEO_POLL_LIMIT; attempt += 1) {
    const state = await readState(mediaId, signal);

    if (state.status === 'READY') {
      const { url, posterUrl, width, height, durationMs } = state;
      /*
       * V94 holds all five on a ready video. A row that reports ready without them is a
       * deployment this build does not understand, and attaching it would put a player on the
       * campaign page with nothing to play — so it is a refusal here rather than a broken page.
       */
      if (
        url == null ||
        posterUrl == null ||
        width == null ||
        height == null ||
        durationMs == null
      ) {
        throw new UploadFailed('UNREADABLE', '');
      }
      return {
        mediaId: state.id,
        url,
        posterUrl,
        width,
        height,
        durationMs,
        blurDataUrl: state.blurDataUrl ?? null,
      };
    }
    if (state.status === 'FAILED') {
      // The code alone: the field has the words for every reason, `TOO_LONG` included.
      throw new UploadFailed(state.failureReason ?? 'UNREADABLE', '');
    }
    await pause(VIDEO_POLL_INTERVAL_MS, signal);
  }

  throw new VideoStillProcessing(mediaId);
}
