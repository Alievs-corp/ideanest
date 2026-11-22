import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import { ApiError } from '../api/problem';
import {
  STUDENT_DOCUMENT_MAX_BYTES,
  SELFIE_TYPES,
  STUDENT_CARD_TYPES,
  STUDENT_REQUEST_MAX_BYTES,
  downscaleImage,
  fitsOneRequest,
  localFileProblem,
  readMyStudentVerification,
  refusedFieldOf,
  submitStudentVerification,
} from './student';

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));
const fetchMock = vi.mocked(authorizedFetch);

function file(name: string, type: string, bytes: number): File {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: bytes });
  return made;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => fetchMock.mockReset());

describe('localFileProblem', () => {
  it('refuses what the service refuses, before it is sent', () => {
    expect(localFileProblem(file('a.jpg', 'image/jpeg', 0), SELFIE_TYPES)).toBe('emptyFile');
    expect(localFileProblem(file('a.pdf', 'application/pdf', 10), SELFIE_TYPES)).toBe('unsupportedFile');
    expect(localFileProblem(file('a.jpg', 'image/jpeg', STUDENT_DOCUMENT_MAX_BYTES + 1), SELFIE_TYPES)).toBe('tooLarge');
  });

  it('accepts a PDF card and a photograph at the limit', () => {
    expect(localFileProblem(file('a.pdf', 'application/pdf', 10), STUDENT_CARD_TYPES)).toBeNull();
    expect(localFileProblem(file('a.png', 'image/png', STUDENT_DOCUMENT_MAX_BYTES), SELFIE_TYPES)).toBeNull();
  });
});

describe('refusedFieldOf', () => {
  it('reads the field off the problem, or off its meta', () => {
    const top = { status: 400, code: 'TOO_LARGE', field: 'studentCard' };
    expect(refusedFieldOf(new ApiError(400, top))).toBe('studentCard');
    expect(refusedFieldOf(new ApiError(400, { status: 400, code: 'EMPTY', meta: { field: 'selfie' } }))).toBe('selfie');
    expect(refusedFieldOf(new ApiError(400, { status: 400, code: 'EMPTY', meta: { field: 'file' } }))).toBeNull();
    expect(refusedFieldOf(new Error('x'))).toBeNull();
  });
});

describe('the account calls', () => {
  it('reads the verification and refuses a body that is not one', async () => {
    fetchMock.mockResolvedValue(json({ state: 'NONE' }));
    expect((await readMyStudentVerification()).state).toBe('NONE');

    fetchMock.mockResolvedValue(json({ state: 'SOMETHING' }));
    await expect(readMyStudentVerification()).rejects.toBeInstanceOf(ApiError);
  });

  it('sends the four parts as multipart, letting the browser write the boundary', async () => {
    fetchMock.mockResolvedValue(json({ state: 'PENDING', institution: 'ADA University' }));
    const card = file('card.pdf', 'application/pdf', 10);
    const selfie = file('me.jpg', 'image/jpeg', 10);

    const answer = await submitStudentVerification({ institution: 'ADA University', cardNumber: 'ST1', studentCard: card, selfie });

    expect(answer.state).toBe('PENDING');
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/v1/me/student-verification');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toBeUndefined();
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    if (!(body instanceof FormData)) return;
    expect(body.get('institution')).toBe('ADA University');
    expect(body.get('cardNumber')).toBe('ST1');
    expect((body.get('studentCard') as File).name).toBe('card.pdf');
    expect((body.get('selfie') as File).name).toBe('me.jpg');
  });
});

describe('fitsOneRequest', () => {
  it('leaves room for the form around the two files', () => {
    const half = STUDENT_REQUEST_MAX_BYTES / 2;
    expect(fitsOneRequest(file('a.pdf', 'application/pdf', 1_000_000), file('b.jpg', 'image/jpeg', 1_000_000))).toBe(true);
    expect(fitsOneRequest(file('a.pdf', 'application/pdf', half), file('b.jpg', 'image/jpeg', half))).toBe(false);
  });

  it('lets a file of the size the service checks for be judged before its size is', () => {
    const large = file('me.png', 'image/png', STUDENT_DOCUMENT_MAX_BYTES * 2);
    expect(localFileProblem(large, SELFIE_TYPES)).toBe('tooLarge');
    expect(localFileProblem(large, SELFIE_TYPES, { ignoreSize: true })).toBeNull();
  });
});

describe('downscaleImage', () => {
  const drawn: { width: number; height: number }[] = [];

  beforeEach(() => {
    drawn.length = 0;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const canvas = this;
      return {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(() => drawn.push({ width: canvas.width, height: canvas.height })),
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback, type?: string) =>
      callback(new Blob([new Uint8Array(400_000)], { type: type ?? 'image/png' })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redraws a phone photograph at 2048 pixels on its longer edge, as a JPEG', async () => {
    const photo = file('IMG_0001.png', 'image/png', 11 * 1024 * 1024);
    const sent = await downscaleImage(photo);

    expect(drawn).toEqual([{ width: 2048, height: 1536 }]);
    expect(sent.type).toBe('image/jpeg');
    expect(sent.name).toBe('IMG_0001.jpg');
    expect(sent.size).toBe(400_000);
  });

  it('leaves a PDF card exactly as it is', async () => {
    const card = file('card.pdf', 'application/pdf', 3_000_000);
    expect(await downscaleImage(card)).toBe(card);
    expect(drawn).toEqual([]);
  });

  it('keeps a small JPEG that re-encoding would only make larger', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })));
    const small = file('me.jpg', 'image/jpeg', 100_000);
    expect(await downscaleImage(small)).toBe(small);
  });

  it('sends the original when the browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('cannot decode');
    }));
    const photo = file('me.jpg', 'image/jpeg', 2_000_000);
    expect(await downscaleImage(photo)).toBe(photo);
  });
});
