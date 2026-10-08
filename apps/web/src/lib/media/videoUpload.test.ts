import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import { UploadFailed } from './upload';
import { uploadVideo } from './videoUpload';

/**
 * The campaign video's upload — issue #331.
 *
 * What fails silently here is the transfer: a PUT that carried this platform's bearer token to
 * the bucket, one that declared a type other than the one signed into the address, a progress
 * bar driven by something other than bytes, or a cancel that stopped the wait and left the
 * 200MB transfer running. Each is asserted against a fake `XMLHttpRequest` that records what
 * it was asked to do.
 *
 * `authorizedFetch` is mocked because the three API calls are the image path's, already
 * exercised end to end by the backend suite; the answers below are the ones it gives.
 */

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));

const fetchMock = vi.mocked(authorizedFetch);

const MEDIA_ID = '6f1c2a9e-1b9f-4c55-9a51-2d1f4ad0c0de';
const UPLOAD_URL = 'https://bucket.example.test/raw/6f1c2a9e?X-Amz-Signature=abc';

/** The parts of `XMLHttpRequest` the upload uses, recording every call. */
class FakeRequest {
  static last: FakeRequest | null = null;

  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  aborted = false;
  withCredentials = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onloadend: (() => void) | null = null;

  constructor() {
    FakeRequest.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
    this.onloadend?.();
  }

  /* What the network would do. */
  progress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent);
  }

  respond(status: number): void {
    this.status = status;
    this.onload?.();
    this.onloadend?.();
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TICKET = {
  mediaId: MEDIA_ID,
  uploadUrl: UPLOAD_URL,
  contentType: 'video/quicktime',
  expiresAt: '2026-10-08T12:15:00Z',
  maxBytes: 262_144_000,
};

const READY = {
  id: MEDIA_ID,
  kind: 'VIDEO',
  status: 'READY',
  url: 'https://cdn.example.test/media/6f1c2a9e.mp4',
  width: 1280,
  height: 720,
  blurDataUrl: 'data:image/webp;base64,AAAA',
  posterUrl: 'https://cdn.example.test/media/6f1c2a9e.poster.webp',
  durationMs: 42_000,
  failureReason: null,
};

/** Answers the three API calls, and then each poll from `states` in order. */
function serve(...states: readonly unknown[]): void {
  const polls = [...states];
  fetchMock.mockImplementation(async (path, init) => {
    if (path === '/v1/media/uploads') return json(TICKET, 201);
    if (path === `/v1/media/${MEDIA_ID}/complete` && init?.method === 'POST') {
      return json({ ...READY, status: 'UPLOADED', url: null });
    }
    // The last state repeats: a row that is still processing stays that way until it is not.
    if (path === `/v1/media/${MEDIA_ID}`) {
      return json((polls.length > 1 ? polls.shift() : polls[0]) ?? READY);
    }
    throw new Error(`unexpected request to ${path}`);
  });
}

/** Lets the promise chain reach the next `await`. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const clip = (): File => new File(['x'.repeat(1000)], 'IMG_0042.MOV', { type: '' });

beforeEach(() => {
  vi.clearAllMocks();
  FakeRequest.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('uploadVideo', () => {
  it('declares the video type it was given, and the size, before sending anything', async () => {
    serve(READY);
    const pending = uploadVideo(clip(), { contentType: 'video/quicktime' });
    await vi.waitFor(() => expect(FakeRequest.last).not.toBeNull());

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/v1/media/uploads');
    expect(JSON.parse(String(init?.body))).toEqual({ contentType: 'video/quicktime', byteSize: 1000 });

    FakeRequest.last?.respond(200);
    await expect(pending).resolves.toMatchObject({ mediaId: MEDIA_ID });
  });

  it('puts the bytes to the signed address with the signed type and no credentials', async () => {
    serve(READY);
    const file = clip();
    const pending = uploadVideo(file, { contentType: 'video/quicktime' });
    await vi.waitFor(() => expect(FakeRequest.last).not.toBeNull());

    const request = FakeRequest.last;
    expect(request?.method).toBe('PUT');
    expect(request?.url).toBe(UPLOAD_URL);
    expect(request?.headers).toEqual({ 'content-type': 'video/quicktime' });
    // The platform's token would be a credential handed to a host with no business seeing it.
    expect(request?.headers).not.toHaveProperty('authorization');
    expect(request?.withCredentials).toBe(false);
    expect(request?.body).toBe(file);

    request?.respond(200);
    await pending;
  });

  it('reports progress from the bytes sent, then every stage in order, then the ready clip', async () => {
    serve({ ...READY, status: 'PROCESSING', url: null }, READY);
    const stages: string[] = [];
    const fractions: number[] = [];
    const pending = uploadVideo(clip(), {
      contentType: 'video/quicktime',
      onStage: (stage) => stages.push(stage),
      onProgress: (fraction) => fractions.push(fraction),
    });
    await vi.waitFor(() => expect(FakeRequest.last).not.toBeNull());

    FakeRequest.last?.progress(250, 1000);
    // A stack that does not know the total: the file's own size is the same number.
    FakeRequest.last?.progress(500, 0, false);
    FakeRequest.last?.respond(200);
    await settle();
    // The first poll answered PROCESSING; the next one is two seconds later.
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({
      mediaId: MEDIA_ID,
      url: READY.url,
      posterUrl: READY.posterUrl,
      width: 1280,
      height: 720,
      durationMs: 42_000,
      blurDataUrl: READY.blurDataUrl,
    });
    expect(fractions).toEqual([0.25, 0.5, 1]);
    expect(stages).toEqual(['preparing', 'uploading', 'processing']);
  });

  it('refuses with the service’s reason when the transcode fails', async () => {
    serve({ ...READY, status: 'FAILED', url: null, failureReason: 'TOO_LONG' });
    const pending = uploadVideo(clip(), { contentType: 'video/quicktime' });
    const outcome = pending.catch((cause: unknown) => cause);
    await vi.waitFor(() => expect(FakeRequest.last).not.toBeNull());
    FakeRequest.last?.respond(200);

    const failure = await outcome;
    expect(failure).toBeInstanceOf(UploadFailed);
    expect((failure as UploadFailed).code).toBe('TOO_LONG');
    // The words are the field's, in the creator's language. Nothing English rides along.
    expect((failure as UploadFailed).message).toBe('');
  });

  it('calls a refused transfer a transfer failure, not a credentials problem', async () => {
    serve(READY);
    const outcome = uploadVideo(clip(), { contentType: 'video/quicktime' }).catch(
      (cause: unknown) => cause,
    );
    await vi.waitFor(() => expect(FakeRequest.last).not.toBeNull());
    FakeRequest.last?.respond(403);

    expect(((await outcome) as UploadFailed).code).toBe('UPLOAD_TRANSFER_FAILED');
  });

  it('stops the transfer itself when it is cancelled, not only the wait for it', async () => {
    serve(READY);
    const controller = new AbortController();
    const outcome = uploadVideo(clip(), {
      contentType: 'video/quicktime',
      signal: controller.signal,
    }).catch((cause: unknown) => cause);
    await vi.waitFor(() => expect(FakeRequest.last).not.toBeNull());

    controller.abort();

    expect(FakeRequest.last?.aborted).toBe(true);
    expect(((await outcome) as DOMException).name).toBe('AbortError');
  });

  it('gives up after five minutes of processing and says so, rather than spinning for ever', async () => {
    serve({ ...READY, status: 'PROCESSING', url: null });
    const outcome = uploadVideo(clip(), { contentType: 'video/quicktime' }).catch(
      (cause: unknown) => cause,
    );
    await vi.waitFor(() => expect(FakeRequest.last).not.toBeNull());
    FakeRequest.last?.respond(200);
    await settle();

    await vi.advanceTimersByTimeAsync(300_000);

    expect(((await outcome) as UploadFailed).code).toBe('UPLOAD_STILL_PROCESSING');
  });
});
