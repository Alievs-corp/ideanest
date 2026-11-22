import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import { ApiError } from '../api/problem';
import {
  STUDENT_DOCUMENT_MAX_BYTES,
  SELFIE_TYPES,
  STUDENT_CARD_TYPES,
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
