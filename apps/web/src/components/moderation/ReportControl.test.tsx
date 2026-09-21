import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { submitReport } from '../../lib/moderation/report';
import { fetchSession, type Session } from '../../lib/session/session';
import { SessionProvider } from '../session/SessionProvider';
import { ReportControl } from './ReportControl';
import { reportControlCopyFrom } from '../../lib/i18n/report-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the page calls — #85.
 *
 * The nine reason names come from `admin.moderation.reason`, which is the whole point of that
 * issue: one table, read by the console and by this dialog, rather than the constant
 * `lib/moderation/describe.ts` used to export and `wording.test.ts` used to hold level.
 */
const COPY = reportControlCopyFrom(
  translatorFor('moderation.report'),
  translatorFor('admin.moderation'),
  translatorFor('common'),
);

/**
 * §4.9's C-06 and C-07 — issue #286.
 *
 * WHAT THESE COVER:
 *
 *   - **a visitor with no session is offered a sign-in, not a form.** All three endpoints
 *     require a bearer token, and a dialog that collected a complaint and then lost it at the
 *     last step is worse than one that says so first.
 *   - the dialog is a dialog: `role`, `aria-modal`, and an accessible name that says what is
 *     being reported.
 *   - `OTHER` will not submit without a sentence, because it is the one reason a moderator
 *     cannot act on without one.
 *   - **the acknowledgement does not claim anything happened to the target.** A report is a
 *     request for a person to look, not a vote, and saying otherwise would invite five
 *     accounts to try removing a campaign between them.
 *   - **the reasons are the catalogue's, and so is everything around them** (#85). Asserted
 *     against the copy the page resolves rather than against typed sentences, so the dialog
 *     cannot quietly go back to drawing a literal.
 */

vi.mock('../../lib/moderation/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/moderation/report')>()),
  submitReport: vi.fn(),
}));
vi.mock('../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../lib/api/access-token', () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/projects/aysel/a-game',
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

const submitMock = vi.mocked(submitReport);
const sessionMock = vi.mocked(fetchSession);

const ACCOUNT: Session = {
  id: 'u1',
  email: 'aysel@example.com',
  name: 'Aysel',
  slug: 'aysel',
  emailVerified: true,
};

function renderControl() {
  return render(
    <SessionProvider>
      <ReportControl
        target={{ kind: 'campaign', id: 'p1' }}
        name="A tabletop game"
        returnTo="/projects/aysel/a-game"
        copy={COPY}
      />
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(ACCOUNT);
  submitMock.mockResolvedValue({
    id: 'report-1',
    target: { type: 'PROJECT', id: 'p1' },
    reason: 'SPAM',
    state: 'OPEN',
    createdAt: '2026-08-23T09:00:00Z',
  });
});

afterEach(cleanup);

describe('the trigger', () => {
  it('names what it reports rather than saying only “Report”', async () => {
    renderControl();
    expect(
      await screen.findByRole('button', { name: COPY.triggerOn.campaign }),
    ).toBeInTheDocument();
  });
});

describe('the dialog', () => {
  it('is a modal dialog with a name that says what is being reported', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(await screen.findByRole('button', { name: COPY.triggerOn.campaign }));

    const dialog = screen.getByRole('dialog', {
      name: fillPlaceholders(COPY.dialogLabel, { name: 'A tabletop game' }),
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('sends the chosen reason', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(await screen.findByRole('button', { name: COPY.triggerOn.campaign }));
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${COPY.reasons.FRAUD}`, 'u') }));
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(submitMock).toHaveBeenCalledWith({ kind: 'campaign', id: 'p1' }, 'FRAUD', '');
  });

  it('will not send “Other” without a sentence a moderator can act on', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(await screen.findByRole('button', { name: COPY.triggerOn.campaign }));
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${COPY.reasons.OTHER}`, 'u') }));
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(screen.getByText(COPY.detailRequired)).toBeInTheDocument();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('acknowledges without claiming anything happened to the campaign', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(await screen.findByRole('button', { name: COPY.triggerOn.campaign }));
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${COPY.reasons.SPAM}`, 'u') }));
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(await screen.findByText(COPY.filedTitle)).toBeInTheDocument();
    /*
     * The acknowledgement the campaign mount draws, word for word. A report is a request for
     * a person to look, and this is the sentence that says the campaign itself is unchanged.
     */
    expect(screen.getByText(COPY.filedBody.campaign)).toBeInTheDocument();
  });

  it('prints the service’s refusal, including the rate limit', async () => {
    submitMock.mockRejectedValue(
      new ApiError(429, { detail: 'You have reported a few things recently.' }),
    );
    const user = userEvent.setup();
    renderControl();

    await user.click(await screen.findByRole('button', { name: COPY.triggerOn.campaign }));
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${COPY.reasons.SPAM}`, 'u') }));
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(await screen.findByText('You have reported a few things recently.')).toBeInTheDocument();
  });
});

describe('a visitor with no session', () => {
  beforeEach(() => sessionMock.mockResolvedValue(null));

  it('is offered a sign-in that returns them here, and no form', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(await screen.findByRole('button', { name: COPY.triggerOn.campaign }));

    expect(screen.getByRole('link', { name: COPY.signIn })).toHaveAttribute(
      'href',
      '/en/sign-in?next=%2Fprojects%2Faysel%2Fa-game',
    );
    expect(screen.queryByRole('button', { name: COPY.submit })).not.toBeInTheDocument();
  });
});
