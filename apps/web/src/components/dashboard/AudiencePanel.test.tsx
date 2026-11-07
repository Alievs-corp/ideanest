import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { readProjectAudience, type AudiencePeriod, type ProjectAudience } from '../../lib/dashboard/audience';
import { audienceCopyFrom } from '../../lib/i18n/dashboard-copy';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { AudiencePanel } from './AudiencePanel';

/**
 * #634's audience section. The assertions are about the figures and the words, read from the
 * table and the bars rather than the geometry, as `FundingCharts.test.tsx` reads its trend.
 */

const COPY = audienceCopyFrom(translatorFor('dashboard'), translatorFor('common'));

/** Today, by the hour from Baku midnight (20:00 UTC the day before), every hour present. */
function hourly(values: Readonly<Record<number, [number, number]>> = {}): ProjectAudience['series'] {
  const midnight = Date.parse('2026-11-06T20:00:00Z');
  return Array.from({ length: 24 }, (_, hour) => {
    const [views, clicks] = values[hour] ?? [0, 0];
    return { start: new Date(midnight + hour * 3_600_000).toISOString(), views, clicks };
  });
}

function audience(overrides: Partial<ProjectAudience> = {}): ProjectAudience {
  return {
    period: 'day',
    bucket: 'HOUR',
    allTimeViews: 1_204,
    totals: { views: 0, clicks: 0 },
    series: hourly(),
    countries: [],
    surfaces: [],
    ...overrides,
  };
}

const BUSY = audience({
  totals: { views: 15, clicks: 4 },
  series: hourly({ 9: [10, 3], 14: [5, 1] }),
  countries: [
    { country: 'AZ', views: 12, clicks: 3 },
    { country: 'ZZ', views: 3, clicks: 1 },
  ],
  surfaces: [
    { surface: 'HOME', clicks: 3 },
    { surface: 'SEARCH', clicks: 1 },
  ],
});

let load: ReturnType<typeof vi.fn<(projectId: string, period: AudiencePeriod, signal?: AbortSignal) => Promise<ProjectAudience>>>;

beforeEach(() => {
  load = vi.fn().mockResolvedValue(BUSY);
});

afterEach(cleanup);

function renderPanel() {
  return render(<AudiencePanel projectId="campaign-1" copy={COPY} loadAudience={load} />);
}

describe('the audience section', () => {
  it('opens on today, with the totals and all-time views', async () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Daily' })).toHaveAttribute('aria-pressed', 'true');
    expect(load).toHaveBeenCalledWith('campaign-1', 'day', expect.any(AbortSignal));

    expect(await screen.findByText('1,204')).toBeInTheDocument();
    expect(screen.getByText('All-time views')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('draws every hour of the day, the quiet ones and the ones still to come at zero', async () => {
    renderPanel();
    await screen.findByText('1,204');

    await userEvent.click(screen.getByText('Show the figures'));
    const table = within(screen.getByRole('region', { name: 'Views and clicks by period' })).getByRole('table');
    // A header row and twenty-four hours.
    expect(within(table).getAllByRole('row')).toHaveLength(25);
    // Hours are named in Baku: the first bucket is midnight there, 20:00 the evening before in UTC.
    expect(within(table).getByRole('rowheader', { name: '00:00' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: '23:00' })).toBeInTheDocument();
    const nine = within(table).getByRole('rowheader', { name: '09:00' }).closest('tr');
    expect(nine).toHaveTextContent('09:00103');
    expect(screen.getByText('Most views: 09:00, 10')).toBeInTheDocument();
  });

  it('asks again for the period chosen, and names its buckets by the day', async () => {
    renderPanel();
    await screen.findByText('1,204');

    load.mockResolvedValueOnce(
      readProjectAudience(
        {
          period: 'week',
          bucket: 'DAY',
          allTimeViews: 1_204,
          totals: { views: 2, clicks: 0 },
          series: Array.from({ length: 7 }, (_, day) => ({
            start: new Date(Date.parse('2026-10-31T20:00:00Z') + day * 86_400_000).toISOString(),
            views: day === 6 ? 2 : 0,
            clicks: 0,
          })),
          countries: [{ country: 'TR', views: 2, clicks: 0 }],
        },
        'week',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Weekly' }));

    expect(load).toHaveBeenLastCalledWith('campaign-1', 'week', expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Daily' })).toHaveAttribute('aria-pressed', 'false');
    // Baku's 1 November starts at 20:00 UTC on 31 October.
    // The caption names the figure; the table behind it carries the same name for a screen reader.
    expect(await screen.findAllByText('Views and clicks by day, 1 Nov to 7 Nov')).not.toHaveLength(0);
    // A listing nobody clicked from says so rather than drawing an empty list.
    expect(screen.getByText(/Nobody followed this campaign’s card|Nobody followed this campaign's card/)).toBeInTheDocument();
  });

  it('names countries in the reader’s language, and the visitor nobody could place as Unknown', async () => {
    renderPanel();
    await screen.findByText('1,204');

    const countries = screen.getByRole('list', { name: 'Views and clicks by country' });
    const rows = within(countries).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Azerbaijan');
    expect(rows[0]).toHaveTextContent('12 views · 3 clicks');
    expect(rows[1]).toHaveTextContent('Unknown');
    expect(rows[1]).not.toHaveTextContent('ZZ');
  });

  it('lists the listings the clicks came from, in words', async () => {
    renderPanel();
    await screen.findByText('1,204');

    const surfaces = screen.getByRole('list', { name: 'Clicks by listing' });
    expect(within(surfaces).getByText('Home')).toBeInTheDocument();
    expect(within(surfaces).getByText('3 clicks')).toBeInTheDocument();
    expect(within(surfaces).getByText('1 click')).toBeInTheDocument();
  });

  it('says a quiet period is quiet, and still shows the all-time figure', async () => {
    load.mockResolvedValue(audience());
    renderPanel();

    expect(await screen.findByText('Nobody opened this campaign or clicked its card in this period.')).toBeInTheDocument();
    expect(screen.getByText('1,204')).toBeInTheDocument();
    expect(screen.queryByText('Show the figures')).toBeNull();
    // The footnote on what a summed figure means is there either way.
    expect(screen.getByText(/counted per day and summed/)).toBeInTheDocument();
  });

  it('shows a loading state while it reads', () => {
    load.mockReturnValue(new Promise(() => undefined));
    renderPanel();

    expect(screen.getByRole('status')).toHaveTextContent('Loading the audience figures');
  });

  it.each([
    [403, 'Your collaborator grant on this campaign does not include the audience figures.'],
    [500, /The audience figures could not be loaded/],
  ])('words a %s refusal for this read', async (status, message) => {
    load.mockRejectedValue(new ApiError(status, null, 'refused'));
    renderPanel();

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('passes axe with the figures on screen', async () => {
    const { container } = renderPanel();
    await screen.findByText('1,204');
    await userEvent.click(screen.getByText('Show the figures'));

    await waitFor(() => expectNoViolations(container));
  });
});

describe('reading the body', () => {
  it('treats what the service left out as nothing', () => {
    expect(readProjectAudience({}, 'year')).toEqual({
      period: 'year',
      bucket: 'MONTH',
      allTimeViews: 0,
      totals: { views: 0, clicks: 0 },
      series: [],
      countries: [],
      surfaces: [],
    });
  });
});
