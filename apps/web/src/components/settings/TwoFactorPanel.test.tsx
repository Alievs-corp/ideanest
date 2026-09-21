import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  confirmTwoFactorEnrolment,
  disableTwoFactor,
  startTwoFactorEnrolment,
} from '../../lib/auth/twoFactor';
import { TwoFactorPanel } from './TwoFactorPanel';
import { twoFactorPanelCopyFrom } from '../../lib/i18n/settings-copy';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #80.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = twoFactorPanelCopyFrom(translatorFor('settings.panels'), translatorFor('auth'));

/**
 * §4.1's A-07 — issue #278.
 *
 * WHAT THESE COVER:
 *
 *   - **enrolling is not enabling.** The screen says two-factor is not on until a code is
 *     entered, because `TwoFactorEnrolmentService` makes that the property that stops a phone
 *     dying mid-flow from becoming a lockout. A screen that congratulated somebody after
 *     `enable` would be lying about the state of their account.
 *   - **the recovery codes cannot be clicked past.** There is no re-issue endpoint, so the
 *     acknowledgement gates the only way off that step.
 *   - the "already enabled" refusal moves the panel to the off-path rather than being printed
 *     as an error. It is the answer to the question this screen cannot ask — `GET /v1/me`
 *     carries no `twoFactorEnabled`.
 *   - disabling costs the password and a proof, because otherwise the whole feature is worth
 *     exactly one password.
 *   - **the step's heading has focus before control comes back.** #322: the move used to be
 *     scheduled for the next frame, which is after the browser has already delivered the next
 *     keystroke, so a reader who typed straight away lost everything past the first character
 *     to the heading. The test below pins the timing rather than the symptom, because the
 *     symptom only appears on a machine slow enough to lose the race.
 */

vi.mock('../../lib/auth/twoFactor', () => ({
  startTwoFactorEnrolment: vi.fn(),
  confirmTwoFactorEnrolment: vi.fn(),
  disableTwoFactor: vi.fn(),
}));

const startMock = vi.mocked(startTwoFactorEnrolment);
const confirmMock = vi.mocked(confirmTwoFactorEnrolment);
const disableMock = vi.mocked(disableTwoFactor);

const ENROLMENT = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/IdeaNest:aysel?secret=JBSWY3DPEHPK3PXP',
  digits: 6,
  periodSeconds: 30,
  algorithm: 'SHA1',
};

beforeEach(() => {
  vi.clearAllMocks();
  startMock.mockResolvedValue(ENROLMENT);
  confirmMock.mockResolvedValue(['aaaa-1111', 'bbbb-2222']);
  disableMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

async function reachTheSecret(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Set it up' }));
  await user.type(screen.getByLabelText(/Current password/u), 'correct horse');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('enrolling', () => {
  it('does not claim two-factor is on before a code has been entered', async () => {
    const user = userEvent.setup();
    render(<TwoFactorPanel copy={COPY} />);

    await reachTheSecret(user);

    expect(screen.getByText(/not on yet/u)).toBeInTheDocument();
    expect(startMock).toHaveBeenCalledWith('correct horse');
  });

  it('offers the secret both ways, because not every device can open a link', async () => {
    const user = userEvent.setup();
    render(<TwoFactorPanel copy={COPY} />);

    await reachTheSecret(user);

    expect(screen.getByRole('link', { name: /Open in your authenticator/u })).toHaveAttribute(
      'href',
      ENROLMENT.otpauthUri,
    );
    expect(screen.getByText(ENROLMENT.secret)).toBeInTheDocument();
  });

  it('shows the recovery codes and refuses to move on until they are acknowledged', async () => {
    const user = userEvent.setup();
    render(<TwoFactorPanel copy={COPY} />);

    await reachTheSecret(user);
    await user.type(screen.getByLabelText(/Code from your authenticator/u), '123456');
    await user.click(screen.getByRole('button', { name: 'Switch it on' }));

    expect(await screen.findByText('aaaa-1111')).toBeInTheDocument();
    expect(screen.getByText('This is the only time these are shown')).toBeInTheDocument();

    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();

    await user.click(screen.getByLabelText(/I have saved these/u));
    expect(done).toBeEnabled();
  });

  it('moves to the off-path when the service says the account is already enrolled', async () => {
    startMock.mockRejectedValue(
      new ApiError(409, { detail: 'Two-factor authentication is already enabled.' }),
    );
    const user = userEvent.setup();
    render(<TwoFactorPanel copy={COPY} />);

    await reachTheSecret(user);

    expect(
      await screen.findByRole('heading', { name: 'Turn two-factor authentication off' }),
    ).toBeInTheDocument();
    // The service's own sentence, not a paraphrase, and not an error treatment.
    expect(screen.getByText('Two-factor authentication is already enabled.')).toBeInTheDocument();
  });

  it('prints any other refusal as an error and keeps the password step', async () => {
    startMock.mockRejectedValue(new ApiError(401, { detail: 'That password or code is not valid.' }));
    const user = userEvent.setup();
    render(<TwoFactorPanel copy={COPY} />);

    await reachTheSecret(user);

    expect(await screen.findByText('That password or code is not valid.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Current password/u)).toBeInTheDocument();
  });
});

describe('disabling', () => {
  it('sends the password and exactly one proof', async () => {
    const user = userEvent.setup();
    render(<TwoFactorPanel copy={COPY} />);

    await user.click(screen.getByRole('button', { name: 'Turn it off' }));
    await user.type(screen.getByLabelText(/Current password/u), 'correct horse');
    await user.type(screen.getByLabelText(/Code from your authenticator/u), '123456');
    await user.click(screen.getByRole('button', { name: 'Turn it off' }));

    expect(disableMock).toHaveBeenCalledWith('correct horse', { kind: 'code', code: '123456' });
  });

  it('will not submit with a password alone', async () => {
    const user = userEvent.setup();
    render(<TwoFactorPanel copy={COPY} />);

    await user.click(screen.getByRole('button', { name: 'Turn it off' }));
    await user.type(screen.getByLabelText(/Current password/u), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Turn it off' }));

    // Without a code the feature would be worth exactly one password.
    expect(disableMock).not.toHaveBeenCalled();
  });
});

describe('moving between steps', () => {
  /*
   * #322. `requestAnimationFrame` is stubbed to capture rather than to run, so that the
   * frame the old implementation scheduled its focus move on can be landed by hand — in the
   * middle of a word, which is what a loaded CI runner does by accident. Without that control
   * the race resolves the friendly way almost every time, which is why the defect read as a
   * flaky test for a fortnight instead of as the input-eating bug it is for anybody typing a
   * password rather than pasting one.
   */
  function heldFrames(): { land: () => void; restore: () => void } {
    const pending: FrameRequestCallback[] = [];
    const spy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pending.push(callback);
      return pending.length;
    });
    return {
      land: () => pending.splice(0).forEach((callback) => callback(0)),
      restore: () => spy.mockRestore(),
    };
  }

  it('has moved focus to the new heading before the next frame, not on it', async () => {
    const frames = heldFrames();
    try {
      const user = userEvent.setup();
      render(<TwoFactorPanel copy={COPY} />);

      await user.click(screen.getByRole('button', { name: 'Turn it off' }));

      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Turn two-factor authentication off' }),
      );
    } finally {
      frames.restore();
    }
  });

  it('does not take the field away from a reader who starts typing straight away', async () => {
    const frames = heldFrames();
    try {
      const user = userEvent.setup();
      render(<TwoFactorPanel copy={COPY} />);

      await user.click(screen.getByRole('button', { name: 'Turn it off' }));
      const password = screen.getByLabelText(/Current password/u);
      await user.type(password, 'correct');

      // The frame the transition would have asked for lands here, mid-word.
      frames.land();
      await user.keyboard(' horse');

      expect((password as HTMLInputElement).value).toBe('correct horse');
    } finally {
      frames.restore();
    }
  });
});
