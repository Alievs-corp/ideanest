import { ApiError } from '@ideanest/api-client';
import { File, UploadType } from 'expo-file-system';
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

/**
 * What went wrong, as the service's `code` (or one of ours below). The caller picks the words;
 * `message` is the service's own sentence when it sent one, and `''` otherwise.
 *
 * Ours: `UPLOADS_UNAVAILABLE` (a 503 without a code), `UNREADABLE` (the phone could not convert
 * it), `UPLOAD_REFUSED`, `UPLOAD_TRANSFER_FAILED`, `UPLOAD_UNFINISHED`, `MEDIA_NOT_FOUND` and
 * `UPLOAD_STILL_PROCESSING` — the same names the web's cover uploader has copy for.
 */
export class UploadFailed extends Error {
  readonly code: string;

  constructor(code: string, message = '') {
    super(message);
    this.name = 'UploadFailed';
    this.code = code;
  }
}

/** Every 700ms for at most 90 seconds, the web's figures. */
export const POLL_INTERVAL_MS = 700;
export const POLL_LIMIT = Math.ceil(90_000 / POLL_INTERVAL_MS);

/** `MediaAsset.MINIMUM_EDGE`: below this on either side the service answers `TOO_SMALL`. */
export const MINIMUM_EDGE = 320;

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
    const ticket = await requestAddress(file.size, signal);

    onStage?.('uploading');
    await putBytes(file, ticket, signal);

    onStage?.('processing');
    await announceArrival(ticket.mediaId, signal);
    return await waitUntilReady(ticket.mediaId, signal);
  } finally {
    // The JPEG is a copy in the cache; the original stays where the picker found it.
    try {
      file.delete();
    } catch {
      // Already gone, or never written: nothing to tidy.
    }
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

async function requestAddress(byteSize: number, signal?: AbortSignal): Promise<Ticket> {
  let body: unknown;
  try {
    // The size is this phone's word; the service measures the bytes again on arrival.
    body = await sendJson('POST', '/v1/media/uploads', { contentType: JPEG, byteSize });
  } catch (cause) {
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
    contentType: typeof ticket.contentType === 'string' ? ticket.contentType : JPEG,
  };
}

async function putBytes(file: File, ticket: Ticket, signal?: AbortSignal): Promise<void> {
  let status: number;
  try {
    const result = await file.upload(ticket.uploadUrl, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': ticket.contentType },
      // The address expires in minutes; there is no reason to hand it to a background session.
      sessionType: 'foreground',
      ...(signal === undefined ? {} : { signal }),
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
    throw refusal(cause, 'UPLOAD_UNFINISHED');
  }
}

async function waitUntilReady(mediaId: string, signal?: AbortSignal): Promise<UploadedImage> {
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    throwIfAborted(signal);
    let state;
    try {
      state = await api().get('/v1/media/{mediaId}', {
        path: { mediaId },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw refusal(cause, 'MEDIA_NOT_FOUND');
    }

    if (
      state.status === 'READY' &&
      typeof state.url === 'string' &&
      typeof state.width === 'number' &&
      typeof state.height === 'number'
    ) {
      return {
        mediaId: state.id ?? mediaId,
        url: state.url,
        width: state.width,
        height: state.height,
        blurDataUrl: state.blurDataUrl ?? '',
      };
    }
    if (state.status === 'FAILED') throw new UploadFailed(state.failureReason ?? 'UNREADABLE');
    await pause(POLL_INTERVAL_MS, signal);
  }
  // Not the image's fault: it is still being worked on, and may appear later.
  throw new UploadFailed('UPLOAD_STILL_PROCESSING');
}

/** A refusal as one of ours: the service's `code`, else 503's "unavailable", else `fallback`. */
function refusal(cause: unknown, fallback: string): UploadFailed {
  if (cause instanceof ApiError) {
    const code = cause.problem?.code;
    if (typeof code === 'string' && code !== '') {
      return new UploadFailed(code, cause.problem?.detail ?? '');
    }
    if (cause.status === 503) return new UploadFailed('UPLOADS_UNAVAILABLE');
    return new UploadFailed(fallback, cause.problem?.detail ?? '');
  }
  return new UploadFailed(fallback);
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError();
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}
