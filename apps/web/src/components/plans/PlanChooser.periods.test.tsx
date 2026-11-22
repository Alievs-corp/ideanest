import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { Plan } from '../../lib/plans/api';
import { formatPrice, readMySubscription, subscribeToPlan } from '../../lib/plans/api';
import { readMyStudentVerification, type StudentVerification } from '../../lib/plans/student';
import { pricingCopyFrom } from '../../lib/i18n/plans-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { PlanChooser, studentStep } from './PlanChooser';

/*
 * #655: the period switch and the student plan. A file of its own beside `PlanChooser.test.tsx`
 * so the student check's mock does not change what that suite's reads see.
 */
const COPY = pricingCopyFrom(translatorFor('pricing'));

vi.mock('../../lib/plans/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/plans/api')>()),
  readMySubscription: vi.fn(),
  subscribeToPlan: vi.fn(),
}));

vi.mock('../../lib/plans/student', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/plans/student')>()),
  readMyStudentVerification: vi.fn(),
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const readMock = vi.mocked(readMySubscription);
const subscribeMock = vi.mocked(subscribeToPlan);
const studentMock = vi.mocked(readMyStudentVerification);

const GROWTH: Plan = {
  id: '11111111-0000-4000-8000-000000000002',
  code: 'GROWTH',
  name: 'Growth',
  description: null,
  price: '49.00',
  currency: 'AZN',
  billingPeriod: 'MONTHLY',
  prices: [
    { billingPeriod: 'MONTHLY', price: '49.00', currency: 'AZN' },
    { billingPeriod: 'SEMIANNUAL', price: '264.00', currency: 'AZN' },
    { billingPeriod: 'YEARLY', price: '499.00', currency: 'AZN' },
  ],
  studentOnly: false,
  maxActiveCampaigns: 3,
  goalCeiling: null,
  listed: true,
  sortOrder: 20,
  updatedAt: '2026-11-01T09:00:00Z',
};

/** Sold by the month only: the switch's other positions show it as not sold. */
const STUDENT: Plan = {
  ...GROWTH,
  id: '11111111-0000-4000-8000-000000000005',
  code: 'STUDENT',
  name: 'Campus',
  price: '10.00',
  prices: [{ billingPeriod: 'MONTHLY', price: '10.00', currency: 'AZN' }],
  studentOnly: true,
  maxActiveCampaigns: 1,
  sortOrder: 5,
};

function verification(state: StudentVerification['state']): StudentVerification {
  return {
    state,
    institution: state === 'NONE' ? null : 'ADA University',
    cardNumber: state === 'NONE' ? null : 'ST12345',
    submittedAt: state === 'NONE' ? null : '2026-11-01T09:00:00Z',
    decidedAt: null,
    validUntil: null,
    rejectionReason: null,
  };
}

function card(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const item = heading.closest('li');
  if (item === null) throw new Error(`no card for ${name}`);
  return item;
}

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/en/pricing');
});

describe('the period switch', () => {
  it('reads what the reader holds in the page language (#655)', async () => {
    readMock.mockResolvedValue({ subscription: null });
    render(<PlanChooser plans={[GROWTH]} copy={COPY} locale="ru" />);

    await waitFor(() => expect(readMock).toHaveBeenCalledWith('ru', expect.any(AbortSignal)));
  });

  it('offers only the periods some plan is sold for, and reprices the cards', async () => {
    readMock.mockResolvedValue({ subscription: null });
    render(<PlanChooser plans={[GROWTH]} copy={COPY} locale="en" />);

    const group = screen.getByRole('group', { name: COPY.periods.label });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual([
      COPY.periods.MONTHLY,
      COPY.periods.SEMIANNUAL,
      COPY.periods.YEARLY,
    ]);
    expect(card('Growth').textContent).toContain(formatPrice('49.00', 'AZN', 'en'));
    expect(within(card('Growth')).getByText(COPY.per.MONTHLY)).toBeInTheDocument();

    await userEvent.click(within(group).getByRole('button', { name: COPY.periods.SEMIANNUAL }));

    expect(card('Growth').textContent).toContain(formatPrice('264.00', 'AZN', 'en'));
    expect(within(card('Growth')).getByText(COPY.per.SEMIANNUAL)).toBeInTheDocument();
  });

  it('draws no switch when every plan is sold for one period', () => {
    readMock.mockReturnValue(new Promise(() => {}));
    render(<PlanChooser plans={[STUDENT]} copy={COPY} locale="en" />);

    expect(screen.queryByRole('group', { name: COPY.periods.label })).not.toBeInTheDocument();
  });

  it('keeps a plan that is not sold for the period, says so, and does not offer it', async () => {
    readMock.mockResolvedValue({ subscription: null });
    studentMock.mockResolvedValue(verification('APPROVED'));
    render(<PlanChooser plans={[STUDENT, GROWTH]} copy={COPY} locale="en" />);

    await userEvent.click(screen.getByRole('button', { name: COPY.periods.YEARLY }));

    const student = card('Campus');
    expect(
      within(student).getByText(fillPlaceholders(COPY.periods.notOffered, { period: COPY.periods.YEARLY })),
    ).toBeInTheDocument();
    const choose = within(student).getByRole('button', { name: /Campus$/ });
    expect(choose).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(choose);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('sends the period the switch is on', async () => {
    readMock.mockResolvedValue({ subscription: null });
    subscribeMock.mockResolvedValue({ subscription: null });
    render(<PlanChooser plans={[GROWTH]} copy={COPY} locale="en" />);
    await waitFor(() => expect(readMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: COPY.periods.YEARLY }));
    await userEvent.click(screen.getByRole('button', { name: `${COPY.choose}: Growth` }));

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledWith(GROWTH.id, 'YEARLY', 'en'));
  });

  it('says a refused period in words', async () => {
    readMock.mockResolvedValue({ subscription: null });
    subscribeMock.mockRejectedValue(new ApiError(400, { status: 400, code: 'PERIOD_NOT_OFFERED' }));
    render(<PlanChooser plans={[GROWTH]} copy={COPY} locale="en" />);
    await waitFor(() => expect(readMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: `${COPY.choose}: Growth` }));

    expect(await screen.findByText(COPY.errors.periodNotOffered)).toBeInTheDocument();
  });
});

describe('a student plan', () => {
  it('is labelled, and says a student card is checked first', () => {
    readMock.mockReturnValue(new Promise(() => {}));
    render(<PlanChooser plans={[STUDENT]} copy={COPY} locale="en" />);

    const student = card('Campus');
    expect(within(student).getByText(COPY.student.label)).toBeInTheDocument();
    expect(within(student).getByText(COPY.student.needsCheck)).toBeInTheDocument();
    // Signed in or not, nothing is read about a card until the reader's session is known.
    expect(studentMock).not.toHaveBeenCalled();
  });

  it.each(['NONE', 'REJECTED', 'EXPIRED'] as const)('sends a reader whose check is %s to the student page', async (state) => {
    readMock.mockResolvedValue({ subscription: null });
    studentMock.mockResolvedValue(verification(state));
    render(<PlanChooser plans={[STUDENT]} copy={COPY} locale="en" />);

    const link = await within(card('Campus')).findByRole('link', { name: `${COPY.student.verify}: Campus` });
    expect(link).toHaveAttribute('href', '/en/account/student');
  });

  it('says the card is being checked, and does nothing, while it is pending', async () => {
    readMock.mockResolvedValue({ subscription: null });
    studentMock.mockResolvedValue(verification('PENDING'));
    render(<PlanChooser plans={[STUDENT]} copy={COPY} locale="en" />);

    const button = await within(card('Campus')).findByRole('button', { name: `${COPY.student.pending}: Campus` });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('subscribes an approved reader like any other plan', async () => {
    readMock.mockResolvedValue({ subscription: null });
    studentMock.mockResolvedValue(verification('APPROVED'));
    subscribeMock.mockResolvedValue({ subscription: null });
    render(<PlanChooser plans={[STUDENT]} copy={COPY} locale="en" />);
    await waitFor(() => expect(studentMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: `${COPY.choose}: Campus` }));

    await waitFor(() => expect(subscribeMock).toHaveBeenCalledWith(STUDENT.id, 'MONTHLY', 'en'));
  });

  it('offers the ordinary button when the check could not be read, and says the refusal', async () => {
    readMock.mockResolvedValue({ subscription: null });
    studentMock.mockRejectedValue(new ApiError(503, null, 'down'));
    subscribeMock.mockRejectedValue(new ApiError(403, { status: 403, code: 'STUDENT_VERIFICATION_REQUIRED' }));
    render(<PlanChooser plans={[STUDENT]} copy={COPY} locale="en" />);
    await waitFor(() => expect(studentMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: `${COPY.choose}: Campus` }));

    expect(await screen.findByText(COPY.errors.studentVerificationRequired)).toBeInTheDocument();
  });

  it('has no accessibility violations with the switch and a student card drawn', async () => {
    readMock.mockResolvedValue({ subscription: null });
    studentMock.mockResolvedValue(verification('PENDING'));
    const { container } = render(<PlanChooser plans={[STUDENT, GROWTH]} copy={COPY} locale="en" />);
    await within(card('Campus')).findByRole('button', { name: `${COPY.student.pending}: Campus` });

    await expectNoViolations(container);
  });
});

describe('studentStep', () => {
  it('reads unknown and approved as the ordinary button', () => {
    expect(studentStep(null)).toBe('choose');
    expect(studentStep(verification('APPROVED'))).toBe('choose');
  });

  it('reads pending as waiting, and anything else as "send your card"', () => {
    expect(studentStep(verification('PENDING'))).toBe('pending');
    expect(studentStep(verification('NONE'))).toBe('verify');
    expect(studentStep(verification('REJECTED'))).toBe('verify');
    expect(studentStep(verification('EXPIRED'))).toBe('verify');
  });
});
