import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  STUDENT_DOCUMENT_MAX_BYTES,
  readMyStudentVerification,
  submitStudentVerification,
  type StudentVerification,
} from '../../lib/plans/student';
import { studentVerificationCopyFrom } from '../../lib/i18n/student-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { StudentVerificationPanel, maskCardNumber } from './StudentVerificationPanel';

const COPY = studentVerificationCopyFrom(translatorFor('account.student'));

vi.mock('../../lib/plans/student', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/plans/student')>()),
  readMyStudentVerification: vi.fn(),
  submitStudentVerification: vi.fn(),
}));

const readMock = vi.mocked(readMyStudentVerification);
const submitMock = vi.mocked(submitStudentVerification);

const NONE: StudentVerification = {
  state: 'NONE',
  institution: null,
  cardNumber: null,
  submittedAt: null,
  decidedAt: null,
  validUntil: null,
  rejectionReason: null,
};

const PENDING: StudentVerification = {
  ...NONE,
  state: 'PENDING',
  institution: 'ADA University',
  cardNumber: 'ST20261234',
  submittedAt: '2026-11-20T09:00:00Z',
};

function file(name: string, type: string, bytes = 1024): File {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: bytes });
  return made;
}

const CARD_LABEL = new RegExp(`^${COPY.studentCardField}`);
const SELFIE_LABEL = new RegExp(`^${COPY.selfieField}`);

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/en/account/student');
  // jsdom has no object URLs; the preview only needs one to exist.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

async function fillForm(): Promise<void> {
  await userEvent.type(screen.getByLabelText(new RegExp(`^${COPY.institutionField}`)), 'ADA University');
  await userEvent.type(screen.getByLabelText(new RegExp(`^${COPY.cardNumberField}`)), 'ST20261234');
  await userEvent.upload(screen.getByLabelText(CARD_LABEL), file('card.pdf', 'application/pdf'));
  await userEvent.upload(screen.getByLabelText(SELFIE_LABEL), file('me.jpg', 'image/jpeg'));
}

describe('the student verification panel', () => {
  it('offers the form to somebody who has sent nothing, and says why a selfie is asked for', async () => {
    readMock.mockResolvedValue(NONE);
    render(<StudentVerificationPanel copy={COPY} />);

    expect(await screen.findByText(COPY.state.NONE)).toBeInTheDocument();
    expect(screen.getByText(COPY.why)).toBeInTheDocument();
    const selfie = screen.getByLabelText(SELFIE_LABEL);
    expect(selfie).toHaveAttribute('accept', 'image/jpeg,image/png');
    expect(selfie).toHaveAttribute('capture', 'user');
    expect(screen.getByLabelText(CARD_LABEL)).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');
  });

  it('shows a pending check with the card number masked, and no form', async () => {
    readMock.mockResolvedValue(PENDING);
    render(<StudentVerificationPanel copy={COPY} />);

    expect(await screen.findByText(COPY.state.PENDING)).toBeInTheDocument();
    expect(screen.getByText('ADA University')).toBeInTheDocument();
    expect(screen.getByText('•••• 1234')).toBeInTheDocument();
    expect(screen.queryByText('ST20261234')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.submit })).not.toBeInTheDocument();
  });

  it('shows the reason for a refusal beside the form to send again', async () => {
    readMock.mockResolvedValue({ ...PENDING, state: 'REJECTED', rejectionReason: 'The photo is blurred.' });
    render(<StudentVerificationPanel copy={COPY} />);

    expect(await screen.findByText('The photo is blurred.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.submit })).toBeInTheDocument();
  });

  it('refuses a file over the limit before sending anything', async () => {
    readMock.mockResolvedValue(NONE);
    render(<StudentVerificationPanel copy={COPY} />);
    await screen.findByText(COPY.state.NONE);

    await userEvent.upload(
      screen.getByLabelText(SELFIE_LABEL),
      file('huge.jpg', 'image/jpeg', STUDENT_DOCUMENT_MAX_BYTES + 1),
    );

    expect(screen.getByText(COPY.refusals.tooLarge)).toBeInTheDocument();
    expect(screen.getByLabelText(SELFIE_LABEL)).toHaveAttribute('aria-invalid', 'true');
  });

  it('says what is missing rather than sending an incomplete form', async () => {
    readMock.mockResolvedValue(NONE);
    render(<StudentVerificationPanel copy={COPY} />);
    await screen.findByText(COPY.state.NONE);

    await userEvent.click(screen.getByRole('button', { name: COPY.submit }));

    expect(screen.getByText(COPY.institutionMissing)).toBeInTheDocument();
    expect(screen.getByText(COPY.cardNumberInvalid)).toBeInTheDocument();
    expect(screen.getAllByText(COPY.fileMissing)).toHaveLength(2);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('sends the four parts and then says the card is being checked', async () => {
    readMock.mockResolvedValue(NONE);
    submitMock.mockResolvedValue(PENDING);
    render(<StudentVerificationPanel copy={COPY} />);
    await screen.findByText(COPY.state.NONE);

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: COPY.submit }));

    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    const sent = submitMock.mock.calls[0]?.[0];
    expect(sent?.institution).toBe('ADA University');
    expect(sent?.cardNumber).toBe('ST20261234');
    expect(sent?.studentCard.name).toBe('card.pdf');
    expect(sent?.selfie.name).toBe('me.jpg');
    expect(await screen.findByText(COPY.sentTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.submit })).not.toBeInTheDocument();
  });

  it('says a refused file under the file the service named', async () => {
    readMock.mockResolvedValue(NONE);
    // The identity module puts `field` on the problem itself, beside `code`.
    const problem = { status: 400, code: 'UNSUPPORTED_TYPE', field: 'selfie' };
    submitMock.mockRejectedValue(new ApiError(400, problem));
    render(<StudentVerificationPanel copy={COPY} />);
    await screen.findByText(COPY.state.NONE);

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: COPY.submit }));

    expect(await screen.findByText(COPY.refusals.unsupportedFile)).toBeInTheDocument();
    expect(screen.getByLabelText(SELFIE_LABEL)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(CARD_LABEL)).not.toHaveAttribute('aria-invalid');
  });

  it('says a card in use elsewhere above the button', async () => {
    readMock.mockResolvedValue(NONE);
    submitMock.mockRejectedValue(new ApiError(409, { status: 409, code: 'STUDENT_CARD_IN_USE' }));
    render(<StudentVerificationPanel copy={COPY} />);
    await screen.findByText(COPY.state.NONE);

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: COPY.submit }));

    expect(await screen.findByText(COPY.refusals.cardInUse)).toBeInTheDocument();
  });

  it('says it could not read the check rather than offering the form', async () => {
    readMock.mockRejectedValue(new ApiError(503, null, 'down'));
    render(<StudentVerificationPanel copy={COPY} />);

    expect(await screen.findByText(COPY.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.submit })).not.toBeInTheDocument();
  });

  it('has no accessibility violations with the form drawn', async () => {
    readMock.mockResolvedValue(NONE);
    const { container } = render(<StudentVerificationPanel copy={COPY} />);
    await screen.findByText(COPY.state.NONE);
    await userEvent.upload(screen.getByLabelText(SELFIE_LABEL), file('me.jpg', 'image/jpeg'));

    expect(screen.getByRole('img', { name: COPY.selfiePreview })).toBeInTheDocument();
    expect(screen.getByText(fillPlaceholders(COPY.selfieHint, { megabytes: '5' }))).toBeInTheDocument();
    await expectNoViolations(container);
  });
});

describe('maskCardNumber', () => {
  it('keeps the last four characters', () => {
    expect(maskCardNumber('ST20261234')).toBe('•••• 1234');
    expect(maskCardNumber('123')).toBe('123');
  });
});
