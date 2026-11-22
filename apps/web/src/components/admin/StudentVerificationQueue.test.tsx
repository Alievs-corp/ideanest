import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  decideStudentVerification,
  listStudentVerifications,
  openStudentDocument,
  type StudentVerificationRow,
} from '../../lib/admin/student-verifications';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { studentVerificationQueueCopyFrom } from '../../lib/i18n/admin/people-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { StudentVerificationQueue } from './StudentVerificationQueue';

const COPY = studentVerificationQueueCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/student-verifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/student-verifications')>()),
  listStudentVerifications: vi.fn(),
  openStudentDocument: vi.fn(),
  decideStudentVerification: vi.fn(),
}));

const listMock = vi.mocked(listStudentVerifications);
const openMock = vi.mocked(openStudentDocument);
const decideMock = vi.mocked(decideStudentVerification);

const AYAN = '0193f2a1-0000-7000-8000-00000000a001';
const KAMRAN = '0193f2a1-0000-7000-8000-00000000a002';

const WAITING: StudentVerificationRow = {
  id: '0193f2a1-0000-7000-8000-00000000b001',
  accountId: AYAN,
  accountName: 'Ayan Məmmədova',
  accountEmail: 'ayan@example.az',
  institution: 'ADA University',
  cardNumber: 'ST20261234',
  state: 'PENDING',
  submittedAt: '2026-11-20T09:00:00Z',
  decidedAt: null,
  decidedBy: null,
  validUntil: null,
  rejectionReason: null,
  documents: ['STUDENT_CARD', 'SELFIE'],
  sameCardElsewhere: [],
};

const SHARED: StudentVerificationRow = {
  ...WAITING,
  sameCardElsewhere: [{ accountId: KAMRAN, accountName: 'Kamran Əliyev', state: 'REJECTED' }],
};

const APPROVED: StudentVerificationRow = {
  ...WAITING,
  state: 'APPROVED',
  decidedAt: '2026-11-21T09:00:00Z',
  validUntil: '2027-11-21T09:00:00Z',
  documents: [],
};

let urls = 0;
const revoked: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  urls = 0;
  revoked.length = 0;
  window.history.replaceState({}, '', '/en/admin/student-verifications');
  URL.createObjectURL = vi.fn(() => `blob:document-${++urls}`);
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

describe('the student verification queue', () => {
  it('opens on the pending submissions, with what a reviewer decides from', async () => {
    listMock.mockResolvedValue([WAITING]);
    render(<StudentVerificationQueue copy={COPY} />);

    expect(await screen.findByRole('link', { name: fillPlaceholders(COPY.openAccountLabel, { name: 'Ayan Məmmədova' }) }))
      .toHaveAttribute('href', `/en/admin/users/${AYAN}`);
    expect(listMock).toHaveBeenCalledWith('PENDING', expect.any(AbortSignal));
    expect(screen.getByText('ADA University')).toBeInTheDocument();
    expect(screen.getByText('ST20261234')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.state.PENDING })).toHaveAttribute('aria-pressed', 'true');
    // Nothing is opened until somebody asks: every opening is a line in the audit trail.
    expect(openMock).not.toHaveBeenCalled();
  });

  it('warns, with a link to each, when the card number has been used by another account', async () => {
    listMock.mockResolvedValue([SHARED]);
    render(<StudentVerificationQueue copy={COPY} />);

    expect(await screen.findByText(COPY.sameCardTitle)).toBeInTheDocument();
    const other = screen.getByRole('link', {
      name: fillPlaceholders(COPY.sameCardAccount, { name: 'Kamran Əliyev', state: COPY.state.REJECTED }),
    });
    expect(other).toHaveAttribute('href', `/en/admin/users/${KAMRAN}`);
  });

  it('opens both documents on request, a PDF as a link, and lets go of them when it goes', async () => {
    listMock.mockResolvedValue([WAITING]);
    openMock.mockImplementation(async (_id, kind) =>
      kind === 'STUDENT_CARD' ? new Blob(['%PDF'], { type: 'application/pdf' }) : new Blob(['jpg'], { type: 'image/jpeg' }),
    );
    const { unmount } = render(<StudentVerificationQueue copy={COPY} />);

    await userEvent.click(await screen.findByRole('button', { name: COPY.showDocuments }));

    expect(await screen.findByRole('img', { name: COPY.selfie })).toHaveAttribute('src', 'blob:document-2');
    expect(screen.getByRole('link', { name: COPY.openPdf })).toHaveAttribute('href', 'blob:document-1');
    expect(openMock).toHaveBeenCalledWith(WAITING.id, 'STUDENT_CARD', expect.any(AbortSignal));
    expect(openMock).toHaveBeenCalledWith(WAITING.id, 'SELFIE', expect.any(AbortSignal));

    unmount();
    expect(revoked.sort()).toEqual(['blob:document-1', 'blob:document-2']);
  });

  it('says a decided submission has no documents left', async () => {
    listMock.mockResolvedValue([APPROVED]);
    render(<StudentVerificationQueue copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.state.APPROVED }));

    expect(await screen.findByText(COPY.documentsErased)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.showDocuments })).not.toBeInTheDocument();
  });

  it('approves on the second press and takes the row off the pending list', async () => {
    listMock.mockResolvedValue([WAITING]);
    decideMock.mockResolvedValue(APPROVED);
    render(<StudentVerificationQueue copy={COPY} />);

    await userEvent.click(await screen.findByRole('button', { name: `${COPY.approve}: Ayan Məmmədova` }));
    expect(screen.getByText(fillPlaceholders(COPY.confirmApprove, { account: 'Ayan Məmmədova' }))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmApproveAction }));

    await waitFor(() => expect(decideMock).toHaveBeenCalledWith(WAITING.id, 'approve', null));
    expect(await screen.findByText(fillPlaceholders(COPY.approvedNotice, { account: 'Ayan Məmmədova' }))).toBeInTheDocument();
    expect(screen.queryByText('ST20261234')).not.toBeInTheDocument();
  });

  it('will not reject without a reason, and sends the one written', async () => {
    listMock.mockResolvedValue([WAITING]);
    decideMock.mockResolvedValue({ ...WAITING, state: 'REJECTED', rejectionReason: 'Blurred', documents: [] });
    render(<StudentVerificationQueue copy={COPY} />);

    await userEvent.click(await screen.findByRole('button', { name: `${COPY.reject}: Ayan Məmmədova` }));
    const form = screen.getByRole('form', { name: COPY.reject });
    await userEvent.click(within(form).getByRole('button', { name: COPY.confirmRejectAction }));
    expect(within(form).getByText(COPY.reasonMissing)).toBeInTheDocument();
    expect(decideMock).not.toHaveBeenCalled();

    await userEvent.type(within(form).getByLabelText(new RegExp(`^${COPY.reasonField}`)), 'Blurred');
    await userEvent.click(within(form).getByRole('button', { name: COPY.confirmRejectAction }));

    await waitFor(() => expect(decideMock).toHaveBeenCalledWith(WAITING.id, 'reject', 'Blurred'));
  });

  it('offers revoking on an approval, and nothing else', async () => {
    listMock.mockResolvedValue([APPROVED]);
    render(<StudentVerificationQueue copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.state.APPROVED }));

    expect(await screen.findByRole('button', { name: `${COPY.revoke}: Ayan Məmmədova` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${COPY.approve}: Ayan Məmmədova` })).not.toBeInTheDocument();
  });

  it('says a decision a colleague already made in the screen’s words, and reads the list again', async () => {
    listMock.mockResolvedValue([WAITING]);
    decideMock.mockRejectedValue(
      new ApiError(409, { status: 409, code: 'STUDENT_VERIFICATION_NOT_DECIDABLE', detail: 'Not decidable' }),
    );
    render(<StudentVerificationQueue copy={COPY} />);

    await userEvent.click(await screen.findByRole('button', { name: `${COPY.approve}: Ayan Məmmədova` }));
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmApproveAction }));

    expect(await screen.findByText(COPY.errors['STUDENT_VERIFICATION_NOT_DECIDABLE'] ?? '')).toBeInTheDocument();
    expect(screen.queryByText('Not decidable')).not.toBeInTheDocument();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it('keeps a decided row gone when a second decision answers after it (#655 review)', async () => {
    const OTHER: StudentVerificationRow = { ...WAITING, id: 'other', accountId: KAMRAN, accountName: 'Kamran Əliyev' };
    listMock.mockResolvedValue([WAITING, OTHER]);
    let answerFirst: (row: StudentVerificationRow) => void = () => {};
    let answerSecond: (row: StudentVerificationRow) => void = () => {};
    decideMock
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (answerSecond = resolve)));
    render(<StudentVerificationQueue copy={COPY} />);

    // Both decided before either answers: each row's request starts from the same list.
    await userEvent.click(await screen.findByRole('button', { name: `${COPY.approve}: Ayan Məmmədova` }));
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmApproveAction }));
    await userEvent.click(screen.getByRole('button', { name: `${COPY.approve}: Kamran Əliyev` }));
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmApproveAction }));

    answerFirst(APPROVED);
    await waitFor(() => expect(screen.queryByText('Ayan Məmmədova')).not.toBeInTheDocument());
    answerSecond({ ...OTHER, state: 'APPROVED', documents: [] });

    await waitFor(() => expect(screen.queryByText('Kamran Əliyev')).not.toBeInTheDocument());
    expect(screen.queryByText('Ayan Məmmədova')).not.toBeInTheDocument();
  });

  it('opens the documents once per press, not again when the list is read again', async () => {
    const OTHER: StudentVerificationRow = { ...WAITING, id: 'other', accountId: KAMRAN, accountName: 'Kamran Əliyev' };
    listMock.mockImplementation(async () => [{ ...WAITING }, { ...OTHER }]);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    openMock.mockImplementation(async () => {
      await held;
      return new Blob(['jpg'], { type: 'image/jpeg' });
    });
    decideMock.mockRejectedValue(
      new ApiError(409, { status: 409, code: 'STUDENT_VERIFICATION_NOT_DECIDABLE' }),
    );
    render(<StudentVerificationQueue copy={COPY} />);

    const ayan = (await screen.findByText('Ayan Məmmədova')).closest('li');
    if (ayan === null) throw new Error('no row');
    await userEvent.click(within(ayan).getByRole('button', { name: COPY.showDocuments }));
    expect(openMock).toHaveBeenCalledTimes(2);

    // A refused decision on the other row reads the list again while the documents are in flight.
    await userEvent.click(screen.getByRole('button', { name: `${COPY.approve}: Kamran Əliyev` }));
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmApproveAction }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));

    release();
    expect(await screen.findByRole('img', { name: COPY.selfie })).toBeInTheDocument();
    expect(openMock).toHaveBeenCalledTimes(2);
  });

  it('renders the console refusal for somebody without the capability', async () => {
    listMock.mockRejectedValue(new ApiError(403, { status: 403 }));
    render(<StudentVerificationQueue copy={COPY} />);

    expect(await screen.findByText(COPY.refusals.forbiddenTitle)).toBeInTheDocument();
  });

  it('has no accessibility violations with a warning and a decision open', async () => {
    listMock.mockResolvedValue([SHARED]);
    const { container } = render(<StudentVerificationQueue copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: `${COPY.reject}: Ayan Məmmədova` }));

    await expectNoViolations(container);
  });
});
