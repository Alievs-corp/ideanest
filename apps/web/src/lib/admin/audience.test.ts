import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import {
  bucketLabel,
  campaignPath,
  clickRatio,
  countScale,
  countryLabel,
  readCampaignAudience,
  readPlatformAudience,
  windowDates,
} from './audience';

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));

const fetchMock = vi.mocked(authorizedFetch);

afterEach(() => {
  fetchMock.mockReset();
});

describe('reading the audience', () => {
  it('asks for the platform figures over the chosen period', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ period: 'week' }), { status: 200 }));

    await readPlatformAudience('week');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/admin/audience?period=week');
  });

  it('asks for one campaign over the same period', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ period: 'year' }), { status: 200 }));

    await readCampaignAudience('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', 'year');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/admin/audience/projects/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0?period=year',
    );
  });

  it('turns a refusal into the error the console reads', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'INSUFFICIENT_STAFF_CAPABILITY' }), {
        status: 403,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    await expect(readPlatformAudience('day')).rejects.toMatchObject({ status: 403 });
  });
});

describe('countScale', () => {
  it('steps in whole numbers, never 2.5 of a person', () => {
    for (const peak of [1, 3, 7, 10, 23, 99, 1234]) {
      const scale = countScale(peak);
      for (const tick of scale.ticks) expect(Number.isInteger(tick), `${peak}: ${tick}`).toBe(true);
      expect(scale.max).toBeGreaterThanOrEqual(peak);
      expect(scale.ticks.length - 1).toBeLessThanOrEqual(5);
    }
  });

  it('draws an empty period on a scale of one rather than dividing by nought', () => {
    expect(countScale(0)).toEqual({ max: 1, ticks: [0, 1] });
  });

  it('picks round steps', () => {
    expect(countScale(10).ticks).toEqual([0, 2, 4, 6, 8, 10]);
    expect(countScale(1234).ticks).toEqual([0, 500, 1000, 1500]);
  });
});

describe('bucketLabel', () => {
  it('names an hour in Baku’s clock, not UTC’s', () => {
    // 20:00 UTC on the 6th is midnight on the 7th in Baku.
    expect(bucketLabel('2026-11-06T20:00:00Z', 'HOUR', 'en', 'short')).toBe('00:00');
    expect(bucketLabel('2026-11-06T20:00:00Z', 'HOUR', 'en', 'long')).toContain('7 Nov 2026');
  });

  it('names a day as the Baku date it starts', () => {
    expect(bucketLabel('2026-11-06T20:00:00Z', 'DAY', 'en', 'short')).toBe('7 Nov');
    expect(bucketLabel('2026-11-06T20:00:00Z', 'DAY', 'az', 'long')).toBe('7 noy 2026');
  });

  it('names a month, with the year where the axis starts and at January', () => {
    // The first of November in Baku is 20:00 UTC on the 31st of October.
    expect(bucketLabel('2026-10-31T20:00:00Z', 'MONTH', 'en', 'short')).toBe('Nov');
    expect(bucketLabel('2026-10-31T20:00:00Z', 'MONTH', 'en', 'short', true)).toBe('Nov 2026');
    expect(bucketLabel('2026-12-31T20:00:00Z', 'MONTH', 'en', 'short')).toBe('Jan 2027');
    expect(bucketLabel('2026-10-31T20:00:00Z', 'MONTH', 'en', 'long')).toBe('November 2026');
  });
});

describe('windowDates', () => {
  it('reads the exclusive end as the day before it', () => {
    // `week`: seven Baku days, the last ending at midnight on the 8th.
    expect(windowDates('2026-10-31T20:00:00Z', '2026-11-07T20:00:00Z', 'DAY', 'en')).toEqual({
      first: '1 Nov 2026',
      last: '7 Nov 2026',
    });
  });

  it('is one day for `day`', () => {
    const { first, last } = windowDates('2026-11-06T20:00:00Z', '2026-11-07T20:00:00Z', 'HOUR', 'en');
    expect(first).toBe(last);
  });

  it('is months for `year`', () => {
    expect(windowDates('2025-11-30T20:00:00Z', '2026-11-30T20:00:00Z', 'MONTH', 'en')).toEqual({
      first: 'December 2025',
      last: 'November 2026',
    });
  });
});

describe('the small rules', () => {
  it('names an unknown country with the catalogue’s word', () => {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    expect(countryLabel('ZZ', display, 'Unknown')).toBe('Unknown');
    expect(countryLabel('AZ', display, 'Unknown')).toBe('Azerbaijan');
    expect(countryLabel('AZ', null, 'Unknown')).toBe('AZ');
  });

  it('has no click-through rate for a campaign nobody viewed', () => {
    expect(clickRatio(0, 3)).toBeNull();
    expect(clickRatio(200, 50)).toBe(0.25);
  });

  it('links only a campaign that has an address', () => {
    expect(campaignPath({ creatorSlug: 'aysel', slug: 'clay studio' })).toBe('/projects/aysel/clay%20studio');
    expect(campaignPath({ creatorSlug: 'aysel' })).toBeNull();
  });
});
