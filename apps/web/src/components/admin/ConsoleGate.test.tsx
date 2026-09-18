import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/problem';
import { readMembership } from '../../lib/admin/staff';
import type { StaffMembership } from '../../lib/admin/staff';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { translatorFor } from '../../test-copy';
import { ConsoleGate } from './ConsoleGate';
import { ConsoleMembershipProvider } from './ConsoleMembership';

/*
 * The copy comes out of `messages/en.json` through the builder the route calls, for the reason
 * `src/test-copy.ts` gives: a suite that retyped the sentences would still be green with the
 * catalogue empty.
 */
const REFUSALS = consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')).refusals;

vi.mock('../../lib/admin/staff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/staff')>();
  return { ...actual, readMembership: vi.fn() };
});

const readMembershipMock = vi.mocked(readMembership);

const SCREEN = 'the payout queue';

function renderConsole(): void {
  render(
    <ConsoleMembershipProvider>
      <ConsoleGate copy={REFUSALS}>
        <p>{SCREEN}</p>
      </ConsoleGate>
    </ConsoleMembershipProvider>,
  );
}

function membership(staff: boolean): StaffMembership {
  return {
    accountId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
    staff,
    bootstrapped: false,
    roles: staff ? ['MODERATOR'] : [],
    capabilities: staff ? ['MODERATE_CONTENT'] : [],
  };
}

/**
 * The console's front door — §4.11's role model, issue #295.
 *
 * <p>What it replaces is nothing, which was the defect: a signed-in visitor who opened
 * `/admin` got the chrome, twenty-eight destinations, and a refusal on each one they tried.
 * The component's own docblock argues why this is a courtesy rather than a lock, and the last
 * test here is the half of that which is worth asserting — a client-side gate must not fail
 * closed on a read that merely failed.
 */
describe('the console gate', () => {
  it('opens the console for a member of staff', async () => {
    readMembershipMock.mockResolvedValue(membership(true));
    renderConsole();

    expect(await screen.findByText(SCREEN)).toBeInTheDocument();
  });

  it('says it once to somebody who does not work here, instead of on every screen', async () => {
    readMembershipMock.mockResolvedValue(membership(false));
    renderConsole();

    expect(await screen.findByText(REFUSALS.forbiddenBody)).toBeInTheDocument();
    expect(screen.queryByText(SCREEN)).not.toBeInTheDocument();
  });

  it('tells an expired session that it expired, and not that it does not work here', async () => {
    // The two refusals lead somewhere different: one is fixed by signing in again and the
    // other cannot be fixed by the person reading it.
    readMembershipMock.mockRejectedValue(new ApiError(401, { code: 'UNAUTHENTICATED' }, 'no'));
    renderConsole();

    expect(await screen.findByText(REFUSALS.signedOutTitle)).toBeInTheDocument();
    expect(screen.queryByText(SCREEN)).not.toBeInTheDocument();
  });

  it('names the console itself in the sentence, not a screen', async () => {
    readMembershipMock.mockRejectedValue(new ApiError(401, { code: 'UNAUTHENTICATED' }, 'no'));
    renderConsole();

    // `refusals.consoleSubject`, inflected in the catalogue like every other screen's noun,
    // rather than a sentence this component assembles.
    expect(
      await screen.findByText(new RegExp(REFUSALS.consoleSubject, 'u')),
    ).toBeInTheDocument();
  });

  it('draws nothing while the read is in flight', () => {
    readMembershipMock.mockReturnValue(new Promise(() => {}));
    renderConsole();

    // No skeleton and no "checking…": a console that painted a screen, then a refusal, then
    // the screen again would be movement in the one place §5 of the motion system gives none.
    expect(screen.queryByText(SCREEN)).not.toBeInTheDocument();
    expect(screen.queryByText(REFUSALS.forbiddenBody)).not.toBeInTheDocument();
  });

  it('does not become a wall when its own read fails', async () => {
    /*
     * The direction a client-side gate must not fail in. A network blip on the shell's read is
     * not evidence that somebody does not work here, and the screens behind it each make their
     * own request against a service that refuses every read regardless of what this found out.
     */
    readMembershipMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderConsole();

    await waitFor(() => expect(screen.getByText(SCREEN)).toBeInTheDocument());
    expect(screen.queryByText(REFUSALS.forbiddenBody)).not.toBeInTheDocument();
  });
});
