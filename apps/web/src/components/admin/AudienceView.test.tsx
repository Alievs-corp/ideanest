import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import {
  readCampaignAudience,
  readPlatformAudience,
  type CampaignAudience,
  type PlatformAudience,
} from '../../lib/admin/audience';
import { AudienceView } from './AudienceView';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { audienceCopyFrom } from '../../lib/i18n/admin/platform-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { Locale } from '../../lib/i18n/locale';

function copyFor(locale: Locale) {
  return audienceCopyFrom(
    translatorFor('admin', locale),
    translatorFor('common', locale),
    consoleChromeCopyFrom(translatorFor('admin', locale), translatorFor('common', locale)),
  );
}

const COPY = copyFor('en');

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ locale: 'en' }),
}));

vi.mock('../../lib/admin/audience', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/admin/audience')>()),
  readPlatformAudience: vi.fn(),
  readCampaignAudience: vi.fn(),
}));

const readMock = vi.mocked(readPlatformAudience);
const campaignMock = vi.mocked(readCampaignAudience);

const CAMPAIGN_ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

/** Today in Baku, 7 November 2026: 24 hours from 20:00 UTC on the 6th, all at nought but two. */
function hours(): PlatformAudience['series'] {
  return Array.from({ length: 24 }, (_, hour) => {
    const start = new Date(Date.UTC(2026, 10, 6, 20 + hour)).toISOString();
    const busy = hour === 10 || hour === 11;
    return {
      start,
      visitors: busy ? 40 : 0,
      pageViews: busy ? 120 : 0,
      campaignViews: busy ? 30 : 0,
      campaignClicks: busy ? 9 : 0,
    };
  });
}

function audience(overrides: Partial<PlatformAudience> = {}): PlatformAudience {
  return {
    period: 'day',
    from: '2026-11-06T20:00:00Z',
    to: '2026-11-07T20:00:00Z',
    timeZone: 'Asia/Baku',
    bucket: 'HOUR',
    computedAt: '2026-11-07T10:00:00Z',
    totals: { visitors: 1280, pageViews: 3400, campaignViews: 640, campaignClicks: 96 },
    series: hours(),
    countries: [
      { country: 'AZ', visitors: 1000 },
      { country: 'TR', visitors: 200 },
      { country: 'ZZ', visitors: 80 },
    ],
    platforms: [
      { platform: 'WEB', visitors: 900 },
      { platform: 'ANDROID', visitors: 380 },
    ],
    topCampaigns: [
      {
        projectId: CAMPAIGN_ID,
        title: 'Clay studio',
        slug: 'clay-studio',
        creatorSlug: 'aysel',
        views: 400,
        clicks: 100,
      },
      { projectId: 'b1', title: 'Unlisted', views: 0, clicks: 2 },
    ],
    ...overrides,
  };
}

/** Every bucket at nought, as the service sends a period nobody visited in. */
function silent(): PlatformAudience {
  return audience({
    totals: { visitors: 0, pageViews: 0, campaignViews: 0, campaignClicks: 0 },
    series: hours().map((point) => ({ ...point, visitors: 0, pageViews: 0, campaignViews: 0, campaignClicks: 0 })),
    countries: [],
    platforms: [],
    topCampaigns: [],
  });
}

function campaign(overrides: Partial<CampaignAudience> = {}): CampaignAudience {
  return {
    period: 'day',
    from: '2026-11-06T20:00:00Z',
    to: '2026-11-07T20:00:00Z',
    timeZone: 'Asia/Baku',
    bucket: 'HOUR',
    computedAt: '2026-11-07T10:00:00Z',
    allTimeViews: 5321,
    totals: { views: 400, clicks: 100 },
    series: hours().map((point) => ({ start: point.start, views: point.campaignViews, clicks: point.campaignClicks })),
    countries: [{ country: 'AZ', views: 380, clicks: 90 }],
    surfaces: [
      { surface: 'DISCOVER', clicks: 70 },
      { surface: 'SEARCH', clicks: 30 },
    ],
    platforms: [{ platform: 'IOS', views: 400 }],
    ...overrides,
  };
}

beforeEach(() => {
  readMock.mockReset();
  campaignMock.mockReset();
});

describe('the audience screen', () => {
  it('opens on today and asks for the period a reader picks', async () => {
    readMock.mockResolvedValue(audience());
    const user = userEvent.setup();

    render(<AudienceView copy={COPY} />);

    await waitFor(() => expect(readMock).toHaveBeenCalled());
    expect(readMock.mock.calls[0]?.[0]).toBe('day');
    expect(screen.getByRole('button', { name: COPY.periods.day })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: COPY.periods.week }));
    await waitFor(() => expect(readMock.mock.calls.at(-1)?.[0]).toBe('week'));
    expect(screen.getByRole('button', { name: COPY.periods.week })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: COPY.periods.year }));
    await waitFor(() => expect(readMock.mock.calls.at(-1)?.[0]).toBe('year'));
  });

  it('draws the four totals and the day it covers', async () => {
    readMock.mockResolvedValue(audience());

    render(<AudienceView copy={COPY} />);

    expect(await screen.findByRole('heading', { name: '7 Nov 2026' })).toBeInTheDocument();
    const totals = screen.getByRole('heading', { name: '7 Nov 2026' }).closest('section') as HTMLElement;
    expect(within(totals).getByText(COPY.visitors)).toBeInTheDocument();
    expect(within(totals).getByText('1,280')).toBeInTheDocument();
    expect(within(totals).getByText('3,400')).toBeInTheDocument();
    expect(within(totals).getByText('640')).toBeInTheDocument();
    expect(within(totals).getByText('96')).toBeInTheDocument();
    // One day is distinct people, so the note about summed days is not drawn.
    expect(screen.queryByText(COPY.dailySumNote)).not.toBeInTheDocument();
  });

  it('says that a longer period’s visitors are daily counts added up', async () => {
    readMock.mockResolvedValue(audience());
    const user = userEvent.setup();

    render(<AudienceView copy={COPY} />);
    await screen.findByRole('heading', { name: '7 Nov 2026' });

    readMock.mockResolvedValue(
      audience({ period: 'week', bucket: 'DAY', from: '2026-10-31T20:00:00Z', to: '2026-11-07T20:00:00Z' }),
    );
    await user.click(screen.getByRole('button', { name: COPY.periods.week }));

    expect(await screen.findByText(COPY.dailySumNote)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: fillPlaceholders(COPY.range, { from: '1 Nov 2026', to: '7 Nov 2026' }) }),
    ).toBeInTheDocument();
  });

  it('draws every bucket of a silent period, at nought, and says nothing was recorded', async () => {
    readMock.mockResolvedValue(silent());

    const { container } = render(<AudienceView copy={COPY} />);

    const totals = (await screen.findByRole('heading', { name: '7 Nov 2026' })).closest('section') as HTMLElement;
    expect(within(totals).getByText(COPY.nothingRecorded)).toBeInTheDocument();
    expect(within(totals).getAllByText('0')).toHaveLength(4);
    // Two charts, each with all 24 hours: an empty hour is a stub, not a missing column.
    expect(container.querySelectorAll('[data-chart-column]')).toHaveLength(48);
    const traffic = screen.getByRole('heading', { name: COPY.trafficHeading }).closest('section') as HTMLElement;
    const rows = within(traffic).getAllByRole('row');
    // A header and one row per hour, each with its noughts as text.
    expect(rows).toHaveLength(25);
    expect(within(rows[1] as HTMLElement).getAllByText('0')).toHaveLength(2);
    expect(screen.getByText(COPY.topEmpty)).toBeInTheDocument();
  });

  it('names the hours in Baku’s clock', async () => {
    readMock.mockResolvedValue(audience());

    render(<AudienceView copy={COPY} />);

    const traffic = (await screen.findByRole('heading', { name: COPY.trafficHeading })).closest('section') as HTMLElement;
    const first = within(traffic).getAllByRole('row')[1] as HTMLElement;
    expect(within(first).getByRole('rowheader')).toHaveTextContent('7 Nov 2026, 00:00');
  });

  it('names countries in the reader’s language and an unknown one as Unknown', async () => {
    readMock.mockResolvedValue(audience());

    render(<AudienceView copy={COPY} />);

    const countries = (await screen.findByRole('heading', { name: COPY.countries })).closest('section') as HTMLElement;
    expect(within(countries).getByText('Azerbaijan')).toBeInTheDocument();
    expect(within(countries).getByText('Türkiye')).toBeInTheDocument();
    expect(within(countries).getByText(COPY.unknownCountry)).toBeInTheDocument();
    expect(within(countries).queryByText('ZZ')).not.toBeInTheDocument();

    const platforms = screen.getByRole('heading', { name: COPY.platforms }).closest('section') as HTMLElement;
    expect(within(platforms).getByText(COPY.platform.WEB as string)).toBeInTheDocument();
    expect(within(platforms).getByText(COPY.platform.ANDROID as string)).toBeInTheDocument();
  });

  it('lists the top campaigns with their public page, views, clicks and clicks per view', async () => {
    readMock.mockResolvedValue(audience());

    render(<AudienceView copy={COPY} />);

    const link = await screen.findByRole('link', { name: 'Clay studio' });
    expect(link.getAttribute('href')).toContain('/projects/aysel/clay-studio');
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('400')).toBeInTheDocument();
    expect(within(row).getByText('100')).toBeInTheDocument();
    expect(within(row).getByText('25%')).toBeInTheDocument();

    // No address, no link; no views, no rate.
    const unlisted = screen.getByText('Unlisted').closest('tr') as HTMLElement;
    expect(within(unlisted).queryByRole('link')).not.toBeInTheDocument();
    expect(within(unlisted).getByText(COPY.noViews)).toBeInTheDocument();
  });

  it('opens a campaign in place with its own breakdown, and reads it again for a new period', async () => {
    readMock.mockResolvedValue(audience());
    campaignMock.mockResolvedValue(campaign());
    const user = userEvent.setup();

    render(<AudienceView copy={COPY} />);

    const toggle = await screen.findByRole('button', {
      name: fillPlaceholders(COPY.breakdownLabel, { title: 'Clay studio' }),
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(campaignMock).not.toHaveBeenCalled();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') as string) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(campaignMock).toHaveBeenCalledWith(CAMPAIGN_ID, 'day', expect.anything());
    expect(await within(panel).findByText('5,321')).toBeInTheDocument();
    expect(within(panel).getByText(COPY.surface.DISCOVER as string)).toBeInTheDocument();
    expect(within(panel).getByText(COPY.surface.SEARCH as string)).toBeInTheDocument();
    expect(within(panel).getByText(COPY.platform.IOS as string)).toBeInTheDocument();
    expect(within(panel).getByText('Azerbaijan')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: COPY.surfacesHeading })).toBeInTheDocument();

    readMock.mockResolvedValue(audience({ period: 'month', bucket: 'DAY' }));
    await user.click(screen.getByRole('button', { name: COPY.periods.month }));
    await waitFor(() => expect(campaignMock).toHaveBeenLastCalledWith(CAMPAIGN_ID, 'month', expect.anything()));

    await user.click(screen.getByRole('button', { name: fillPlaceholders(COPY.breakdownLabel, { title: 'Clay studio' }) }));
    expect(screen.getByRole('button', { name: fillPlaceholders(COPY.breakdownLabel, { title: 'Clay studio' }) })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('refuses a member of staff without VIEW_AUDIENCE, naming it, and draws no figures', async () => {
    readMock.mockRejectedValue(
      new ApiError(403, { code: 'INSUFFICIENT_STAFF_CAPABILITY', meta: { capability: 'VIEW_AUDIENCE' } } as never),
    );

    render(<AudienceView copy={COPY} />);

    expect(await screen.findByText(COPY.refusals.capabilityTitle)).toBeInTheDocument();
    expect(screen.getByText(/VIEW_AUDIENCE/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.periods.week })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: COPY.trafficHeading })).not.toBeInTheDocument();
  });

  it('says a failed read failed, and offers to try again', async () => {
    readMock.mockRejectedValueOnce(new ApiError(500, { code: 'INTERNAL' } as never));
    readMock.mockResolvedValueOnce(audience());
    const user = userEvent.setup();

    render(<AudienceView copy={COPY} />);

    expect(await screen.findByText(COPY.errorTitle)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.tryAgain }));
    expect(await screen.findByRole('heading', { name: '7 Nov 2026' })).toBeInTheDocument();
  });

  it('shows the loading state while the first read is pending', () => {
    readMock.mockReturnValue(new Promise(() => {}));

    render(<AudienceView copy={COPY} />);

    expect(screen.getByRole('status')).toHaveTextContent(COPY.loadingList);
  });

  /*
   * Two tests rather than one with two passes, and a longer budget than the default: axe walks a
   * table and two charts here, and under a full parallel run that alone came close to five seconds.
   */
  it('has no machine-detectable accessibility violations', async () => {
    readMock.mockResolvedValue(audience());

    const { container } = render(<AudienceView copy={COPY} />);
    await screen.findByRole('link', { name: 'Clay studio' });
    await expectNoViolations(container);
  }, 20_000);

  it('has none with a campaign opened either', async () => {
    readMock.mockResolvedValue(audience());
    campaignMock.mockResolvedValue(campaign());
    const user = userEvent.setup();

    const { container } = render(<AudienceView copy={COPY} />);
    await user.click(
      await screen.findByRole('button', { name: fillPlaceholders(COPY.breakdownLabel, { title: 'Clay studio' }) }),
    );
    await screen.findByText('5,321');
    await expectNoViolations(container);
  }, 20_000);
});

describe('the audience screen’s words', () => {
  it('has every one of them in all four languages', () => {
    for (const locale of ['az', 'en', 'ru', 'tr'] as const) {
      const copy = copyFor(locale);
      for (const [key, value] of Object.entries(copy)) {
        if (typeof value === 'string') expect(value.length, `${locale}: ${key}`).toBeGreaterThan(0);
      }
      for (const period of ['day', 'week', 'month', 'year'] as const) expect(copy.periods[period]).toBeTruthy();
      for (const bucket of ['HOUR', 'DAY', 'MONTH'] as const) expect(copy.chart.granularity[bucket]).toBeTruthy();
      expect(copy.breakdownLabel).toContain('{title}');
      expect(copy.chart.summary).toContain('{first}');
    }
  });

  it('calls the period Daily, Weekly, Monthly and Yearly in Azerbaijani', () => {
    expect(copyFor('az').periods).toEqual({ day: 'Günlük', week: 'Həftəlik', month: 'Aylıq', year: 'İllik' });
  });
});
