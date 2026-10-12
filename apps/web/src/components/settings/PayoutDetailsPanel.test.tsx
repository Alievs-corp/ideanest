import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  beginPayoutCardRegistration,
  getMyLegalSubject,
  getMyPayoutDestination,
  saveMyBankAccount,
  saveMyLegalSubject,
  type LegalSubject,
  type PayoutDestination,
} from '../../lib/account/payout';
import { payoutPanelCopyFrom } from '../../lib/i18n/payout-copy';
import { leaveForPaymentPage } from '../../lib/pledges/payment';
import { translatorFor } from '../../test-copy';
import { PayoutDetailsPanel } from './PayoutDetailsPanel';

vi.mock('../../lib/account/payout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/account/payout')>()),
  getMyLegalSubject: vi.fn(),
  saveMyLegalSubject: vi.fn(),
  getMyPayoutDestination: vi.fn(),
  saveMyBankAccount: vi.fn(),
  beginPayoutCardRegistration: vi.fn(),
}));

vi.mock('../../lib/pledges/payment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/payment')>()),
  leaveForPaymentPage: vi.fn(),
}));

const COPY = payoutPanelCopyFrom(translatorFor('settings.panels.payout'));

/** The SWIFT registry's Azerbaijani example: a valid IBAN nobody holds. */
const IBAN = 'AZ21NABZ00000000137010001944';

const NOTHING: LegalSubject = { recorded: false, complete: false };
const AYSEL: LegalSubject = {
  recorded: true,
  complete: true,
  subjectKind: 'INDIVIDUAL',
  legalName: 'Aysel Məmmədova',
};
const NONE: PayoutDestination = { recorded: false, standing: 'NONE', cardRegistrationAvailable: false };
const ACCOUNT: PayoutDestination = {
  recorded: true,
  standing: 'AWAITING_VERIFICATION',
  kind: 'BANK_TRANSFER',
  cardRegistrationAvailable: false,
  provider: 'BANK_TRANSFER',
  holderName: 'Aysel Məmmədova',
  displayHint: 'AZ21…1944',
  updatedAt: '2026-10-12T10:00:00Z',
};
const CARD: PayoutDestination = {
  recorded: true,
  standing: 'AWAITING_VERIFICATION',
  kind: 'PROVIDER_TOKEN',
  cardRegistrationAvailable: true,
  provider: 'EPOINT',
  holderName: 'AYSEL MAMMADOVA',
  displayHint: '**1234',
  updatedAt: '2026-09-13T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMyLegalSubject).mockResolvedValue(NOTHING);
  vi.mocked(getMyPayoutDestination).mockResolvedValue(NONE);
});

afterEach(cleanup);

describe('who is paid', () => {
  it('saves the legal name and the VÖEN', async () => {
    vi.mocked(saveMyLegalSubject).mockResolvedValue({ recorded: true, complete: true });
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    await user.type(await screen.findByLabelText(/Legal name/), 'Aysel Məmmədova');
    await user.type(screen.getByLabelText(/VÖEN/), '1234567890');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(saveMyLegalSubject).toHaveBeenCalledWith({
        subjectKind: 'INDIVIDUAL',
        legalName: 'Aysel Məmmədova',
        taxId: '1234567890',
        registeredAddress: null,
        registrationNumber: null,
      }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('puts a malformed VÖEN beside the field', async () => {
    vi.mocked(saveMyLegalSubject).mockRejectedValue(
      new ApiError(400, { status: 400, code: 'MALFORMED_TAX_IDENTIFIER' }),
    );
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    await user.type(await screen.findByLabelText(/Legal name/), 'Aysel Məmmədova');
    await user.type(screen.getByLabelText(/VÖEN/), '123');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(COPY.malformedTaxId)).toBeInTheDocument();
  });
});

describe('the bank account', () => {
  it('shows the account on file as its masked hint, with its standing in words', async () => {
    vi.mocked(getMyPayoutDestination).mockResolvedValue(ACCOUNT);
    render(<PayoutDetailsPanel copy={COPY} />);

    expect(await screen.findByText('Bank account AZ21…1944, held by Aysel Məmmədova')).toBeInTheDocument();
    expect(screen.getByText(COPY.standingAwaiting)).toBeInTheDocument();
    // The number itself is never drawn back, not even into the field.
    expect(screen.getByLabelText(/IBAN/)).toHaveValue('');
    expect(screen.getByLabelText(/Account holder/)).toHaveValue('Aysel Məmmədova');
  });

  it('says there is no account yet, and offers the holder field the legal name', async () => {
    vi.mocked(getMyLegalSubject).mockResolvedValue(AYSEL);
    render(<PayoutDetailsPanel copy={COPY} />);

    expect(await screen.findByText(COPY.accountNone)).toBeInTheDocument();
    expect(screen.getByLabelText(/Account holder/)).toHaveValue('Aysel Məmmədova');
  });

  it('groups the IBAN in fours as it is typed, and sends it in one piece', async () => {
    vi.mocked(getMyLegalSubject).mockResolvedValue(AYSEL);
    vi.mocked(saveMyBankAccount).mockResolvedValue(ACCOUNT);
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    const field = await screen.findByLabelText(/IBAN/);
    await user.type(field, 'az21nabz00000000137010001944');
    expect(field).toHaveValue('AZ21 NABZ 0000 0000 1370 1000 1944');

    await user.click(screen.getByRole('button', { name: COPY.saveBank }));

    await waitFor(() =>
      expect(saveMyBankAccount).toHaveBeenCalledWith({ iban: IBAN, holderName: 'Aysel Məmmədova' }),
    );
    expect(await screen.findByText(COPY.bankSaved)).toBeInTheDocument();
    expect(screen.getByText('Bank account AZ21…1944, held by Aysel Məmmədova')).toBeInTheDocument();
    expect(field).toHaveValue('');
  });

  it('says what is wrong with a mistyped IBAN beside the field, and sends nothing', async () => {
    vi.mocked(getMyLegalSubject).mockResolvedValue(AYSEL);
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    const field = await screen.findByLabelText(/IBAN/);
    await user.type(field, 'AZ21NABZ00000000137010001945');
    await user.click(screen.getByRole('button', { name: COPY.saveBank }));

    const error = await screen.findByText(COPY.ibanDefect.CHECKSUM);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain(error.closest('p')?.id);
    expect(field).toHaveFocus();
    expect(saveMyBankAccount).not.toHaveBeenCalled();

    await user.type(field, '0');
    expect(screen.queryByText(COPY.ibanDefect.CHECKSUM)).not.toBeInTheDocument();
  });

  it('says a foreign IBAN is not one a creator is paid to', async () => {
    vi.mocked(getMyLegalSubject).mockResolvedValue(AYSEL);
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    await user.type(await screen.findByLabelText(/IBAN/), 'GB82 WEST 1234 5698 7654 32');
    await user.click(screen.getByRole('button', { name: COPY.saveBank }));

    expect(await screen.findByText(COPY.ibanDefect.COUNTRY_NOT_ACCEPTED)).toBeInTheDocument();
    expect(saveMyBankAccount).not.toHaveBeenCalled();
  });

  it('reads the service’s MALFORMED_IBAN defect into the same sentence', async () => {
    vi.mocked(getMyLegalSubject).mockResolvedValue(AYSEL);
    vi.mocked(saveMyBankAccount).mockRejectedValue(
      new ApiError(400, { status: 400, code: 'MALFORMED_IBAN', meta: { defect: 'FORMAT' } }),
    );
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    await user.type(await screen.findByLabelText(/IBAN/), IBAN);
    await user.click(screen.getByRole('button', { name: COPY.saveBank }));

    expect(await screen.findByText(COPY.ibanDefect.FORMAT)).toBeInTheDocument();
  });

  it('says an account cannot be saved now when the deployment has no key for it', async () => {
    vi.mocked(getMyLegalSubject).mockResolvedValue(AYSEL);
    vi.mocked(saveMyBankAccount).mockRejectedValue(
      new ApiError(503, { status: 503, code: 'ENCRYPTED_STORAGE_UNAVAILABLE' }),
    );
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    await user.type(await screen.findByLabelText(/IBAN/), IBAN);
    await user.click(screen.getByRole('button', { name: COPY.saveBank }));

    expect(await screen.findByText(COPY.bankUnavailable)).toBeInTheDocument();
    expect(screen.getByLabelText(/IBAN/)).toHaveValue('AZ21 NABZ 0000 0000 1370 1000 1944');
  });

  it('says in words that the holder’s name does not match, and what to do', async () => {
    vi.mocked(getMyPayoutDestination).mockResolvedValue({ ...ACCOUNT, standing: 'NAME_MISMATCH', holderName: 'Someone Else' });
    render(<PayoutDetailsPanel copy={COPY} />);

    expect(await screen.findByText(COPY.standingMismatch)).toBeInTheDocument();
    expect(screen.getByText(COPY.mismatchHelp)).toBeInTheDocument();
  });
});

describe('the business card', () => {
  it('is not offered when the provider cannot register one', async () => {
    vi.mocked(getMyPayoutDestination).mockResolvedValue(ACCOUNT);
    render(<PayoutDetailsPanel copy={COPY} />);

    expect(await screen.findByText(COPY.bankHeading)).toBeInTheDocument();
    expect(screen.queryByText(COPY.cardHeading)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.register })).not.toBeInTheDocument();
  });

  it('shows a card on file as a card, and its standing in words, never a card number field', async () => {
    vi.mocked(getMyPayoutDestination).mockResolvedValue(CARD);
    render(<PayoutDetailsPanel copy={COPY} />);

    expect(await screen.findByText('Business card **1234, held by AYSEL MAMMADOVA')).toBeInTheDocument();
    expect(screen.getByText(COPY.standingAwaiting)).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
  });

  it('opens the provider’s page, returning to this page in its language', async () => {
    vi.mocked(getMyPayoutDestination).mockResolvedValue(CARD);
    vi.mocked(beginPayoutCardRegistration).mockResolvedValue({
      provider: 'EPOINT',
      redirectUrl: 'https://epoint.test/card/cev000123',
    });
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.replace }));

    const page = `${window.location.origin}/en/settings/payout`;
    await waitFor(() =>
      expect(beginPayoutCardRegistration).toHaveBeenCalledWith({
        language: 'en',
        successUrl: `${page}?card=returned`,
        errorUrl: `${page}?card=failed`,
      }),
    );
    expect(leaveForPaymentPage).toHaveBeenCalledWith('https://epoint.test/card/cev000123');
  });

  it('says a card cannot be registered now, and goes nowhere, when no provider can', async () => {
    vi.mocked(getMyPayoutDestination).mockResolvedValue({ ...NONE, cardRegistrationAvailable: true });
    vi.mocked(beginPayoutCardRegistration).mockRejectedValue(
      new ApiError(503, { status: 503, code: 'PAYOUT_CARDS_UNAVAILABLE' }),
    );
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    expect(await screen.findByText(COPY.accountNone)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.register }));

    expect(await screen.findByText(COPY.unavailable)).toBeInTheDocument();
    expect(leaveForPaymentPage).not.toHaveBeenCalled();
  });
});
