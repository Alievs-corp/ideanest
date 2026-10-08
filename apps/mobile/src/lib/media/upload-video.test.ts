import { ApiError } from '@ideanest/api-client';
import * as client from '../../api/client';
import {
  UploadFailed,
  VIDEO_MAX_BYTES,
  VIDEO_POLL_INTERVAL_MS,
  VIDEO_POLL_LIMIT,
  forgetPicked,
  isVideoTooLarge,
  isVideoTooLong,
  uploadVideo,
  videoTypeOf,
  type UploadStage,
} from './upload';

/*
 * `uploadVideo` (#331) shares `uploadImage`'s requests, PUT and poll, which `upload.test.ts`
 * covers rule by rule. Here: what is different for a video — the declared type, no conversion,
 * the size refused before an address is asked for, progress, and the longer, slower poll.
 */

const mockGet = jest.fn();
const mockUpload = jest.fn();
const mockDelete = jest.fn();
let mockFileSize = 12_000_000;

jest.mock('../../api/client', () => ({ api: () => ({ get: mockGet }), sendJson: jest.fn() }));

jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  Paths: { cache: { uri: 'file:///app/cache' } },
  File: class {
    readonly uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get size() {
      return mockFileSize;
    }
    upload(url: string, options: unknown) {
      return mockUpload(url, options);
    }
    delete() {
      mockDelete(this.uri);
    }
  },
}));

const sendJson = jest.mocked(client.sendJson);
const PICKED = 'file:///app/cache/ImagePicker/clip.mov';
const TICKET = {
  mediaId: 'video-1',
  uploadUrl: 'https://store.example.com/bucket/video-1?X-Amz-Signature=abc',
  contentType: 'video/quicktime',
  expiresAt: '2026-10-08T10:10:00Z',
  maxBytes: VIDEO_MAX_BYTES,
};
const READY = {
  id: 'video-1',
  kind: 'VIDEO',
  status: 'READY',
  url: 'https://media.example.com/video-1.mp4',
  posterUrl: 'https://media.example.com/video-1.jpg',
  width: 1280,
  height: 720,
  durationMs: 45_200,
  blurDataUrl: 'data:image/webp;base64,AAAA',
};

/** Runs the upload to completion under fake timers and returns its outcome. */
async function run(options: { mimeType?: string | null; signal?: AbortSignal; uri?: string } = {}) {
  const stages: UploadStage[] = [];
  const progress: number[] = [];
  const outcome = uploadVideo(options.uri ?? PICKED, {
    ...(options.mimeType === undefined ? {} : { mimeType: options.mimeType }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    onStage: (stage) => stages.push(stage),
    onProgress: (fraction) => progress.push(fraction),
  }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  for (let i = 0; i < VIDEO_POLL_LIMIT + 5; i += 1) {
    await jest.advanceTimersByTimeAsync(VIDEO_POLL_INTERVAL_MS);
  }
  return { stages, progress, result: await outcome };
}

const failureCode = (result: { ok: boolean }) => (result as unknown as { error: UploadFailed }).error.code;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockFileSize = 12_000_000;
  sendJson.mockImplementation(async (_method, path) =>
    path === '/v1/media/uploads' ? TICKET : { id: 'video-1', status: 'UPLOADED' },
  );
  mockUpload.mockImplementation(async (_url: string, options: { onProgress?: (p: unknown) => void }) => {
    options.onProgress?.({ bytesSent: 3_000_000, totalBytes: 12_000_000 });
    options.onProgress?.({ bytesSent: 12_000_000, totalBytes: 12_000_000 });
    return { status: 200, body: '', headers: {} };
  });
  mockGet.mockResolvedValue(READY);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('uploadVideo', () => {
  it('declares a video, sends the file as it is, completes and waits for a READY video', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'video-1', status: 'PROCESSING' })
      .mockResolvedValueOnce(READY);

    const { stages, progress, result } = await run({ mimeType: 'video/quicktime' });

    expect(result).toEqual({
      ok: true,
      value: {
        mediaId: 'video-1',
        url: READY.url,
        posterUrl: READY.posterUrl,
        width: 1280,
        height: 720,
        durationMs: 45_200,
        blurDataUrl: READY.blurDataUrl,
      },
    });
    expect(stages).toEqual(['preparing', 'uploading', 'processing']);
    expect(progress).toEqual([0, 0.25, 1]);
    expect(sendJson.mock.calls).toEqual([
      ['POST', '/v1/media/uploads', { contentType: 'video/quicktime', byteSize: 12_000_000 }],
      ['POST', '/v1/media/video-1/complete'],
    ]);
    // The picked file itself goes up: there is no converted copy to send or to delete.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('PUTs with the signed type only, never an Authorization header', async () => {
    await run();
    const [url, options] = mockUpload.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe(TICKET.uploadUrl);
    expect(options).toMatchObject({ httpMethod: 'PUT', uploadType: 0 });
    expect(options.headers).toEqual({ 'Content-Type': 'video/quicktime' });
  });

  it('asks every 2 seconds, for up to 5 minutes, before saying it is still processing', async () => {
    mockGet.mockResolvedValue({ id: 'video-1', status: 'PROCESSING' });

    const { result } = await run();

    expect(failureCode(result)).toBe('UPLOAD_STILL_PROCESSING');
    expect(mockGet).toHaveBeenCalledTimes(VIDEO_POLL_LIMIT);
    expect(VIDEO_POLL_INTERVAL_MS).toBe(2_000);
    expect(VIDEO_POLL_LIMIT * VIDEO_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(300_000);
    expect((VIDEO_POLL_LIMIT - 1) * VIDEO_POLL_INTERVAL_MS).toBeLessThan(300_000);
  });

  it('keeps asking while a READY answer lacks what a player needs', async () => {
    mockGet
      .mockResolvedValueOnce({ ...READY, posterUrl: undefined })
      .mockResolvedValueOnce(READY);
    const { result } = await run();
    expect(result.ok).toBe(true);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it.each(['TOO_LONG', 'UNSUPPORTED_FORMAT', 'TOO_LARGE', 'UNREADABLE'])(
    'stops at FAILED and reports %s',
    async (reason) => {
      mockGet.mockResolvedValueOnce({ id: 'video-1', status: 'FAILED', failureReason: reason });
      const { stages, result } = await run();
      expect(failureCode(result)).toBe(reason);
      expect(stages).toEqual(['preparing', 'uploading', 'processing']);
      expect(mockGet).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses a file over 250 MB before asking for an address', async () => {
    mockFileSize = VIDEO_MAX_BYTES + 1;
    const { stages, result } = await run();
    expect(failureCode(result)).toBe('TOO_LARGE');
    expect(stages).toEqual(['preparing']);
    expect(sendJson).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('refuses an empty file before asking for an address', async () => {
    mockFileSize = 0;
    const { result } = await run();
    expect(failureCode(result)).toBe('EMPTY');
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('reads a 503 with no code as uploads unavailable', async () => {
    sendJson.mockRejectedValueOnce(new ApiError(503, { type: 'about:blank', title: 'Unavailable', status: 503 }));
    const { result } = await run();
    expect(failureCode(result)).toBe('UPLOADS_UNAVAILABLE');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('fails the transfer on a non-2xx PUT and never completes', async () => {
    mockUpload.mockResolvedValueOnce({ status: 403, body: 'SignatureDoesNotMatch', headers: {} });
    const { stages, result } = await run();
    expect(failureCode(result)).toBe('UPLOAD_TRANSFER_FAILED');
    expect(stages).toEqual(['preparing', 'uploading']);
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  it('stops when aborted while waiting', async () => {
    mockGet.mockResolvedValue({ id: 'video-1', status: 'PROCESSING' });
    const controller = new AbortController();
    const outcome = uploadVideo(PICKED, { signal: controller.signal }).catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(VIDEO_POLL_INTERVAL_MS * 3);
    controller.abort();
    const error = await outcome;

    expect((error as Error).name).toBe('AbortError');
    const polls = mockGet.mock.calls.length;
    await jest.advanceTimersByTimeAsync(VIDEO_POLL_INTERVAL_MS * 10);
    expect(mockGet).toHaveBeenCalledTimes(polls);
  });
});

describe('videoTypeOf', () => {
  it("keeps the picker's video type", () => {
    expect(videoTypeOf('file:///a/clip.mov', 'video/quicktime')).toBe('video/quicktime');
    expect(videoTypeOf('file:///a/clip', ' Video/MP4 ')).toBe('video/mp4');
  });

  it('reads the extension when the picker said nothing useful, and falls back to MP4', () => {
    expect(videoTypeOf('file:///a/clip.MOV', null)).toBe('video/quicktime');
    expect(videoTypeOf('file:///a/clip.webm', 'application/octet-stream')).toBe('video/webm');
    expect(videoTypeOf('file:///a/clip.3gp')).toBe('video/3gpp');
    expect(videoTypeOf('content://media/external/video/42')).toBe('video/mp4');
  });
});

describe('the picker checks', () => {
  it('allows the minute and half a second over, and refuses more', () => {
    expect(isVideoTooLong(60_000)).toBe(false);
    expect(isVideoTooLong(60_500)).toBe(false);
    expect(isVideoTooLong(60_501)).toBe(true);
    // No figure is not a refusal: the service measures it anyway.
    expect(isVideoTooLong(null)).toBe(false);
    expect(isVideoTooLong(undefined)).toBe(false);
  });

  it('refuses over 250 MB, and not without a figure', () => {
    expect(isVideoTooLarge(VIDEO_MAX_BYTES)).toBe(false);
    expect(isVideoTooLarge(VIDEO_MAX_BYTES + 1)).toBe(true);
    expect(isVideoTooLarge(undefined)).toBe(false);
  });
});

describe('forgetPicked', () => {
  it("deletes the picker's copy in this app's cache, and nothing outside it", () => {
    forgetPicked(PICKED);
    forgetPicked('file:///storage/emulated/0/DCIM/clip.mp4');
    forgetPicked('file:///app/cache-other/clip.mp4');
    expect(mockDelete.mock.calls).toEqual([[PICKED]]);
  });
});
