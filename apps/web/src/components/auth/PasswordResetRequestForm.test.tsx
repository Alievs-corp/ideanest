import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { requestPasswordReset } from '../../lib/auth/passwordReset';
import { PasswordResetRequestForm } from './PasswordResetRequestForm';
import { passwordResetCopyFrom } from '../../lib/i18n/auth-copy';
import { translatorFor } from '../../test-copy';

/*
 * The copy the page would have resolved, built from `messages/en.json` by the same function it
 * calls — issue #324. Retyping the sentences here would give a test that passes whatever the
 * catalogue says, which is the opposite of what it is for.
 */
const COPY = passwordResetCopyFrom(translatorFor('auth'));

/**
 * §4.1's A-06, first half — issue #271.
 *
 * WHAT THESE COVER:
 *
 *   - **the screen after submitting says nothing about whether the account exists.** The
 *     endpoint answers 202 either way precisely so it is not an enumeration oracle, and a
 *     client that wrote "check your inbox — we have sent you a link" would give away for free
 *     what the service went to some trouble not to say.
 *   - the link's one hour and single use are stated on the confirmation, while somebody can
 *     still act on them, rather than only in the refusal an hour later.
 *   - the field is labelled and a refusal is announced and takes focus, so a keyboard reader
 *     who submits is put on the message rather than left to find it.
 */

vi.mock('../../lib/auth/passwordReset', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/auth/passwordReset')>()),
  requestPasswordReset: vi.fn(),
}));

const requestMock = vi.mocked(requestPasswordReset);

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

async function ask(user: ReturnType<typeof userEvent.setup>, address: string): Promise<void> {
  await user.type(screen.getByLabelText(/Email address/u), address);
  await user.click(screen.getByRole('button', { name: 'Send the link' }));
}

describe('asking for a link', () => {
  it('sends the trimmed address to the service', async () => {
    const user = userEvent.setup();
    render(<PasswordResetRequestForm copy={COPY} />);

    await ask(user, '  aysel@example.com  ');

    expect(requestMock).toHaveBeenCalledWith('aysel@example.com');
  });

  it('never claims an account exists, whatever was typed', async () => {
    const user = userEvent.setup();
    render(<PasswordResetRequestForm copy={COPY} />);

    await ask(user, 'nobody@example.com');

    // "If that address has an account" is the only sentence this screen is entitled to write.
    expect(await screen.findByText(/has an IdeyaNest account/u)).toBeInTheDocument();
    expect(screen.queryByText(/we have sent you a link/iu)).not.toBeInTheDocument();
    // The address is echoed because a typo is the commonest reason nothing arrives — and it is
    // the reader's own address rather than anything the service disclosed.
    expect(screen.getByText('nobody@example.com')).toBeInTheDocument();
  });

  it('states the hour and the single use while they can still be acted on', async () => {
    const user = userEvent.setup();
    render(<PasswordResetRequestForm copy={COPY} />);

    await ask(user, 'aysel@example.com');

    expect(await screen.findByText(/works for one hour and can be used once/u)).toBeInTheDocument();
  });

  it('offers a way back to the form, because a typo produces the same screen', async () => {
    const user = userEvent.setup();
    render(<PasswordResetRequestForm copy={COPY} />);

    await ask(user, 'ayzel@example.com');
    await user.click(await screen.findByRole('button', { name: 'try another address' }));

    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument();
  });
});

describe('a refusal', () => {
  it('shows the service’s sentence, keeps the control, and takes focus', async () => {
    const user = userEvent.setup();
    requestMock.mockRejectedValue(
      new ApiError(429, { title: 'Too many attempts', detail: 'Wait a little.', retryAfterSeconds: 300 }),
    );

    render(<PasswordResetRequestForm copy={COPY} />);
    await ask(user, 'aysel@example.com');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many attempts');
    expect(alert).toHaveTextContent('about 5 minutes');

    // The window expires, so the same request works afterwards and the button has to still be
    // there. And the reader is put on the message rather than left beside a button at the
    // bottom of a screen whose only change happened at the top.
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument();
    expect(alert.parentElement).toHaveFocus();
  });
});
