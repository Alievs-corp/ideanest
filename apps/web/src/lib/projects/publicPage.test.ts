import { describe, expect, it } from 'vitest';
import type { ProjectPageResponse } from '../api/server';
import { isPubliclyVisible, PROJECT_STATES } from '../seo/metadata';
import { previewOf, readCampaignPage, RENDERABLE_STATES, tiersOf } from './publicPage';

/**
 * The narrowing between the published contract and the page — #119.
 *
 * Every property on `ProjectPageResponse` is optional, because springdoc marks a field
 * required only when it can prove it. So this module is the one place that decides which
 * absences are survivable and which mean the response is not a campaign, and these are the
 * decisions:
 *
 *   - a missing identity, title or creator is `null` overall, never a half-built page;
 *   - a state that has no campaign page is `null`, which is the second lock on that door;
 *   - a missing goal, story, cover or outcome is a campaign without one, not a failure.
 *
 * The derived values get their own tests because both are arithmetic somebody will be shown:
 * the completion percentage is what "funded" means, and the countdown is what "last day"
 * means.
 */

const NOW = new Date('2026-08-19T12:00:00Z');

function response(overrides: Partial<ProjectPageResponse> = {}): ProjectPageResponse {
  return {
    id: '0193f2a1-0000-7000-8000-000000000001',
    slug: 'coffee-table-book',
    state: 'LIVE',
    title: 'A coffee table book',
    blurb: 'Two hundred photographs of Baku.',
    creator: { slug: 'ayan', name: 'Ayan', avatarUrl: null },
    category: { slug: 'design', name: 'Dizayn' },
    subcategory: null,
    coverImage: { url: 'https://cdn.example.com/cover.jpg', width: 1600, height: 900 },
    goal: { amount: '10000.00', currency: 'AZN' },
    pledged: { amount: '12500.00', currency: 'AZN' },
    backersCount: 42,
    launchedAt: '2026-07-20T00:00:00Z',
    deadline: '2026-08-29T12:00:00Z',
    risks: 'Manufacturing capacity.',
    ...overrides,
  } as ProjectPageResponse;
}

describe('readCampaignPage', () => {
  it('reads a live campaign', () => {
    const page = readCampaignPage(response(), 'ayan', NOW);

    expect(page).not.toBeNull();
    expect(page?.title).toBe('A coffee table book');
    expect(page?.creatorSlug).toBe('ayan');
    expect(page?.creator.name).toBe('Ayan');
    expect(page?.category).toEqual({ slug: 'design', name: 'Dizayn' });
  });

  it('is null when the service refused the read', () => {
    expect(readCampaignPage(null, 'ayan', NOW)).toBeNull();
  });

  /**
   * The second lock on the same door: the endpoint refuses a campaign the public may not
   * see, and this refuses one that arrives anyway.
   *
   * `SCHEDULED` is in the list and `SUSPENDED` is beside it for different reasons.
   * `SCHEDULED`'s public surface is the pre-launch route and not this page; `SUSPENDED` is
   * a campaign trust and safety stopped, and serving it would republish what the platform
   * has just withdrawn.
   */
  it.each(['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'SUSPENDED', 'REJECTED'])(
    'is null for a campaign in %s',
    (state) => {
      expect(readCampaignPage(response({ state }), 'ayan', NOW)).toBeNull();
    },
  );

  /**
   * And the one state the two lists disagree about, asserted from this side.
   *
   * A cancelled campaign has a page: its backers committed money to something that is not
   * going to happen, and the page is where they are told. `isPubliclyVisible` still refuses
   * to *describe* it, which is what keeps it out of a social card — see `RENDERABLE_STATES`.
   */
  it('renders a cancelled campaign, because its backers are owed the page', () => {
    expect(readCampaignPage(response({ state: 'CANCELED' }), 'ayan', NOW)).not.toBeNull();
  });

  it.each([
    ['no title', { title: undefined }],
    ['a blank title', { title: '   ' }],
    ['no identifier', { id: undefined }],
    ['no slug', { slug: undefined }],
    ['no creator', { creator: undefined }],
    ['a creator with no name', { creator: { slug: 'ayan' } }],
    ['no pledged total', { pledged: undefined }],
  ])('is null for a response with %s', (_label, overrides) => {
    expect(readCampaignPage(response(overrides as Partial<ProjectPageResponse>), 'ayan', NOW)).toBeNull();
  });

  it('renders a pre-launch campaign that has no goal yet', () => {
    const page = readCampaignPage(
      response({ state: 'PRELAUNCH', goal: undefined, deadline: undefined }),
      'ayan',
      NOW,
    );

    expect(page).not.toBeNull();
    expect(page?.goal).toBeNull();
    // A percentage of nothing is undefined rather than zero: "0% of goal" would tell a
    // reader a campaign had raised none of a goal it has not set.
    expect(page?.completionPercent).toBeNull();
    expect(page?.daysLeft).toBeNull();
  });

  it('drops a cover image whose dimensions are missing', () => {
    const page = readCampaignPage(
      response({ coverImage: { url: 'https://cdn.example.com/cover.jpg' } as never }),
      'ayan',
      NOW,
    );

    // The three columns are written together, and the dimensions are what let the layout
    // reserve the box. A cover without them is a layout shift waiting to happen.
    expect(page?.coverImage).toBeNull();
  });

  it('reads the campaign video the service measured', () => {
    const video = {
      mediaId: '6f1c2a9e-1b9f-4c55-9a51-2d1f4ad0c0de',
      url: 'https://cdn.example.com/media/clip.mp4',
      posterUrl: 'https://cdn.example.com/media/clip.poster.webp',
      width: 1280,
      height: 720,
      durationMs: 42_000,
      blurDataUrl: 'data:image/webp;base64,AAAA',
    };

    expect(readCampaignPage(response({ video }), 'ayan', NOW)?.video).toEqual({
      url: 'https://cdn.example.com/media/clip.mp4',
      posterUrl: 'https://cdn.example.com/media/clip.poster.webp',
      width: 1280,
      height: 720,
      durationMs: 42_000,
    });
  });

  it('offers no video rather than one it cannot play', () => {
    // No video at all is the ordinary case, and the response simply leaves the field out.
    expect(readCampaignPage(response(), 'ayan', NOW)?.video).toBeNull();

    // A video without a poster or a length cannot reserve its box or name its control, and a
    // play button that does nothing is the promise the media player refuses to make.
    const partial = { url: 'https://cdn.example.com/media/clip.mp4', width: 1280, height: 720 };
    expect(readCampaignPage(response({ video: partial as never }), 'ayan', NOW)?.video).toBeNull();
  });
});

describe('the completion percentage', () => {
  /**
   * Rounded DOWN, and this is the row that matters. 100% is the word "funded" on this
   * platform, so a campaign at 99.996% must not be reported as having reached its goal.
   */
  it('rounds down rather than to nearest', () => {
    const page = readCampaignPage(
      response({ pledged: { amount: '9999.60', currency: 'AZN' } }),
      'ayan',
      NOW,
    );

    expect(page?.completionPercent?.toFixed(2)).toBe('99.99');
  });

  it('is a decimal, computed from the strings and never from numbers', () => {
    const page = readCampaignPage(response(), 'ayan', NOW);

    expect(page?.completionPercent?.toFixed(2)).toBe('125.00');
  });

  it('is null rather than infinite for a goal of zero', () => {
    const page = readCampaignPage(
      response({ goal: { amount: '0.00', currency: 'AZN' } }),
      'ayan',
      NOW,
    );

    expect(page?.completionPercent).toBeNull();
  });
});

describe('the countdown', () => {
  it('counts whole days to the deadline', () => {
    const page = readCampaignPage(response({ deadline: '2026-08-29T12:00:00Z' }), 'ayan', NOW);

    expect(page?.daysLeft).toBe(10);
  });

  it('floors a passed deadline at zero rather than going negative', () => {
    const page = readCampaignPage(response({ deadline: '2026-08-01T00:00:00Z' }), 'ayan', NOW);

    expect(page?.daysLeft).toBe(0);
  });

  it('is null when there is no deadline to count to', () => {
    const page = readCampaignPage(response({ deadline: undefined }), 'ayan', NOW);

    expect(page?.daysLeft).toBeNull();
  });
});

describe('the frozen outcome', () => {
  /**
   * #63's rule, on the surface that reports it: the live total keeps moving as collections
   * fail, and the outcome does not. A page that read one number for both would eventually
   * contradict the word "Funded" printed beside it.
   */
  it('is read beside the live total, not instead of it', () => {
    const page = readCampaignPage(
      response({
        state: 'SUCCESSFUL',
        pledged: { amount: '9568.00', currency: 'AZN' },
        outcome: {
          goal: { amount: '10000.00', currency: 'AZN' },
          pledged: { amount: '12500.00', currency: 'AZN' },
          backersCount: 80,
          finalisedAt: '2026-08-18T00:00:00Z',
        },
      }),
      'ayan',
      NOW,
    );

    expect(page?.pledged.amount).toBe('9568.00');
    expect(page?.outcome?.pledged?.amount).toBe('12500.00');
    expect(page?.outcome?.backersCount).toBe(80);
  });

  it('is absent while the campaign is still running', () => {
    expect(readCampaignPage(response(), 'ayan', NOW)?.outcome).toBeNull();
  });
});

/**
 * The two lists, checked against each other.
 *
 * Both describe a set of §6.1 states and both are written out rather than derived, which is
 * the arrangement the service uses for the same pair. What makes that safe rather than
 * duplicative is this test: the day somebody adds a state to one of them, the difference
 * between the two has to be re-stated here deliberately rather than discovered on a
 * campaign page.
 */
describe('which states have a page and which may be described', () => {
  it('differ on exactly CANCELED and SCHEDULED', () => {
    const describable = PROJECT_STATES.filter((state) => isPubliclyVisible(state));
    const renderable = [...RENDERABLE_STATES];

    expect(renderable.filter((state) => !describable.includes(state))).toEqual(['CANCELED']);
    expect(describable.filter((state) => !renderable.includes(state))).toEqual(['SCHEDULED']);
  });
});

describe('previewOf', () => {
  it('carries only what the head is allowed to know', () => {
    const page = readCampaignPage(response(), 'ayan', NOW);

    expect(previewOf(page!)).toEqual({
      id: page!.id,
      slug: 'coffee-table-book',
      state: 'LIVE',
      title: 'A coffee table book',
      blurb: 'Two hundred photographs of Baku.',
      coverImage: { url: 'https://cdn.example.com/cover.jpg', width: 1600, height: 900 },
    });
  });
});

describe('tiersOf', () => {
  it('keeps the tiers and leaves the add-ons out', () => {
    const tiers = tiersOf({
      currency: 'AZN',
      rewards: [
        {
          id: 'tier-1',
          title: 'Early bird',
          description: 'The book, signed.',
          price: { amount: '45.00', currency: 'AZN' },
          remainingQuantity: 0,
        },
      ],
      addons: [
        { id: 'addon-1', title: 'A postcard', price: { amount: '5.00', currency: 'AZN' } },
      ],
    } as never);

    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ id: 'tier-1', title: 'Early bird', remainingQuantity: 0 });
  });

  it('is empty rather than throwing when the read failed', () => {
    expect(tiersOf(null)).toEqual([]);
  });

  it('skips a tier with no price rather than pricing it at nothing', () => {
    const tiers = tiersOf({ rewards: [{ id: 'tier-1', title: 'Broken' }] } as never);

    expect(tiers).toEqual([]);
  });
});
