import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { AdminUser } from '../../lib/admin/api';
import { listUsers } from '../../lib/admin/api';
import { readPartners, removePartner, savePartner, type Partner } from '../../lib/admin/partners';
import { PartnerManager } from './PartnerManager';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { partnerManagerCopyFrom } from '../../lib/i18n/admin/partner-copy';

/*
 * The copy is built from `messages/en.json` with the same builder the route calls, rather than
 * typed out here — `src/test-copy.ts` has the argument.
 */
const COPY = partnerManagerCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/partners', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/partners')>()),
  readPartners: vi.fn(),
  savePartner: vi.fn(),
  removePartner: vi.fn(),
}));

vi.mock('../../lib/admin/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/api')>()),
  listUsers: vi.fn(),
}));

const readMock = vi.mocked(readPartners);
const saveMock = vi.mocked(savePartner);
const removeMock = vi.mocked(removePartner);
const searchMock = vi.mocked(listUsers);

const FIRST: Partner = {
  accountId: '11111111-0000-4000-8000-000000000001',
  percentage: '50.00',
  sections: ['CURATION'],
  createdAt: '2026-09-01T09:00:00Z',
  createdBy: '99999999-0000-4000-8000-000000000001',
  updatedAt: '2026-09-02T09:00:00Z',
  updatedBy: '99999999-0000-4000-8000-000000000001',
};

const CANDIDATE: AdminUser = {
  id: '22222222-0000-4000-8000-000000000001',
  email: 'new.partner@example.com',
  name: 'New Partner',
  slug: 'new-partner',
  emailVerified: true,
  emailVerifiedAt: '2026-08-01T09:00:00Z',
  suspended: false,
  suspendedAt: null,
  suspendedBy: null,
  suspensionReason: null,
  deletionScheduledAt: null,
  createdAt: '2026-08-01T09:00:00Z',
};

function ready(partners: readonly Partner[] = [FIRST], allocated = '50.00', remaining = '50.00') {
  readMock.mockResolvedValue({ partners, allocated, remaining });
}

describe('the partner manager', () => {
  it('says how much of the whole is allocated and how much is left', async () => {
    ready();

    render(<PartnerManager copy={COPY} />);

    // The one constraint an operator runs into is the total, so it is on the page rather than
    // only in a refusal.
    expect(await screen.findByText('50.00% of 100% is allocated. 50.00% is left.')).toBeInTheDocument();
  });

  it('shows each partner with their percentage and what else is open to them', async () => {
    ready();

    render(<PartnerManager copy={COPY} />);

    expect(await screen.findByText('50.00%')).toBeInTheDocument();
    expect(screen.getByText(/Also opens: Curation/)).toBeInTheDocument();
  });

  it('offers exactly two sections, and says why there are only two', async () => {
    ready([]);

    render(<PartnerManager copy={COPY} />);
    await screen.findByText(COPY.rosterEmptyTitle);

    // Two checkboxes, not sixteen: every other module shows a transaction, a person or an
    // unscaled figure, and a reader who expects the rest would otherwise go looking for them.
    const group = screen.getByRole('group', { name: COPY.sectionsLegend });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(group).getByLabelText(/Curation/)).toBeInTheDocument();
    expect(within(group).getByLabelText(/System health/)).toBeInTheDocument();
    expect(screen.getByText(COPY.sectionsNote)).toBeInTheDocument();
  });

  it('will not add anybody until an account is chosen and a percentage is given', async () => {
    ready([]);

    render(<PartnerManager copy={COPY} />);
    await screen.findByText(COPY.rosterEmptyTitle);

    // Disabled with the reason beside it, rather than a button that offers an action the reader
    // cannot take.
    expect(screen.getByRole('button', { name: COPY.addPartner })).toBeDisabled();
    expect(screen.getByText(COPY.chooseAccountFirst)).toBeInTheDocument();
  });

  it('adds a partner with the chosen account, the percentage as typed and the sections ticked', async () => {
    ready([]);
    searchMock.mockResolvedValue({ users: [CANDIDATE], nextCursor: null });
    saveMock.mockResolvedValue({ ...FIRST, accountId: CANDIDATE.id, percentage: '30.00', sections: ['HEALTH'] });

    render(<PartnerManager copy={COPY} />);
    await screen.findByText(COPY.rosterEmptyTitle);

    await userEvent.type(screen.getByLabelText(COPY.picker.label), 'new');
    await userEvent.click(screen.getByRole('button', { name: COPY.picker.search }));
    await userEvent.click(await screen.findByRole('button', { name: /New Partner/ }));

    await userEvent.type(screen.getByLabelText(COPY.percentageLabel), '30');
    await userEvent.click(screen.getByLabelText(/System health/));
    await userEvent.click(screen.getByRole('button', { name: COPY.addPartner }));

    // The percentage goes out as the string that was typed. It multiplies money, so it is never
    // parsed into a binary number on the way.
    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({
        accountId: CANDIDATE.id,
        percentage: '30',
        sections: ['HEALTH'],
      }),
    );
    expect(await screen.findByText('New Partner now sees 30.00% of the figures.')).toBeInTheDocument();
  });

  it('saves a changed percentage and keeps the sections as they were', async () => {
    ready();
    saveMock.mockResolvedValue({ ...FIRST, percentage: '40.00' });

    render(<PartnerManager copy={COPY} />);
    await screen.findByText('50.00%');

    const save = screen.getByRole('button', { name: COPY.saveChanges });
    // Nothing has changed, so there is nothing to save.
    expect(save).toBeDisabled();

    const field = screen.getAllByLabelText(COPY.percentageLabel)[0] as HTMLElement;
    await userEvent.clear(field);
    await userEvent.type(field, '40');
    await userEvent.click(save);

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({
        accountId: FIRST.accountId,
        percentage: '40',
        sections: ['CURATION'],
      }),
    );
  });

  it('ends a partnership', async () => {
    ready();
    removeMock.mockResolvedValue();

    render(<PartnerManager copy={COPY} />);
    await userEvent.click(await screen.findByRole('button', { name: COPY.remove }));

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith(FIRST.accountId));
  });

  it("passes on the service's refusal in its own words when the shares would pass 100", async () => {
    ready([]);
    searchMock.mockResolvedValue({ users: [CANDIDATE], nextCursor: null });
    saveMock.mockRejectedValue(
      new ApiError(409, {
        code: 'PARTNER_SHARE_EXCEEDED',
        title: 'Shares add up to more than 100',
        detail: 'At most 20.00 is left to give this partner.',
      }),
    );

    render(<PartnerManager copy={COPY} />);
    await screen.findByText(COPY.rosterEmptyTitle);
    await userEvent.type(screen.getByLabelText(COPY.picker.label), 'new');
    await userEvent.click(screen.getByRole('button', { name: COPY.picker.search }));
    await userEvent.click(await screen.findByRole('button', { name: /New Partner/ }));
    await userEvent.type(screen.getByLabelText(COPY.percentageLabel), '80');
    await userEvent.click(screen.getByRole('button', { name: COPY.addPartner }));

    // The rule is the service's, and so is the number in it. This screen has no second copy of
    // the arithmetic to drift out of step.
    expect(await screen.findByText('At most 20.00 is left to give this partner.')).toBeInTheDocument();
  });

  it('refuses honestly when the reader is not a super admin', async () => {
    readMock.mockRejectedValue(new ApiError(403, { code: 'INSUFFICIENT_STAFF_CAPABILITY' }));

    render(<PartnerManager copy={COPY} />);

    expect(await screen.findByText(COPY.refusals.forbiddenTitle)).toBeInTheDocument();
  });
});
