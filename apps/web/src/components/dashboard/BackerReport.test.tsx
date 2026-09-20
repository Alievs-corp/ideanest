import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { Backer, BackerPage, BackerSegment } from '../../lib/dashboard/backers';
import { BackerReport } from './BackerReport';
import { backerReportCopyFrom } from '../../lib/i18n/dashboard-copy';
import { translatorFor } from '../../test-copy';

/**
 * §4.7's CD-10 and CD-11 as a screen.
 *
 * <p>What is worth pinning here is not that rows render. It is the four things that would
 * be wrong quietly: that the count is the campaign's rather than the page's, that a filter
 * and a saved segment are alternatives rather than a merge, that an anonymous backer is
 * still named to their own creator, and that a truncated export says so.
 */

function backer(overrides: Partial<Backer> & Pick<Backer, 'pledgeId'>): Backer {
  return {
    name: 'Aysel Mammadova',
    email: 'aysel@example.com',
    anonymous: false,
    amount: { amount: '50.00', currency: 'AZN' },
    state: 'CONFIRMED',
    backedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function page(overrides: Partial<BackerPage> = {}): BackerPage {
  return { backers: [], matched: 0, ...overrides };
}

function segment(overrides: Partial<BackerSegment> & Pick<BackerSegment, 'id' | 'name'>): BackerSegment {
  return {
    filter: { states: [], rewardTierIds: [], countries: ['DE'], term: '' },
    createdBy: 'creator',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

/*
 * The words, built from `messages/en.json` with the builder the route calls — #79.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = backerReportCopyFrom(translatorFor('dashboard'));

const NOBODY = vi.fn();

function renderReport(overrides: Partial<Parameters<typeof BackerReport>[0]> = {}) {
  return render(
    <BackerReport
      projectId="campaign-1"
      load={vi.fn().mockResolvedValue(page())}
      loadSegments={vi.fn().mockResolvedValue([])}
      save={NOBODY}
      remove={NOBODY}
      download={NOBODY}
      offerFile={NOBODY}
      copy={COPY}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the list', () => {
  it('shows every backer with what they paid, and counts the campaign rather than the page', async () => {
    const load = vi.fn().mockResolvedValue(
      page({
        backers: [backer({ pledgeId: 'p1' }), backer({ pledgeId: 'p2', name: 'Rashad Aliyev' })],
        // More than the two rows: a creator saving a segment for a bulk message needs the
        // number it reaches, and a count derived from the page would understate it.
        matched: 412,
        currency: 'AZN',
        nextCursor: 'p2',
      }),
    );
    renderReport({ load });

    expect(await screen.findByText(/412/)).toBeInTheDocument();
    expect(screen.getByText('Aysel Mammadova')).toBeInTheDocument();
    expect(screen.getByText('Rashad Aliyev')).toBeInTheDocument();
    // Both rows pledged the same amount, so this is a count rather than a lookup.
    expect(screen.getAllByText('50.00 AZN')).toHaveLength(2);
  });

  it('names an anonymous backer to their own creator, and says they are not named publicly', async () => {
    const load = vi
      .fn()
      .mockResolvedValue(page({ backers: [backer({ pledgeId: 'p1', anonymous: true })], matched: 1 }));
    renderReport({ load });

    // PL-12 is a promise about the public page. A parcel cannot be addressed to a number.
    expect(await screen.findByText('Aysel Mammadova')).toBeInTheDocument();
    expect(screen.getByText('Not named publicly')).toBeInTheDocument();
  });

  it('says nothing matched differently from nobody has backed', async () => {
    const load = vi.fn().mockResolvedValue(page());
    const { rerender } = renderReport({ load });

    expect(await screen.findByText(/Nobody has backed this campaign yet/)).toBeInTheDocument();

    rerender(
      <BackerReport
        projectId="campaign-1"
        load={load}
        loadSegments={vi.fn().mockResolvedValue([])}
        save={NOBODY}
        remove={NOBODY}
        download={NOBODY}
        offerFile={NOBODY}
        copy={COPY}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Collected' }));

    expect(await screen.findByText(/Nothing matches this filter/)).toBeInTheDocument();
  });

  it('explains a grant that does not include the report', async () => {
    const load = vi.fn().mockRejectedValue(new ApiError(403, null));
    renderReport({ load });

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not include the backer report/);
  });
});

describe('filtering', () => {
  it('asks the service for the chosen state, and marks the chip pressed', async () => {
    const load = vi.fn().mockResolvedValue(page());
    renderReport({ load });
    await screen.findByRole('button', { name: 'Collected' });

    await userEvent.click(screen.getByRole('button', { name: 'Collected' }));

    await waitFor(() => {
      expect(load).toHaveBeenLastCalledWith(
        'campaign-1',
        expect.objectContaining({ filter: expect.objectContaining({ states: ['COLLECTED'] }) }),
      );
    });
    // The selection is carried by aria-pressed and not by the fill, per ui-kit §9.2.
    expect(screen.getByRole('button', { name: 'Collected' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('searches on submit rather than on every keystroke', async () => {
    const load = vi.fn().mockResolvedValue(page());
    renderReport({ load });
    await screen.findByRole('button', { name: 'Search' });

    await userEvent.type(screen.getByLabelText(/Search backers/), 'aysel');
    // Still one call: the first render's. A read per keystroke would be a query per
    // keystroke against a campaign's whole pledge table.
    expect(load).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(load).toHaveBeenLastCalledWith(
        'campaign-1',
        expect.objectContaining({ filter: expect.objectContaining({ term: 'aysel' }) }),
      );
    });
  });
});

describe('segments', () => {
  it('saves the current filter and then applies it by identifier', async () => {
    const load = vi.fn().mockResolvedValue(page());
    const save = vi.fn().mockResolvedValue(segment({ id: 'seg-1', name: 'Germany' }));
    renderReport({ load, save });
    await screen.findByRole('button', { name: 'Collected' });

    await userEvent.click(screen.getByRole('button', { name: 'Collected' }));
    await userEvent.type(screen.getByLabelText(/Save this filter as/), 'Germany');
    await userEvent.click(screen.getByRole('button', { name: 'Save segment' }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        'campaign-1',
        'Germany',
        expect.objectContaining({ states: ['COLLECTED'] }),
      );
    });

    await userEvent.click(screen.getByRole('button', { name: 'Germany' }));

    // By identifier, never by a copy of the filter: a segment edited in another tab has to
    // change what this shows, which is the point of saving one.
    await waitFor(() => {
      expect(load).toHaveBeenLastCalledWith(
        'campaign-1',
        expect.objectContaining({ segmentId: 'seg-1' }),
      );
    });
  });

  it('reports a name the campaign already uses without losing the filter', async () => {
    const load = vi.fn().mockResolvedValue(page());
    const save = vi.fn().mockRejectedValue(new ApiError(409, null));
    renderReport({ load, save });
    await screen.findByRole('button', { name: 'Collected' });

    await userEvent.click(screen.getByRole('button', { name: 'Collected' }));
    await userEvent.type(screen.getByLabelText(/Save this filter as/), 'Germany');
    await userEvent.click(screen.getByRole('button', { name: 'Save segment' }));

    expect(await screen.findByText(/already has a segment by that name/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collected' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('only offers to save a filter that narrows something', async () => {
    renderReport();
    await screen.findByRole('button', { name: 'Collected' });

    // A segment called "everybody" is a chip that does nothing, and the control that makes
    // one is a control that invites it.
    expect(screen.queryByLabelText(/Save this filter as/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Collected' }));
    expect(await screen.findByLabelText(/Save this filter as/)).toBeInTheDocument();
  });
});

describe('the export', () => {
  it('offers the file and says how many backers it holds', async () => {
    const download = vi
      .fn()
      .mockResolvedValue({ filename: 'backers.csv', csv: 'pledge_id\n', rows: 3, truncated: false });
    const offerFile = vi.fn();
    renderReport({ download, offerFile });
    await screen.findByRole('button', { name: /Export CSV/ });

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(offerFile).toHaveBeenCalledWith('backers.csv', 'pledge_id\n'));
    expect(await screen.findByText('Exported 3 backers.')).toBeInTheDocument();
  });

  it('says when the file is short rather than letting it look complete', async () => {
    const download = vi
      .fn()
      .mockResolvedValue({ filename: 'backers.csv', csv: '', rows: 50000, truncated: true });
    renderReport({ download });
    await screen.findByRole('button', { name: /Export CSV/ });

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    // A truncated fulfilment list looks exactly like a complete one, and the person who
    // finds out otherwise is a backer who never received their reward.
    expect(await screen.findByText(/first 50000 backers/)).toBeInTheDocument();
  });

  it('reports the export budget as something to wait out', async () => {
    const download = vi.fn().mockRejectedValue(new ApiError(429, null));
    renderReport({ download });
    await screen.findByRole('button', { name: /Export CSV/ });

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    expect(await screen.findByText(/more exports than this account may take/)).toBeInTheDocument();
  });
});

describe('the table', () => {
  it('is a scroll region with a name, so the tab stop it adds is explained', async () => {
    const load = vi.fn().mockResolvedValue(page({ backers: [backer({ pledgeId: 'p1' })], matched: 1 }));
    renderReport({ load });

    // The name from the catalogue rather than retyped: a straight apostrophe here and a
    // typographic one in `messages/en.json` is a test that fails on a character nobody can see.
    const region = await screen.findByRole('region', { name: COPY.tableLabel });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table')).toBeInTheDocument();
  });
});
