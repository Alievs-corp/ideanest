import { ApiError } from '@ideanest/api-client';
import { File, Paths, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api, sendJson } from '../../api/client';

/**
 * A picture from this phone, to a servable image — the web's `lib/media/upload.ts` (#161, and
 * #162's cover image after it). Nothing here knows what the image is for: the caller decides what
 * to do with the URL.
 *
 * Converted to JPEG on the phone first, because an iPhone photo is HEIC and the transcoder does
 * not promise to read it. Then three calls and a poll, as on the web: `POST /v1/media/uploads`
 * issues a presigned address, the bytes go straight to object storage, and
 * `POST /v1/media/{id}/complete` says they are there.
 *
 * THE PUT CARRIES NO `Authorization`. The address is signed and belongs to another host: the
 * bearer token has no business there, and the store would refuse a header that is not part of
 * the signature. So it is a native file upload with only the signed `Content-Type`, never
 * `sendJson` or the session's `fetch`.
 *
 * <h2>Video (#331)</h2>
 *
 * `uploadVideo` is the same three calls and the same poll with a `video/*` type, which is what
 * makes the service open a VIDEO upload (a 250 MB ceiling instead of 20). Nothing is converted on
 * the phone — the picker already exported it, and the service transcodes every video to one
 * 720p MP4 regardless — so it starts at the address. The bytes report their progress
 * (`onProgress`), and the poll is longer and slower than an image's because a minute of video
 * takes about a minute to transcode.
 */

export type UploadStage = 'preparing' | 'uploading' | 'processing';

export interface UploadedImage {
  readonly mediaId: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** §13.1's small sample as a data URL, or `''` when the service sent none. */
  readonly blurDataUrl: string;
}

export interface UploadOptions {
  readonly onStage?: (stage: UploadStage) => void;
  readonly signal?: AbortSignal;
  /** The longest edge the JPEG is scaled down to before it leaves the phone. */
  readonly maxEdge?: number;
}

export interface UploadedVideo {
  readonly mediaId: string;
  /** The transcoded MP4. */
  readonly url: string;
  /** The still a page shows before the video plays. */
  readonly posterUrl: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  /** The poster's small sample as a data URL, or `''` when the service sent none. */
  readonly blurDataUrl: string;
}

export interface VideoUploadOptions {
  readonly onStage?: (stage: UploadStage) => void;
  /** The share of the bytes sent, from 0 to 1, while the stage is `uploading`. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
  /** The picker's MIME type for the file; inferred from its name when absent. */
  readonly mimeType?: string | null;
}

/**
 * What went wrong, as the service's `code` (or one of ours below). The caller picks the words;
 * `message` is the service's own sentence when it sent one, and `''` otherwise.
 *
 * Ours: `UPLOADS_UNAVAILABLE` (a 503 without a code), `UNREADABLE` (the phone could not convert
 * it), `UPLOAD_REFUSED`, `UPLOAD_TRANSFER_FAILED` (also every request that got no answer at all:
 * a dropped connection is not a fault of the file), `UPLOAD_UNFINISHED`, `MEDIA_NOT_FOUND` and
 * `UPLOAD_STILL_PROCESSING` — the same names the web's cover uploader has copy for.
 */
export class UploadFailed extends Error {
  readonly code: string;
  /**
   * The upload this is about, when the service has one: set on `UPLOAD_STILL_PROCESSING`, so a
   * caller can ask about it again (`resumeVideo`) instead of throwing away a file that may be a
   * moment from READY.
   */
  readonly mediaId: string | null;

  constructor(code: string, message = '', mediaId: string | null = null) {
    super(message);
    this.name = 'UploadFailed';
    this.code = code;
    this.mediaId = mediaId;
  }
}

/** Every 700ms for at most 90 seconds, the web's figures. */
export const POLL_INTERVAL_MS = 700;
export const POLL_LIMIT = Math.ceil(90_000 / POLL_INTERVAL_MS);

/** `MediaAsset.MINIMUM_EDGE`: below this on either side the service answers `TOO_SMALL`. */
export const MINIMUM_EDGE = 320;

/**
 * A video is asked about every 2 seconds for at most 5 minutes: the service's transcode of a
 * minute-long clip takes up to about a minute, and its own timeout is five.
 */
export const VIDEO_POLL_INTERVAL_MS = 2_000;
export const VIDEO_POLL_LIMIT = Math.ceil(300_000 / VIDEO_POLL_INTERVAL_MS);

/** `media.video.max-upload-bytes`: the service refuses a larger video with `TOO_LARGE`. */
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024;

/**
 * `media.video.max-duration` is 60 seconds, measured on the server. The picker's figure is the
 * container's, which can run a frame or two long, so the phone allows half a second over before
 * it refuses with `TOO_LONG` itself; anything really over is still refused by the service.
 */
export const VIDEO_MAX_DURATION_MS = 60_000;
export const VIDEO_DURATION_TOLERANCE_MS = 500;

/** Whether a picked video is over the minute, by the picker's own measurement. */
export function isVideoTooLong(durationMs: number | null | undefined): boolean {
  return typeof durationMs === 'number' && durationMs > VIDEO_MAX_DURATION_MS + VIDEO_DURATION_TOLERANCE_MS;
}

/** Whether a picked file is over the service's video ceiling, by the picker's own measurement. */
export function isVideoTooLarge(byteSize: number | null | undefined): boolean {
  return typeof byteSize === 'number' && byteSize > VIDEO_MAX_BYTES;
}

const DEFAULT_MAX_EDGE = 2048;
const JPEG = 'image/jpeg';

export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}

export async function uploadImage(
  sourceUri: string,
  options: UploadOptions = {},
): Promise<UploadedImage> {
  const { onStage, signal, maxEdge = DEFAULT_MAX_EDGE } = options;

  onStage?.('preparing');
  const jpegUri = await toJpeg(sourceUri, maxEdge);
  const file = new File(jpegUri);
  try {
    throwIfAborted(signal);
    const ticket = await requestAddress(JPEG, file.size, signal);

    onStage?.('uploading');
    await putBytes(file, ticket, signal);

    onStage?.('processing');
    await announceArrival(ticket.mediaId, signal);
    return await waitUntilReady(ticket.mediaId, readImage, POLL_INTERVAL_MS, POLL_LIMIT, signal);
  } finally {
    // The JPEG is this helper's own cache copy. The picked file is the caller's to remove.
    try {
      file.delete();
    } catch {
      // Already gone, or never written: nothing to tidy.
    }
  }
}

/**
 * A video from this phone, to a playable MP4 and its poster (#331). The picked file is sent as it
 * is; the caller removes it afterwards (`forgetPicked`), since a minute of video is not something
 * to leave in the cache.
 *
 * Refuses a file over {@link VIDEO_MAX_BYTES} with `TOO_LARGE` before asking for an address, so a
 * creator is not made to wait for a few hundred megabytes the service will turn away.
 */
export async function uploadVideo(
  sourceUri: string,
  options: VideoUploadOptions = {},
): Promise<UploadedVideo> {
  const { onStage, onProgress, signal, mimeType } = options;

  onStage?.('preparing');
  const file = new File(sourceUri);
  let byteSize: number;
  try {
    byteSize = file.size;
  } catch {
    throw new UploadFailed('UNREADABLE');
  }
  if (!(byteSize > 0)) throw new UploadFailed('EMPTY');
  if (isVideoTooLarge(byteSize)) throw new UploadFailed('TOO_LARGE');
  throwIfAborted(signal);
  const ticket = await requestAddress(videoTypeOf(sourceUri, mimeType), byteSize, signal);

  onStage?.('uploading');
  onProgress?.(0);
  await putBytes(file, ticket, signal, onProgress);

  onStage?.('processing');
  await announceArrival(ticket.mediaId, signal);
  return await waitUntilReady(ticket.mediaId, readVideo, VIDEO_POLL_INTERVAL_MS, VIDEO_POLL_LIMIT, signal);
}

/**
 * Asks about a video already uploaded again — after `uploadVideo` gave up with
 * `UPLOAD_STILL_PROCESSING` (its `mediaId` is on the error). The same poll, from the start of its
 * five minutes; reports `processing`.
 */
export async function resumeVideo(
  mediaId: string,
  options: Pick<VideoUploadOptions, 'onStage' | 'signal'> = {},
): Promise<UploadedVideo> {
  options.onStage?.('processing');
  return await waitUntilReady(mediaId, readVideo, VIDEO_POLL_INTERVAL_MS, VIDEO_POLL_LIMIT, options.signal);
}

const VIDEO_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
};

/**
 * The type to declare: the picker's, when it is a video type, else one read from the file's
 * extension, else `video/mp4`. Only the `video/` prefix matters to the service — it decides the
 * kind of upload — and the transcoder reads the bytes, not the label.
 */
export function videoTypeOf(uri: string, mimeType?: string | null): string {
  const declared = mimeType?.trim().toLowerCase() ?? '';
  if (declared.startsWith('video/')) return declared;
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/iu.exec(uri)?.[1]?.toLowerCase() ?? '';
  return VIDEO_TYPES[extension] ?? 'video/mp4';
}

/**
 * Deletes a file the picker copied into this app's cache. Anything outside the cache is not this
 * app's to delete, and is left alone.
 */
export function forgetPicked(uri: string): void {
  try {
    const cache = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : `${Paths.cache.uri}/`;
    if (uri.startsWith(cache)) new File(uri).delete();
  } catch {
    // Already gone: nothing to tidy.
  }
}

async function toJpeg(uri: string, maxEdge: number): Promise<string> {
  try {
    let image = await ImageManipulator.manipulate(uri).renderAsync();
    if (Math.max(image.width, image.height) > maxEdge) {
      const context = ImageManipulator.manipulate(image);
      image = await (
        image.width >= image.height
          ? context.resize({ width: maxEdge })
          : context.resize({ height: maxEdge })
      ).renderAsync();
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    return saved.uri;
  } catch {
    throw new UploadFailed('UNREADABLE');
  }
}

interface Ticket {
  readonly mediaId: string;
  readonly uploadUrl: string;
  readonly contentType: string;
}

async function requestAddress(contentType: string, byteSize: number, signal?: AbortSignal): Promise<Ticket> {
  let body: unknown;
  try {
    // The size is this phone's word; the service measures the bytes again on arrival.
    body = await sendJson('POST', '/v1/media/uploads', { contentType, byteSize });
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw refusal(cause, 'UPLOAD_REFUSED');
  }
  throwIfAborted(signal);
  const ticket = body as { mediaId?: unknown; uploadUrl?: unknown; contentType?: unknown } | null;
  if (typeof ticket?.mediaId !== 'string' || typeof ticket.uploadUrl !== 'string') {
    throw new UploadFailed('UPLOAD_REFUSED');
  }
  return {
    mediaId: ticket.mediaId,
    uploadUrl: ticket.uploadUrl,
    // The type the service SIGNED; anything else is a signature mismatch at the store.
    contentType: typeof ticket.contentType === 'string' ? ticket.contentType : contentType,
  };
}

async function putBytes(
  file: File,
  ticket: Ticket,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  let status: number;
  try {
    const result = await file.upload(ticket.uploadUrl, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': ticket.contentType },
      // The address expires in minutes; there is no reason to hand it to a background session.
      sessionType: 'foreground',
      ...(signal === undefined ? {} : { signal }),
      ...(onProgress === undefined
        ? {}
        : {
            onProgress: ({ bytesSent, totalBytes }: { bytesSent: number; totalBytes: number }) => {
              if (totalBytes > 0) onProgress(Math.min(1, Math.max(0, bytesSent / totalBytes)));
            },
          }),
    });
    status = result.status;
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw new UploadFailed('UPLOAD_TRANSFER_FAILED');
  }
  if (status < 200 || status >= 300) throw new UploadFailed('UPLOAD_TRANSFER_FAILED');
}

async function announceArrival(mediaId: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  try {
    // Safe to repeat: the service answers the current state for anything past PENDING.
    await sendJson('POST', `/v1/media/${encodeURIComponent(mediaId)}/complete`);
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw refusal(cause, 'UPLOAD_UNFINISHED');
  }
}

/** What one poll answered: `GET /v1/media/{mediaId}`'s body. */
type MediaState = Awaited<ReturnType<typeof fetchMedia>>;

function fetchMedia(mediaId: string, signal?: AbortSignal) {
  return api().get('/v1/media/{mediaId}', {
    path: { mediaId },
    ...(signal === undefined ? {} : { signal }),
  });
}

/** A READY answer as the caller's result, or `null` when it lacks something the caller needs. */
type ReadyReader<T> = (state: MediaState, mediaId: string) => T | null;

const readImage: ReadyReader<UploadedImage> = (state, mediaId) =>
  typeof state.url === 'string' && typeof state.width === 'number' && typeof state.height === 'number'
    ? {
        mediaId: state.id ?? mediaId,
        url: state.url,
        width: state.width,
        height: state.height,
        blurDataUrl: state.blurDataUrl ?? '',
      }
    : null;

const readVideo: ReadyReader<UploadedVideo> = (state, mediaId) =>
  typeof state.url === 'string' &&
  typeof state.posterUrl === 'string' &&
  typeof state.width === 'number' &&
  typeof state.height === 'number' &&
  typeof state.durationMs === 'number'
    ? {
        mediaId: state.id ?? mediaId,
        url: state.url,
        posterUrl: state.posterUrl,
        width: state.width,
        height: state.height,
        durationMs: state.durationMs,
        blurDataUrl: state.blurDataUrl ?? '',
      }
    : null;

async function waitUntilReady<T>(
  mediaId: string,
  read: ReadyReader<T>,
  interval: number,
  limit: number,
  signal?: AbortSignal,
): Promise<T> {
  let lastWasUnreachable = false;
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (attempt > 0) await pause(interval, signal);
    throwIfAborted(signal);
    let state: MediaState;
    try {
      state = await fetchMedia(mediaId, signal);
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      // A dropped connection or a 5xx on one poll is asked again on the next tick.
      if (isTransient(cause)) {
        lastWasUnreachable = !(cause instanceof ApiError);
        continue;
      }
      throw refusal(cause, 'MEDIA_NOT_FOUND');
    }
    lastWasUnreachable = false;

    if (state.status === 'READY') {
      const ready = read(state, mediaId);
      if (ready !== null) return ready;
    }
    if (state.status === 'FAILED') throw new UploadFailed(state.failureReason ?? 'UNREADABLE');
  }
  // Not the file's fault: the connection went, or it is still being worked on.
  throw lastWasUnreachable
    ? new UploadFailed('UPLOAD_TRANSFER_FAILED')
    : new UploadFailed('UPLOAD_STILL_PROCESSING', '', mediaId);
}

/** No answer at all, or a server-side failure: worth asking again. */
function isTransient(cause: unknown): boolean {
  return !(cause instanceof ApiError) || cause.status >= 500;
}

/**
 * A refusal as one of ours: the service's `code`, else 503's "unavailable", else `fallback`.
 * A request that got no answer is the connection's fault, never the file's.
 */
function refusal(cause: unknown, fallback: string): UploadFailed {
  if (cause instanceof ApiError) {
    const code = cause.problem?.code;
    if (typeof code === 'string' && code !== '') {
      return new UploadFailed(code, cause.problem?.detail ?? '');
    }
    if (cause.status === 503) return new UploadFailed('UPLOADS_UNAVAILABLE');
    return new UploadFailed(fallback, cause.problem?.detail ?? '');
  }
  return new UploadFailed('UPLOAD_TRANSFER_FAILED');
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError();
}

/**
 * Waits, or rejects at once when `signal` aborts. The abort listener is removed when the wait ends:
 * a 5-minute video poll is 150 of these on one signal, and each left behind would hold its closure
 * until the signal itself is collected.
 */
function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
