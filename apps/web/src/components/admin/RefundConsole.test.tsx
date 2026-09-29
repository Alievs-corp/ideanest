import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { issueRefund, listRefunds } from '../../lib/admin/refunds';
import type { Refund } from '../../lib/admin/refunds';
import { RefundConsole } from './RefundConsole';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { refundConsoleCopyFrom } from '../../lib/i18n/admin/money-copy';

/* Built from `messages/en.json` with the route's own builders; `src/test-copy.ts` says why. */
const COPY = refundConsoleCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

/**
 * §4.11's AD-06 refund console, for #176: a refund the provider did not answer comes back
 * REQUESTED, and the banner has to say it settles on its own rather than read as a fault
 * somebody should retry.
 */

vi.mock('../../lib/admin/refunds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/refunds')>();
  return { ...actual, listRefunds: vi.fn(), issueRefund: vi.fn() };
});

const listMock = vi.mocked(listRefunds);
const issueMock = vi.mocked(issueRefund);

const PLEDGE = '11111111-2222-3333-4444-555555555555';

function refund(overrides: Partial<Refund> = {}): Refund {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    pledgeId: PLEDGE,
    projectId: 'bbbbbbbb-0000-0000-0000-000000000001',
    amount: { amount: '25.00', currency: 'AZN' },
    fullRefund: true,
    reason: 'BACKER_REQUEST',
    detail: 'Asked by email',
    state: 'SUCCEEDED',
    requestedAt: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

async function issue(): Promise<void> {
  const user = userEvent.setup();
  render(<RefundConsole copy={COPY} />);
  await user.type(screen.getByPlaceholderText('00000000-0000-0000-0000-000000000000'), PLEDGE);
  await user.type(screen.getByRole('textbox', { name: new RegExp(COPY.noteLabel, 'i') }), 'Asked by email');
  await user.click(screen.getByRole('button', { name: COPY.issue }));
}

beforeEach(() => {
  listMock.mockReset();
  issueMock.mockReset();
  listMock.mockResolvedValue({ refunds: [], page: 0, hasMore: false });
});

describe('the refund console', () => {
  it('says an unanswered refund settles on its own and must not be issued again', async () => {
    issueMock.mockResolvedValue(refund({ state: 'REQUESTED' }));

    await issue();

    expect(await screen.findByText(new RegExp(COPY.awaitingProvider.slice(0, 40)))).toBeInTheDocument();
  });

  it('does not say so for a refund the provider confirmed', async () => {
    issueMock.mockResolvedValue(refund({ state: 'SUCCEEDED' }));

    await issue();

    expect(await screen.findByText(COPY.sentTitle)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(COPY.awaitingProvider.slice(0, 40)))).not.toBeInTheDocument();
  });
});
