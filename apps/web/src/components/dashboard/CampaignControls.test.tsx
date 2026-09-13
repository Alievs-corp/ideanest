import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { campaignControlsCopyFrom } from '../../lib/i18n/campaign-controls-copy';
import type { ProjectEdit, ProjectState } from '../../lib/projects/api';
import { translatorFor } from '../../test-copy';
import { CampaignControls, extensionWindow } from './CampaignControls';

const COPY = campaignControlsCopyFrom(translatorFor('dashboardControls'));
const DEADLINE = '2026-09-19T12:00:00.000Z';

function renderControls(
  overrides: {
    state?: ProjectState;
    percentFunded?: number;
    extend?: (id: string, until: string) => Promise<ProjectEdit>;
    withdraw?: (id: string) => Promise<ProjectEdit>;
  } = {},
) {
  const onChanged = vi.fn();
  const extend = vi.fn(overrides.extend ?? (() => Promise.resolve({} as ProjectEdit)));
  const withdraw = vi.fn(overrides.withdraw ?? (() => Promise.resolve({} as ProjectEdit)));
  render(
    <CampaignControls
      projectId="project-1"
      state={overrides.state ?? 'LIVE'}
      percentFunded={overrides.percentFunded ?? 85}
      deadline={DEADLINE}
      copy={COPY}
      locale="en"
      onChanged={onChanged}
      extend={extend}
      withdraw={withdraw}
    />,
  );
  return { onChanged, extend, withdraw, user: userEvent.setup() };
}

afterEach(cleanup);

describe('withdrawing', () => {
  it('is offered at 80%, asks first, and says what it closes', async () => {
    const { user, withdraw, onChanged } = renderControls();

    await user.click(screen.getByRole('button', { name: 'Withdraw the funds' }));
    expect(withdraw).not.toHaveBeenCalled();
    expect(screen.getByText(/stops taking pledges at once and cannot reopen/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Withdraw and close' }));

    await waitFor(() => expect(withdraw).toHaveBeenCalledWith('project-1'));
    expect(await screen.findByText(/payout is requested/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('is not offered below 80%, and says when it will be', () => {
    renderControls({ percentFunded: 79 });

    expect(screen.queryByRole('button', { name: 'Withdraw the funds' })).not.toBeInTheDocument();
    expect(screen.getByText(COPY.belowThreshold)).toBeInTheDocument();
  });

  it('draws nothing for a campaign with nothing left to decide', () => {
    const { user } = renderControls({ state: 'WITHDRAWN' });
    void user;

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.heading)).not.toBeInTheDocument();
  });
});

describe('extending', () => {
  it('sends the chosen day at the deadline’s own time, after asking', async () => {
    const { user, extend, onChanged } = renderControls({ percentFunded: 60 });

    await user.type(screen.getByLabelText('New deadline'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Extend the deadline' }));
    expect(extend).not.toHaveBeenCalled();
    expect(screen.getByText(/You can extend only once/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Extend to this date' }));

    await waitFor(() => expect(extend).toHaveBeenCalledWith('project-1', '2026-10-01T12:00:00.000Z'));
    expect(await screen.findByText(/The deadline is now October 1, 2026/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses a day more than sixty days after the first deadline without asking the service', async () => {
    const { user, extend } = renderControls({ percentFunded: 60 });

    await user.type(screen.getByLabelText('New deadline'), '2026-11-19');
    await user.click(screen.getByRole('button', { name: 'Extend the deadline' }));

    expect(await screen.findByText(/no later than November 18, 2026/)).toBeInTheDocument();
    expect(extend).not.toHaveBeenCalled();
  });

  it('words the service’s reason when it refuses', async () => {
    const { user } = renderControls({
      percentFunded: 60,
      extend: () =>
        Promise.reject(
          new ApiError(409, { status: 409, code: 'EXTENSION_NOT_AVAILABLE', meta: { reason: 'OUTSIDE_WINDOW' } } as never),
        ),
    });

    await user.type(screen.getByLabelText('New deadline'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Extend the deadline' }));
    await user.click(screen.getByRole('button', { name: 'Extend to this date' }));

    expect(await screen.findByText(COPY.extendOutsideWindow)).toBeInTheDocument();
  });

  it('is not offered to an extended campaign, or below 50%', () => {
    renderControls({ state: 'EXTENDED', percentFunded: 90 });
    expect(screen.queryByRole('button', { name: 'Extend the deadline' })).not.toBeInTheDocument();
    cleanup();

    renderControls({ percentFunded: 49 });
    expect(screen.queryByRole('button', { name: 'Extend the deadline' })).not.toBeInTheDocument();
  });
});

describe('extensionWindow', () => {
  it('runs from the day after the deadline to sixty days after it, at the deadline’s time', () => {
    expect(extensionWindow(DEADLINE)).toEqual({
      deadlineDay: '2026-09-19',
      firstDay: '2026-09-20',
      latestDay: '2026-11-18',
      timeOfDay: 'T12:00:00.000Z',
    });
    expect(extensionWindow(null)).toBeNull();
  });
});
