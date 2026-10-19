import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CATALOGUE from '@ideanest/messages/en.json';
import { CampaignRewards } from './CampaignRewards';
import { tiersOf, type CampaignRewardTier } from '../../lib/projects/publicPage';
import { REWARD_MEDIA_SIZES } from '../../lib/images/sizes';
import { resolveServerTree } from '../../test-support/server-tree';
import { expectNoViolations } from '../../test-axe';

/* The real catalogue through next-intl's own formatter, as `CampaignSummary.test.tsx` does. */
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getLocale: async () => 'en',
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'en', messages: CATALOGUE, namespace: namespace as never }),
  };
});

/**
 * A reward tier's picture and clip on the campaign page.
 *
 * What fails silently: the box is not reserved (the list jumps as pictures decode), the clip
 * is fetched before anybody asked, it plays for a reader who asked for less motion, or the
 * only control for touch and keyboard has no name.
 */

const IMAGE = {
  mediaId: 'm-image',
  url: 'https://cdn.test/reward.jpg',
  width: 1200,
  height: 900,
  blurDataUrl: 'data:image/png;base64,AA',
};
const VIDEO = {
  mediaId: 'm-video',
  url: 'https://cdn.test/reward.mp4',
  posterUrl: 'https://cdn.test/reward-poster.jpg',
  width: 1280,
  height: 720,
  durationMs: 4_800,
};

function tier(media: Record<string, unknown>): CampaignRewardTier {
  const [read] = tiersOf({
    rewards: [{ id: 'tier-1', title: 'The book', price: { amount: '45.00', currency: 'AZN' }, ...media }],
  } as never);
  if (read === undefined) throw new Error('the tier was not read');
  return read;
}

async function mount(media: Record<string, unknown>) {
  return render(
    await resolveServerTree(
      <CampaignRewards
        tiers={[tier(media)]}
        projectId="p-1"
        state="LIVE"
        deadline="2026-08-29T12:00:00Z"
        now={new Date('2026-08-01T00:00:00Z')}
      />,
    ),
  );
}

let hover = true;
let reduced = false;

beforeEach(() => {
  hover = true;
  reduced = false;
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        media: query,
        matches: hover && !reduced,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a reward picture', () => {
  it('is drawn in a reserved 3:2 box, named for the tier, sized for the column', async () => {
    const { container } = await mount({ image: IMAGE });

    const image = screen.getByRole('img', { name: 'Picture of The book' });
    expect(decodeURIComponent(image.getAttribute('src') ?? '')).toContain(IMAGE.url);
    expect(image).toHaveAttribute('sizes', REWARD_MEDIA_SIZES);
    expect(container.querySelector<HTMLElement>('[data-media-frame]')?.style.aspectRatio).toBe('3 / 2');
    expect(container.querySelector('video')).toBeNull();
  });

  it('is absent, with no empty box, for a tier without one', async () => {
    const { container } = await mount({});

    expect(container.querySelector('[data-media-frame]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('gives the structured data the same picture', () => {
    expect(tier({ image: IMAGE }).imageUrl).toBe(IMAGE.url);
    expect(tier({ video: VIDEO, image: IMAGE }).imageUrl).toBe(IMAGE.url);
    expect(tier({ video: VIDEO }).imageUrl).toBe(VIDEO.posterUrl);
  });
});

describe('a reward clip', () => {
  function parts(container: HTMLElement) {
    const video = container.querySelector('video');
    const host = video?.parentElement;
    if (!video || !host) throw new Error('no clip');
    return { video, host };
  }

  it('shows its poster and fetches nothing until asked', async () => {
    const { container } = await mount({ image: IMAGE, video: VIDEO });

    // The clip wins over the picture, and its poster is decorative: the button names it.
    const poster = container.querySelector('img');
    expect(decodeURIComponent(poster?.getAttribute('src') ?? '')).toContain(VIDEO.posterUrl);
    expect(poster).toHaveAttribute('alt', '');
    const { video } = parts(container);
    expect(video).not.toHaveAttribute('src');
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('aria-hidden', 'true');
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('previews on hover and stops when the pointer leaves', async () => {
    const { container } = await mount({ video: VIDEO });
    const { video, host } = parts(container);

    fireEvent.pointerEnter(host, { pointerType: 'mouse' });
    expect(video.getAttribute('src')).toBe(VIDEO.url);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    fireEvent.pointerLeave(host, { pointerType: 'mouse' });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('does not preview under reduced motion, but still plays when its button is pressed', async () => {
    reduced = true;
    const user = userEvent.setup();
    const { container } = await mount({ video: VIDEO });
    const { video, host } = parts(container);

    fireEvent.pointerEnter(host, { pointerType: 'mouse' });
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Play the video of The book' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(video.getAttribute('src')).toBe(VIDEO.url);
  });

  it('has a play/pause button whose name says what it does now', async () => {
    hover = false;
    const user = userEvent.setup();
    const { container } = await mount({ video: VIDEO });
    const { video, host } = parts(container);

    await user.click(screen.getByRole('button', { name: 'Play the video of The book' }));
    fireEvent(video, new Event('playing'));
    expect(video).toHaveAttribute('data-playing');

    // Started by the button, so the pointer leaving does not stop it.
    fireEvent.pointerLeave(host, { pointerType: 'mouse' });
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Pause the video of The book' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    fireEvent(video, new Event('pause'));
    expect(screen.getByRole('button', { name: 'Play the video of The book' })).toBeInTheDocument();
  });

  it('fills the reserved box, so playing moves nothing', async () => {
    const { container } = await mount({ video: VIDEO });

    expect(container.querySelector<HTMLElement>('[data-media-frame]')?.style.aspectRatio).toBe('3 / 2');
    expect(container.querySelector('video')).toHaveClass('size-full', 'object-cover');
  });

  it('leaves no automatically detectable violation', async () => {
    const { container } = await mount({ video: VIDEO });
    await expectNoViolations(container);
  });
});
