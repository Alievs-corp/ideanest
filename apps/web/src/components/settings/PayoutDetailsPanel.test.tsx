import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  beginPayoutCardRegistration,
  getMyLegalSubject,
  getMyPayoutDestination,
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
  beginPayoutCardRegistration: vi.fn(),
}));

vi.mock('../../lib/pledges/payment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pledges/payment')>()),
  leaveForPaymentPage: vi.fn(),
}));

const COPY = payoutPanelCopyFrom(translatorFor('settings.panels.payout'));

const NOTHING: LegalSubject = { recorded: false, complete: false };
const CARD: PayoutDestination = {
  recorded: true,
  standing: 'AWAITING_VERIFICATION',
  provider: 'EPOINT',
  holderName: 'AYSEL MAMMADOVA',
  displayHint: '**1234',
  updatedAt: '2026-09-13T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMyLegalSubject).mockResolvedValue(NOTHING);
  vi.mocked(getMyPayoutDestination).mockResolvedValue(CARD);
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

describe('the business card', () => {
  it('shows the card on file and its standing in words, never a card number field', async () => {
    render(<PayoutDetailsPanel copy={COPY} />);

    expect(await screen.findByText('**1234, held by AYSEL MAMMADOVA')).toBeInTheDocument();
    expect(screen.getByText(COPY.standingAwaiting)).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
  });

  it('opens the provider’s page, returning to this page in its language', async () => {
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
    vi.mocked(getMyPayoutDestination).mockResolvedValue({ recorded: false, standing: 'NONE' });
    vi.mocked(beginPayoutCardRegistration).mockRejectedValue(
      new ApiError(503, { status: 503, code: 'PAYOUT_CARDS_UNAVAILABLE' }),
    );
    const user = userEvent.setup();
    render(<PayoutDetailsPanel copy={COPY} />);

    expect(await screen.findByText(COPY.cardNone)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.register }));

    expect(await screen.findByText(COPY.unavailable)).toBeInTheDocument();
    expect(leaveForPaymentPage).not.toHaveBeenCalled();
  });
});
