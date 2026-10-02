import { ApiError } from '@ideanest/api-client';
import * as client from '../../api/client';
import { POLL_INTERVAL_MS, POLL_LIMIT, UploadFailed, uploadImage, type UploadStage } from './upload';

const mockGet = jest.fn();
const mockUpload = jest.fn();
const mockDelete = jest.fn();
const mockManipulate = jest.fn();
const mockSave = jest.fn();
let mockFileSize = 48_213;

jest.mock('../../api/client', () => ({ api: () => ({ get: mockGet }), sendJson: jest.fn() }));

jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
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

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  ImageManipulator: { manipulate: (source: unknown) => mockManipulate(source) },
}));

const sendJson = jest.mocked(client.sendJson);
const TICKET = {
  mediaId: 'media-1',
  uploadUrl: 'https://store.example.com/bucket/media-1?X-Amz-Signature=abc',
  contentType: 'image/jpeg',
  expiresAt: '2026-10-02T10:10:00Z',
  maxBytes: 20_971_520,
};
const READY = {
  id: 'media-1',
  status: 'READY',
  url: 'https://media.example.com/media-1.webp',
  width: 1024,
  height: 1024,
  blurDataUrl: 'data:image/webp;base64,AAAA',
};

/** A manipulator that renders an image of the given size and saves it to the cache. */
function imageOf(width: number, height: number) {
  const context = {
    resize: jest.fn((size: { width?: number; height?: number }) => {
      const scale = size.width !== undefined ? size.width / width : (size.height ?? height) / height;
      return {
        renderAsync: async () => imageRef(Math.round(width * scale), Math.round(height * scale)),
      };
    }),
    renderAsync: async () => imageRef(width, height),
  };
  return context;
}

function imageRef(width: number, height: number) {
  return {
    width,
    height,
    saveAsync: async (options: unknown) => {
      mockSave(options);
      return { uri: `file:///cache/converted-${width}x${height}.jpg`, width, height };
    },
  };
}

function refusal(status: number, code?: string, detail?: string): ApiError {
  return new ApiError(status, {
    type: 'about:blank',
    title: 'Refused',
    status,
    ...(detail === undefined ? {} : { detail }),
    ...(code === undefined ? {} : { code }),
  });
}

/** Runs the upload to completion under fake timers and returns its outcome. */
async function run(options: { maxEdge?: number; signal?: AbortSignal } = {}) {
  const stages: UploadStage[] = [];
  const outcome = uploadImage('file:///picker/IMG_0001.HEIC', {
    ...options,
    onStage: (stage) => stages.push(stage),
  }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  for (let i = 0; i < POLL_LIMIT + 5; i += 1) {
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  }
  return { stages, result: await outcome };
}

const fetchSpy = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockFileSize = 48_213;
  global.fetch = fetchSpy as unknown as typeof fetch;
  mockManipulate.mockImplementation(() => imageOf(1200, 1200));
  sendJson.mockImplementation(async (_method, path) =>
    path === '/v1/media/uploads' ? TICKET : { id: 'media-1', status: 'UPLOADED' },
  );
  mockUpload.mockResolvedValue({ status: 200, body: '', headers: {} });
  mockGet.mockResolvedValue(READY);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('uploadImage', () => {
  it('converts, asks for an address, sends the bytes, completes and waits for READY', async () => {
    mockGet
      .mockResolvedValueOnce({ id: 'media-1', status: 'PROCESSING' })
      .mockResolvedValueOnce(READY);

    const { stages, result } = await run();

    expect(result).toEqual({
      ok: true,
      value: {
        mediaId: 'media-1',
        url: READY.url,
        width: 1024,
        height: 1024,
        blurDataUrl: READY.blurDataUrl,
      },
    });
    expect(stages).toEqual(['preparing', 'uploading', 'processing']);
    expect(sendJson.mock.calls).toEqual([
      ['POST', '/v1/media/uploads', { contentType: 'image/jpeg', byteSize: 48_213 }],
      ['POST', '/v1/media/media-1/complete'],
    ]);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenCalledWith('/v1/media/{mediaId}', expect.objectContaining({ path: { mediaId: 'media-1' } }));
    // The converted copy in the cache is removed; the picker's original is not touched.
    expect(mockDelete).toHaveBeenCalledWith('file:///cache/converted-1200x1200.jpg');
  });

  it('PUTs the converted JPEG to the signed address with no Authorization header', async () => {
    await run();

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [url, options] = mockUpload.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe(TICKET.uploadUrl);
    expect(options).toMatchObject({ httpMethod: 'PUT', uploadType: 0 });
    const headers = options.headers as Record<string, string>;
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('authorization');
    // Not through the session's transport, and not through a fetch that could add one.
    expect(sendJson).not.toHaveBeenCalledWith(expect.anything(), TICKET.uploadUrl, expect.anything());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the content type the service signed, not its own', async () => {
    sendJson.mockImplementation(async (_method, path) =>
      path === '/v1/media/uploads' ? { ...TICKET, contentType: 'image/jpeg; charset=binary' } : null,
    );
    await run();
    const [, options] = mockUpload.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers['Content-Type']).toBe('image/jpeg; charset=binary');
  });

  it('saves as JPEG, scaling the longest edge down to maxEdge', async () => {
    const big = imageOf(4032, 3024);
    mockManipulate.mockImplementation(() => big);

    await run({ maxEdge: 2048 });

    expect(big.resize).toHaveBeenCalledWith({ width: 2048 });
    expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.9 });
    expect(mockDelete).toHaveBeenCalledWith('file:///cache/converted-2048x1536.jpg');
  });

  it('scales a portrait photo by its height', async () => {
    const tall = imageOf(3024, 4032);
    mockManipulate.mockImplementation(() => tall);
    await run({ maxEdge: 2048 });
    expect(tall.resize).toHaveBeenCalledWith({ height: 2048 });
  });

  it('refuses an image the phone cannot convert, before asking for an address', async () => {
    mockManipulate.mockImplementation(() => ({
      renderAsync: async () => {
        throw new Error('decode failed');
      },
    }));
    const { stages, result } = await run();
    expect(result.ok).toBe(false);
    expect((result as { error: UploadFailed }).error.code).toBe('UNREADABLE');
    expect(stages).toEqual(['preparing']);
    expect(sendJson).not.toHaveBeenCalled();
  });

  it.each(['UNSUPPORTED_FORMAT', 'TOO_LARGE', 'TOO_SMALL', 'EMPTY'])(
    'stops polling at FAILED and reports %s',
    async (reason) => {
      mockGet
        .mockResolvedValueOnce({ id: 'media-1', status: 'PROCESSING' })
        .mockResolvedValueOnce({ id: 'media-1', status: 'FAILED', failureReason: reason });

      const { result } = await run();

      expect(result.ok).toBe(false);
      const error = (result as { error: unknown }).error;
      expect(error).toBeInstanceOf(UploadFailed);
      expect((error as UploadFailed).code).toBe(reason);
      expect(mockGet).toHaveBeenCalledTimes(2);
    },
  );

  it('gives up after 90 seconds of processing', async () => {
    mockGet.mockResolvedValue({ id: 'media-1', status: 'PROCESSING' });

    const { result } = await run();

    expect((result as { error: UploadFailed }).error.code).toBe('UPLOAD_STILL_PROCESSING');
    expect(mockGet).toHaveBeenCalledTimes(POLL_LIMIT);
    expect(POLL_LIMIT * POLL_INTERVAL_MS).toBeGreaterThanOrEqual(90_000);
    expect((POLL_LIMIT - 1) * POLL_INTERVAL_MS).toBeLessThan(90_000);
  });

  it('reads a 503 with no code as uploads unavailable', async () => {
    sendJson.mockRejectedValueOnce(refusal(503));
    const { stages, result } = await run();
    expect((result as { error: UploadFailed }).error.code).toBe('UPLOADS_UNAVAILABLE');
    expect(stages).toEqual(['preparing']);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("keeps the service's own code on a 503, and its code on a refusal", async () => {
    sendJson.mockRejectedValueOnce(refusal(503, 'MEDIA_STORAGE_UNREACHABLE'));
    expect(((await run()).result as { error: UploadFailed }).error.code).toBe(
      'MEDIA_STORAGE_UNREACHABLE',
    );

    sendJson.mockRejectedValueOnce(refusal(400, 'TOO_LARGE', 'That file is over 20 MB.'));
    const error = ((await run()).result as { error: UploadFailed }).error;
    expect(error.code).toBe('TOO_LARGE');
    expect(error.message).toBe('That file is over 20 MB.');
  });

  it('fails the transfer on a non-2xx PUT and never completes', async () => {
    mockUpload.mockResolvedValueOnce({ status: 403, body: 'SignatureDoesNotMatch', headers: {} });
    const { stages, result } = await run();
    expect((result as { error: UploadFailed }).error.code).toBe('UPLOAD_TRANSFER_FAILED');
    expect(stages).toEqual(['preparing', 'uploading']);
    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalled();
  });

  it('reads a dropped connection as the connection, never as a refused file', async () => {
    sendJson.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(((await run()).result as { error: UploadFailed }).error.code).toBe(
      'UPLOAD_TRANSFER_FAILED',
    );

    sendJson.mockImplementation(async (_method, path) => {
      if (path === '/v1/media/uploads') return TICKET;
      throw new TypeError('Network request failed');
    });
    expect(((await run()).result as { error: UploadFailed }).error.code).toBe(
      'UPLOAD_TRANSFER_FAILED',
    );
  });

  it('asks again on the next tick after a dropped poll or a 5xx', async () => {
    mockGet
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(refusal(502))
      .mockResolvedValueOnce(READY);

    const { result } = await run();

    expect(result.ok).toBe(true);
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  it('says the connection went when every poll in the 90 seconds got no answer', async () => {
    mockGet.mockRejectedValue(new TypeError('Network request failed'));
    const { result } = await run();
    expect((result as { error: UploadFailed }).error.code).toBe('UPLOAD_TRANSFER_FAILED');
    expect(mockGet).toHaveBeenCalledTimes(POLL_LIMIT);
  });

  it('stops at once on a 4xx poll', async () => {
    mockGet.mockRejectedValueOnce(refusal(404));
    const { result } = await run();
    expect((result as { error: UploadFailed }).error.code).toBe('MEDIA_NOT_FOUND');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('stops when aborted while waiting', async () => {
    mockGet.mockResolvedValue({ id: 'media-1', status: 'PROCESSING' });
    const controller = new AbortController();
    const stages: UploadStage[] = [];
    const outcome = uploadImage('file:///picker/a.jpg', {
      signal: controller.signal,
      onStage: (stage) => stages.push(stage),
    }).catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    controller.abort();
    const error = await outcome;

    expect((error as Error).name).toBe('AbortError');
    const polls = mockGet.mock.calls.length;
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10);
    expect(mockGet).toHaveBeenCalledTimes(polls);
  });
});
