import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import {
  decideStudentVerification,
  listStudentVerifications,
  readStudentVerificationList,
  readStudentVerificationRow,
} from './student-verifications';

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));
const fetchMock = vi.mocked(authorizedFetch);

const ROW = {
  id: 'v-1',
  accountId: 'a-1',
  accountName: 'Ayan',
  institution: 'ADA University',
  cardNumber: 'ST1234',
  state: 'PENDING',
  submittedAt: '2026-11-20T09:00:00Z',
  documents: ['STUDENT_CARD', 'SELFIE', 'PASSPORT'],
  sameCardElsewhere: [{ accountId: 'a-2', state: 'APPROVED' }, { state: 'REJECTED' }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('readStudentVerificationRow', () => {
  it('reads absent fields as null and drops what it does not recognise', () => {
    const row = readStudentVerificationRow(ROW);
    expect(row?.accountEmail).toBeNull();
    expect(row?.validUntil).toBeNull();
    expect(row?.documents).toEqual(['STUDENT_CARD', 'SELFIE']);
    expect(row?.sameCardElsewhere).toEqual([{ accountId: 'a-2', accountName: null, state: 'APPROVED' }]);
  });

  it('refuses a row it cannot decide from', () => {
    expect(readStudentVerificationRow({ ...ROW, cardNumber: undefined })).toBeNull();
    expect(readStudentVerificationRow({ ...ROW, state: 'NONE' })).toBeNull();
    expect(readStudentVerificationRow('row')).toBeNull();
  });
});

describe('readStudentVerificationList', () => {
  it('drops a malformed row and keeps the rest', () => {
    expect(readStudentVerificationList({ verifications: [ROW, { id: 'broken' }] })).toHaveLength(1);
  });

  it('is a failure, not an empty queue, without the array', () => {
    expect(readStudentVerificationList({})).toBeNull();
  });
});

describe('the console calls', () => {
  it('asks for one state', async () => {
    fetchMock.mockResolvedValue(json({ verifications: [ROW] }));
    const rows = await listStudentVerifications('APPROVED');
    expect(fetchMock).toHaveBeenCalledWith('/v1/admin/student-verifications?state=APPROVED', { signal: undefined });
    expect(rows).toHaveLength(1);
  });

  it('approves with no body and rejects with the reason', async () => {
    fetchMock.mockResolvedValue(json(ROW));
    await decideStudentVerification('v-1', 'approve', null);
    expect(fetchMock).toHaveBeenLastCalledWith('/v1/admin/student-verifications/v-1/approve', {
      method: 'POST',
      signal: undefined,
    });

    fetchMock.mockResolvedValue(json(ROW));
    await decideStudentVerification('v-1', 'revoke', 'Shared card');
    expect(fetchMock).toHaveBeenLastCalledWith('/v1/admin/student-verifications/v-1/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Shared card' }),
      signal: undefined,
    });
  });

  it('throws the service refusal', async () => {
    fetchMock.mockResolvedValue(json({ status: 409, code: 'STUDENT_VERIFICATION_NOT_DECIDABLE' }, 409));
    await expect(decideStudentVerification('v-1', 'approve', null)).rejects.toMatchObject({ status: 409 });
  });
});
