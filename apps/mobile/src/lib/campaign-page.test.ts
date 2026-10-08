import type { ProjectPage } from '../api/queries';
import { readCampaignPage, tiersOf } from './campaign-page';

/**
 * The campaign page's model (#155): which responses are a page and which are the not-found
 * screen, and the rules it asks `@ideanest/campaign` for rather than working out again.
 */

const NOW = new Date('2026-10-01T12:00:00Z');

const RESPONSE: ProjectPage = {
  id: 'p1',
  slug: 'solar-lamp',
  state: 'LIVE',
  title: 'Solar Lamp',
  creator: { slug: 'aysel', name: 'Aysel' },
  goal: { amount: '1000.00', currency: 'AZN' },
  pledged: { amount: '333.33', currency: 'AZN' },
  deadline: '2026-10-04T13:00:00Z',
  risks: '  ',
};

describe('readCampaignPage', () => {
  it('reads a public campaign, with the days left and the funded percent', () => {
    const page = readCampaignPage(RESPONSE, 'aysel', NOW);
    expect(page).not.toBeNull();
    expect(page?.daysLeft).toBe(3);
    expect(page?.completionPercent?.toFixed(2)).toBe('33.33');
    // Blank text is no text: no risks section for whitespace.
    expect(page?.risks).toBeNull();
    expect(page?.story).toBeNull();
  });

  it('is not a page for a state with no public page, or without a title, creator or figure', () => {
    expect(readCampaignPage({ ...RESPONSE, state: 'DRAFT' }, 'aysel', NOW)).toBeNull();
    expect(readCampaignPage({ ...RESPONSE, state: 'SUBMITTED' }, 'aysel', NOW)).toBeNull();
    expect(readCampaignPage({ ...RESPONSE, title: ' ' }, 'aysel', NOW)).toBeNull();
    expect(readCampaignPage({ ...RESPONSE, creator: { slug: 'aysel' } }, 'aysel', NOW)).toBeNull();
    expect(readCampaignPage({ ...RESPONSE, pledged: undefined }, 'aysel', NOW)).toBeNull();
    expect(readCampaignPage(undefined, 'aysel', NOW)).toBeNull();
  });

  it('has no percent without a goal, and zero days once the deadline has passed', () => {
    const page = readCampaignPage(
      { ...RESPONSE, goal: undefined, deadline: '2026-09-01T00:00:00Z', state: 'SUCCESSFUL' },
      'aysel',
      NOW,
    );
    expect(page?.completionPercent).toBeNull();
    expect(page?.daysLeft).toBe(0);
  });

  it('reads the video a player needs, and no video from one that lacks any of it (#331)', () => {
    const video = {
      mediaId: '7d0c5b8e-0f6e-4c43-9a43-2a3f0c8a1b11',
      url: 'https://media.example/v.mp4',
      posterUrl: 'https://media.example/v.jpg',
      width: 1280,
      height: 720,
      durationMs: 45_200,
      blurDataUrl: 'data:image/webp;base64,AAAA',
    };
    expect(readCampaignPage({ ...RESPONSE, video }, 'aysel', NOW)?.video).toEqual({
      url: video.url,
      posterUrl: video.posterUrl,
      width: 1280,
      height: 720,
      durationMs: 45_200,
      blurDataUrl: video.blurDataUrl,
    });
    expect(readCampaignPage(RESPONSE, 'aysel', NOW)?.video).toBeNull();
    for (const broken of [
      { ...video, url: ' ' },
      { ...video, posterUrl: undefined },
      { ...video, width: 0 },
      { ...video, durationMs: undefined },
    ]) {
      expect(readCampaignPage({ ...RESPONSE, video: broken }, 'aysel', NOW)?.video).toBeNull();
    }
    expect(
      readCampaignPage({ ...RESPONSE, video: { ...video, blurDataUrl: undefined } }, 'aysel', NOW)?.video?.blurDataUrl,
    ).toBeNull();
  });
});

describe('tiersOf', () => {
  it('keeps the tiers it can draw, unlimited as null and sold out as zero', () => {
    const tiers = tiersOf({
      rewards: [
        { id: 't1', title: 'One', price: { amount: '5.00', currency: 'AZN' } },
        { id: 't2', title: 'Two', price: { amount: '9.00', currency: 'AZN' }, remainingQuantity: 0 },
        { id: 't3', price: { amount: '9.00', currency: 'AZN' } },
        { id: 't4', title: 'No price' },
      ],
    });
    expect(tiers.map((tier) => [tier.id, tier.remainingQuantity])).toEqual([
      ['t1', null],
      ['t2', 0],
    ]);
    expect(tiersOf(undefined)).toEqual([]);
  });
});
