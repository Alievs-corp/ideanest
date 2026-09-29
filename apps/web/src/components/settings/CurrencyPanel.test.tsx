import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import messages from '@ideanest/messages/en.json';
import { authorizedFetch } from '../../lib/api/client';
import { CurrencyPanel } from './CurrencyPanel';
import { useSession } from '../session/SessionProvider';

/**
 * §4.2's P-10, the currency half — issue #327.
 *
 * <p>The assertions that carry the design:
 *
 * <ul>
 *   <li>{@link #aPlatformWithNothingToOfferDrawsASentence} — <strong>#280's argument, kept
 *       alive.</strong> That issue refused a control with one option, because a control that
 *       cannot be used is worse than a sentence. #327 gave the platform something to offer
 *       <em>sometimes</em>, and the deployments where it has not — the feature off, the
 *       source unreachable — must still get the sentence.
 *   <li>The hint says what a display currency is, every time. A backer who believed they
 *       were being charged in dollars would find out from their card statement.
 *   <li>A save refreshes the session, because every other surface reads the currency there.
 * </ul>
 */

vi.mock('../../lib/api/client', () => ({ authorizedFetch: vi.fn() }));
vi.mock('../session/SessionProvider', () => ({ useSession: vi.fn() }));

const fetchMock = vi.mocked(authorizedFetch);
const sessionMock = vi.mocked(useSession);

const copy = {
  fieldLabel: messages.settings.currency.fieldLabel,
  fieldHint: messages.settings.currency.fieldHint,
  save: messages.settings.currency.save,
  saving: messages.common.saving,
  saved: messages.settings.currency.saved,
  failed: messages.settings.currency.failed,
  unavailable: messages.settings.currency.unavailable,
};

const refresh = vi.fn();

function signedInAs(currency: string | null) {
  sessionMock.mockReturnValue({
    status: 'signed-in',
    session: {
      id: 'u-1',
      email: 'backer@example.com',
      name: 'A Backer',
      slug: 'a-backer',
      emailVerified: true,
      currency,
    },
    refresh,
    signOut: vi.fn(),
  });
}

function renderPanel(currencies: readonly string[] = ['AZN', 'USD', 'EUR']) {
  return render(<CurrencyPanel copy={copy} currencies={currencies} baseCurrency="AZN" />);
}

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  signedInAs('AZN');
});

describe('the currency control', () => {
  it('opens on the currency the account holds', () => {
    signedInAs('USD');
    renderPanel();

    expect(screen.getByRole('combobox', { name: copy.fieldLabel })).toHaveValue('USD');
  });

  it('falls back to the platform’s own while the session is still being read', () => {
    sessionMock.mockReturnValue({
      status: 'unknown',
      session: null,
      refresh,
      signOut: vi.fn(),
    });
    renderPanel();

    // Not blank, and not the first option by accident: the base currency is what every
    // amount is already in, so it is the honest value to show before the account answers.
    expect(screen.getByRole('combobox', { name: copy.fieldLabel })).toHaveValue('AZN');
  });

  it('says what a display currency is, rather than implying a second price', () => {
    renderPanel();

    // §21.2: the figure is an approximation and collection occurs in the project's currency.
    // A backer who believed otherwise would find out from their card statement.
    expect(screen.getByText(copy.fieldHint)).toBeInTheDocument();
  });

  it('saves the choice and refreshes the session', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    renderPanel();

    await user.selectOptions(screen.getByRole('combobox', { name: copy.fieldLabel }), 'EUR');
    await user.click(screen.getByRole('button', { name: copy.save }));

    await screen.findByText(copy.saved);
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/me/currency',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ currency: 'EUR' }) }),
    );
    // The header, the pledge list and the checkout all read the currency off the session, so
    // without this they would keep showing the old approximation until the next page load.
    expect(refresh).toHaveBeenCalled();
  });

  it('reports a refusal without claiming the currency changed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    renderPanel();

    await user.click(screen.getByRole('button', { name: copy.save }));

    await waitFor(() => expect(screen.getByText(copy.failed)).toBeInTheDocument());
    expect(screen.queryByText(copy.saved)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('drops a stale success when a different currency is selected', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    renderPanel();

    await user.click(screen.getByRole('button', { name: copy.save }));
    await screen.findByText(copy.saved);

    await user.selectOptions(screen.getByRole('combobox', { name: copy.fieldLabel }), 'USD');

    // "Currency saved." above a different choice is a true sentence in a place that makes it
    // read as false.
    expect(screen.queryByText(copy.saved)).not.toBeInTheDocument();
  });
});

describe('a platform with nothing to offer', () => {
  /**
   * #280's argument, kept alive.
   *
   * <p>That issue refused a control with one option — "a selector here would offer to convert
   * manat into manat" — and #327 did not make that wrong, it made it conditional. A
   * deployment with the feature off, or one whose rate source has been unreachable past its
   * limit, is still in exactly the state #280 described.
   */
  it('draws a sentence rather than a select with one option', () => {
    renderPanel(['AZN']);

    expect(screen.getByText(copy.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.save })).not.toBeInTheDocument();
  });
});
