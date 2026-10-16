import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { lookUpNames } from '../../lib/admin/directory';
import {
  readCategoryChoices,
  readFeeHistory,
  replaceFeeSchedule,
  type FeeHistory,
  type FeeSchedule,
} from '../../lib/admin/fees';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { feeEditorCopyFrom } from '../../lib/i18n/admin/money-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { translatorFor } from '../../test-copy';
import { FeeEditor } from './FeeEditor';

/*
 * The fee editor — the money pages audit: it starts from the terms in force, asks before it replaces
 * them, words every refusal, and names the categories and campaigns an exception is for.
 */
const ADMIN = translatorFor('admin');
const COPY = feeEditorCopyFrom(ADMIN, consoleChromeCopyFrom(ADMIN, translatorFor('common')));

vi.mock('../../lib/admin/fees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/fees')>()),
  readFeeHistory: vi.fn(),
  replaceFeeSchedule: vi.fn(),
  readCategoryChoices: vi.fn(),
}));
vi.mock('../../lib/admin/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/directory')>()),
  lookUpNames: vi.fn(),
}));

const historyMock = vi.mocked(readFeeHistory);
const replaceMock = vi.mocked(replaceFeeSchedule);
const categoriesMock = vi.mocked(readCategoryChoices);
const namesMock = vi.mocked(lookUpNames);

const CATEGORY = 'ca700000-0000-4000-8000-000000000005';
const CAMPAIGN = 'b2a00000-0000-4000-8000-000000000002';
const ADMIN_ID = '7d3c2a10-5b1e-4f0a-9c2d-0a1b2c3d4e01';

function schedule(overrides: Partial<FeeSchedule>): FeeSchedule {
  return {
    id: 'f3a00000-0000-4000-8000-000000000002',
    scope: 'PLATFORM',
    platformRate: '0.05000',
    processingRate: '0.02500',
    processingFixed: '0.3000',
    currency: 'AZN',
    effectiveFrom: '2026-07-01T06:00:00Z',
    open: true,
    note: 'Second quarter terms',
    createdAt: '2026-07-01T06:00:00Z',
    createdBy: ADMIN_ID,
    ...overrides,
  };
}

const DEFAULTS = { platformRate: '0.15', processingRate: '0', currency: 'AZN' };

function historyOf(...schedules: FeeSchedule[]): FeeHistory {
  return { schedules, defaults: DEFAULTS };
}

beforeEach(() => {
  vi.resetAllMocks();
  categoriesMock.mockResolvedValue([{ id: CATEGORY, name: 'Social projects' }]);
  namesMock.mockResolvedValue({ accounts: [], projects: [{ id: CAMPAIGN, title: 'Bakı küçə kitabxanası' }] });
});

const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`));

describe('starting from the terms in force', () => {
  it('fills the form from the open platform schedule rather than from numbers of its own', async () => {
    historyMock.mockResolvedValue(historyOf(schedule({})));
    render(<FeeEditor copy={COPY} />);

    await waitFor(() => expect(field(COPY.platformRateLabel)).toHaveValue('0.05'));
    expect(field(COPY.processingRateLabel)).toHaveValue('0.025');
    expect(field(COPY.fixedLabel)).toHaveValue('0.3');
    expect(screen.getByText(COPY.prefilledFromSchedule)).toBeInTheDocument();
  });

  it('starts from the default terms the service reports when nothing is open, and says what they are', async () => {
    historyMock.mockResolvedValue(historyOf());
    render(<FeeEditor copy={COPY} />);

    expect(
      await screen.findByText(fillPlaceholders(COPY.emptyBody, { platform: '15%', processing: '0%' })),
    ).toBeInTheDocument();
    await waitFor(() => expect(field(COPY.platformRateLabel)).toHaveValue('0.15'));
    expect(field(COPY.processingRateLabel)).toHaveValue('0');
    expect(screen.getByText(COPY.prefilledFromDefault)).toBeInTheDocument();
  });
});

describe('replacing the terms', () => {
  it('changes only the field typed in, asks with every term old and new, and opens them on the second press', async () => {
    const user = userEvent.setup();
    historyMock.mockResolvedValue(historyOf(schedule({})));
    replaceMock.mockResolvedValue(schedule({ id: 'f3a00000-0000-4000-8000-0000000000aa', platformRate: '0.06' }));
    render(<FeeEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.platformRateLabel)).toHaveValue('0.05'));

    await user.clear(field(COPY.platformRateLabel));
    await user.type(field(COPY.platformRateLabel), '0,06');
    expect(field(COPY.processingRateLabel)).toHaveValue('0.025');
    await user.type(field(COPY.whyLabel), 'New quarter');
    await user.click(screen.getByRole('button', { name: COPY.open }));

    expect(replaceMock).not.toHaveBeenCalled();
    const asked = screen.getByRole('group', { name: COPY.confirm.heading });
    expect(within(asked).getByText('5%')).toBeInTheDocument();
    expect(within(asked).getByText('6%')).toBeInTheDocument();
    expect(within(asked).getAllByText(`(${COPY.confirm.unchanged})`)).toHaveLength(2);

    await user.click(within(asked).getByRole('button', { name: COPY.confirm.action }));

    expect(replaceMock).toHaveBeenCalledWith({
      scope: 'PLATFORM',
      scopeRef: null,
      platformRate: '0.06',
      processingRate: '0.025',
      processingFixed: '0.3',
      currency: 'AZN',
      note: 'New quarter',
    });
    expect(await screen.findByText(COPY.doneTitle)).toBeInTheDocument();
  });

  it('refuses a rate that is not a fraction before anything is sent', async () => {
    const user = userEvent.setup();
    historyMock.mockResolvedValue(historyOf(schedule({})));
    render(<FeeEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.platformRateLabel)).toHaveValue('0.05'));

    await user.clear(field(COPY.platformRateLabel));
    await user.type(field(COPY.platformRateLabel), '15');
    await user.type(field(COPY.whyLabel), 'Typo');

    expect(screen.getByText(COPY.rateInvalid)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.open })).toBeDisabled();
  });

  it('checks a campaign identifier, names the campaign it found, and words an unknown one', async () => {
    const user = userEvent.setup();
    historyMock.mockResolvedValue(historyOf(schedule({})));
    replaceMock.mockRejectedValue(
      new ApiError(400, { status: 400, code: 'FEE_SCOPE_UNKNOWN', meta: { scope: 'PROJECT' } }),
    );
    render(<FeeEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.platformRateLabel)).toHaveValue('0.05'));

    await user.selectOptions(screen.getByLabelText(new RegExp(`^${COPY.scopeLabel}`)), 'PROJECT');
    await user.type(field(COPY.campaignLabel), 'not-an-id');
    await user.type(field(COPY.whyLabel), 'Partner campaign');
    expect(screen.getByRole('button', { name: COPY.open })).toBeDisabled();

    await user.clear(field(COPY.campaignLabel));
    await user.type(field(COPY.campaignLabel), CAMPAIGN);
    expect(
      await screen.findByText(fillPlaceholders(COPY.campaignFound, { name: 'Bakı küçə kitabxanası' })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.open }));
    await user.click(screen.getByRole('button', { name: COPY.confirm.action }));

    expect(await screen.findByText(COPY.errors['FEE_SCOPE_UNKNOWN_PROJECT'] ?? '')).toBeInTheDocument();
  });

  it('words a request the service rejected before any code ran, never in its English', async () => {
    const user = userEvent.setup();
    historyMock.mockResolvedValue(historyOf(schedule({})));
    replaceMock.mockRejectedValue(new ApiError(400, { status: 400, detail: 'Invalid request content.' }));
    render(<FeeEditor copy={COPY} />);
    await waitFor(() => expect(field(COPY.platformRateLabel)).toHaveValue('0.05'));

    await user.type(field(COPY.whyLabel), 'Same terms');
    await user.click(screen.getByRole('button', { name: COPY.open }));
    await user.click(screen.getByRole('button', { name: COPY.confirm.action }));

    expect(await screen.findByText(COPY.errors['INVALID_REQUEST'] ?? '')).toBeInTheDocument();
    expect(screen.queryByText('Invalid request content.')).not.toBeInTheDocument();
  });
});

describe('the terms in force', () => {
  it('lists the platform first, then category and campaign exceptions by name, with the fixed amount in full', async () => {
    historyMock.mockResolvedValue(
      historyOf(
        schedule({ id: 'p', scope: 'PROJECT', scopeRef: CAMPAIGN, platformRate: '0.03000', processingFixed: '0.0025' }),
        schedule({ id: 'c', scope: 'CATEGORY', scopeRef: CATEGORY, platformRate: '0.08000' }),
        schedule({ id: 'x' }),
      ),
    );
    render(<FeeEditor copy={COPY} />);

    const list = (await screen.findByRole('heading', { name: COPY.inForceHeading })).parentElement;
    if (list === null) throw new Error('no in-force section');
    await within(list).findByText(fillPlaceholders(COPY.scopeNamed, { scope: COPY.scope.PROJECT, name: 'Bakı küçə kitabxanası' }));
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(COPY.scope.PLATFORM);
    expect(rows[1]).toHaveTextContent(fillPlaceholders(COPY.scopeNamed, { scope: COPY.scope.CATEGORY, name: 'Social projects' }));
    expect(rows[2]).toHaveTextContent('0.0025 AZN');
    // The heading says "in force" once; no row repeats it in a tag.
    expect(within(list).queryAllByRole('listitem').filter((row) => row.textContent?.includes(COPY.inForceTag))).toHaveLength(0);
  });
});
