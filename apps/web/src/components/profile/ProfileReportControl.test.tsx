import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { submitReport } from '../../lib/moderation/report';
import { reportControlCopyFrom } from '../../lib/i18n/report-copy';
import type { Session } from '../../lib/session/session';
import { translatorFor } from '../../test-copy';
import { useSession, type SessionState } from '../session/SessionProvider';
import { ProfileReportControl } from './ProfileReportControl';

const COPY = reportControlCopyFrom(
  translatorFor('moderation.report'),
  translatorFor('admin.moderation'),
  translatorFor('common'),
);

/**
 * "Report this account" on a public profile — issue #143.
 *
 * WHAT THESE COVER:
 *
 *   - **the owner is not offered it**, since reporting yourself is a 400 the service refuses.
 *   - a signed-out visitor meets `ReportControl`'s sign-in, not a form.
 *   - **a report is filed against the slug**, which is all the profile has: the account
 *     route is `POST /v1/users/{slug}/report` since #143.
 */

vi.mock('../session/SessionProvider', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/moderation/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/moderation/report')>()),
  submitReport: vi.fn(),
}));

const sessionMock = vi.mocked(useSession);
const submitMock = vi.mocked(submitReport);

function sessionAs(slug: string | null): SessionState {
  const session: Session | null =
    slug === null
      ? null
      : { id: `id-${slug}`, email: `${slug}@example.com`, name: slug, slug, emailVerified: true };
  return {
    status: slug === null ? 'signed-out' : 'signed-in',
    session,
    refresh: async () => {},
    signOut: async () => {},
  };
}

function renderControl() {
  return render(
    <ProfileReportControl slug="aysel" name="Aysel Q" returnTo="/u/aysel" copy={COPY} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  submitMock.mockResolvedValue({
    id: 'r1',
    target: { type: 'USER', id: 'u-aysel' },
    reason: 'SPAM',
    state: 'OPEN',
    createdAt: '2026-09-29T08:00:00Z',
  });
});

afterEach(cleanup);

describe('ProfileReportControl', () => {
  it('offers the owner nothing', () => {
    sessionMock.mockReturnValue(sessionAs('aysel'));
    const { container } = renderControl();

    expect(container).toBeEmptyDOMElement();
  });

  it('offers a signed-out visitor a sign-in rather than a form', async () => {
    sessionMock.mockReturnValue(sessionAs(null));
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: COPY.triggerOn.account }));

    expect(screen.getByText(COPY.signedOutBody)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('files a report against the account by its slug', async () => {
    sessionMock.mockReturnValue(sessionAs('reader'));
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: COPY.triggerOn.account }));
    await user.click(screen.getByRole('radio', { name: new RegExp(COPY.reasons.SPAM, 'u') }));
    await user.click(screen.getByRole('button', { name: COPY.submit }));

    expect(submitMock).toHaveBeenCalledWith({ kind: 'account', slug: 'aysel' }, 'SPAM', '');
    expect(await screen.findByText(COPY.filedBody.account)).toBeInTheDocument();
  });
});
