/**
 * Uploading an image, from the creator's file to a servable one.
 *
 * Three calls and a poll, and the bytes go to object storage rather than through the API —
 * `POST /v1/media/uploads` issues a presigned address, the browser writes to it, and
 * `POST /v1/media/{id}/complete` says the bytes are there. See docs/architecture.md §13.1 and
 * the media pipeline design of 2026-08-30.
 *
 * WHY THE PUT IS A BARE `fetch` AND NOT `authorizedFetch`. The address is signed and goes to
 * a different origin; attaching this platform's bearer token to it would send a credential to
 * a host that has no business seeing one, and the store would reject the request for carrying
 * an `Authorization` header that is not part of the signature.
 */

import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/** What the editor gets back once the image exists. */
export interface UploadedImage {
  mediaId: string;
  url: string;
  width: number;
  height: number;
  /** §13.1's sixteen-pixel sample, as a data URL. Always present on a ready image. */
  blurDataUrl: string;
}

/**
 * How far along an upload is, for a control that has to say something while it waits.
 *
 * `processing` is a real and separate state rather than a rounding of `uploading` to 99%: the
 * bytes have arrived and libvips has not run yet, and on a large photograph that gap is
 * seconds. A progress bar that sat at 100% through it would look stuck.
 */
export type UploadStage = 'preparing' | 'uploading' | 'processing';

export interface UploadOptions {
  onStage?: (stage: UploadStage) => void;
  signal?: AbortSignal;
}

/**
 * What the server said went wrong, as a code rather than a sentence.
 *
 * The words a creator reads are chosen by the caller. A message assembled here would be one
 * that cannot be translated, and the editor is a surface that will be.
 */
export class UploadFailed extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UploadFailed';
    this.code = code;
  }
}

interface UploadTicket {
  mediaId: string;
  uploadUrl: string;
  contentType: string;
  expiresAt: string;
  maxBytes: number;
}

interface MediaState {
  id: string;
  status: 'PENDING' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
  url: string | null;
  width: number | null;
  height: number | null;
  blurDataUrl: string | null;
  failureReason: string | null;
}

/**
 * How long to keep asking, and how often.
 *
 * Every 700ms for at most 90 seconds. The sweep runs every five seconds and a conversion is a
 * second or two, so the ordinary answer arrives within the first two or three polls; the
 * ceiling exists so that a creator whose upload is stuck behind a backlog is eventually told
 * something rather than watching a spinner forever.
 */
const POLL_INTERVAL_MS = 700;
const POLL_LIMIT = Math.ceil(90_000 / POLL_INTERVAL_MS);

export async function uploadImage(file: File, options: UploadOptions = {}): Promise<UploadedImage> {
  const { onStage, signal } = options;

  onStage?.('preparing');
  const ticket = await requestAddress(file, signal);

  onStage?.('uploading');
  await putBytes(ticket, file, signal);

  onStage?.('processing');
  await announceArrival(ticket.mediaId, signal);

  return await waitUntilReady(ticket.mediaId, signal);
}

async function requestAddress(file: File, signal?: AbortSignal): Promise<UploadTicket> {
  const response = await authorizedFetch('/v1/media/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    /*
     * Both fields are this browser's word and the server treats them as such. The type is
     * signed into the address so a leaked URL cannot be used for something else; the size is
     * checked before an address is issued so that a creator is told about a 40MB file now
     * rather than after uploading it. Neither is believed — the bytes are measured on arrival.
     */
    body: JSON.stringify({ contentType: file.type || 'application/octet-stream', byteSize: file.size }),
    signal,
  });

  if (!response.ok) throw await refusal(response, 'UPLOAD_REFUSED');
  return (await response.json()) as UploadTicket;
}

async function putBytes(ticket: UploadTicket, file: File, signal?: AbortSignal): Promise<void> {
  const response = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    /*
     * THE TYPE THE SERVER SIGNED, not `file.type`. The two differ whenever the browser
     * reported something that is not an image type, and sending our own value instead would
     * have the store refuse the upload as a signature mismatch — which looks like a
     * credentials problem and is not.
     */
    headers: { 'content-type': ticket.contentType },
    body: file,
    signal,
  });

  if (!response.ok) {
    throw new UploadFailed('UPLOAD_TRANSFER_FAILED', 'The image could not be sent to storage.');
  }
}

async function announceArrival(mediaId: string, signal?: AbortSignal): Promise<void> {
  // Safe to repeat: the server refuses the transition from anything but PENDING and answers
  // with the current state, so a retry after a dropped response does not queue a second pass.
  const response = await authorizedFetch(`/v1/media/${mediaId}/complete`, { method: 'POST', signal });
  if (!response.ok) throw await refusal(response, 'UPLOAD_UNFINISHED');
}

async function waitUntilReady(mediaId: string, signal?: AbortSignal): Promise<UploadedImage> {
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    const state = await readState(mediaId, signal);

    if (state.status === 'READY' && state.url !== null && state.width !== null && state.height !== null) {
      return {
        mediaId: state.id,
        url: state.url,
        width: state.width,
        height: state.height,
        blurDataUrl: state.blurDataUrl ?? '',
      };
    }
    if (state.status === 'FAILED') {
      throw new UploadFailed(state.failureReason ?? 'UNREADABLE', 'That image could not be processed.');
    }
    await pause(POLL_INTERVAL_MS, signal);
  }

  // Not a failure of the image. The row is still being worked on, or is behind a backlog, and
  // the creator can come back to it -- so this says that rather than blaming the file.
  throw new UploadFailed('UPLOAD_STILL_PROCESSING', 'That image is taking longer than expected.');
}

async function readState(mediaId: string, signal?: AbortSignal): Promise<MediaState> {
  const response = await authorizedFetch(`/v1/media/${mediaId}`, { signal });
  if (!response.ok) throw await refusal(response, 'MEDIA_NOT_FOUND');
  return (await response.json()) as MediaState;
}

/**
 * The server's refusal, as one of ours.
 *
 * The `code` is what the caller branches on and what a translated message is looked up from.
 * The message is whatever the SERVER said and nothing else: it used to fall back to an
 * English sentence written here, which reached a creator's screen through
 * `CoverImageField`'s `describeFailure` whenever the code was one the editor had no copy for
 * -- an untranslatable sentence from a library, on the one surface #78 is emptying of them.
 *
 * <p>So an empty message is a real answer now, and it means "the server said nothing" -- a
 * proxy answering 502, most realistically. The caller draws its own words for the code, and
 * `campaignEditor.cover.failures` carries the three codes below in four languages since #86.
 */
async function refusal(response: Response, fallbackCode: string): Promise<UploadFailed> {
  const error = await errorFrom(response);
  return new UploadFailed(error.problem?.code ?? fallbackCode, error.message);
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
