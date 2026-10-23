import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, ScrollView } from 'react-native';
import * as ExpoVideo from 'expo-video';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import type { CampaignCover, CampaignPageVideo } from '../../lib/campaign-page';
import { setLocale } from '../../lib/locale';
import { Glyphs } from '../../icons';
import { FOCUS_DELAY_MS } from '../ui/overlay';
import { CampaignMedia } from './campaign-media';

/*
 * The campaign page's first block with a video (#331): a play button over the picture, and the
 * native player only after somebody pressed it.
 */

jest.setTimeout(30_000);

const players = (ExpoVideo as unknown as { __players: { source: unknown; play: jest.Mock; pause: jest.Mock }[] })
  .__players;

const COVER: CampaignCover = { url: 'https://cdn.example/lamp.jpg', width: 1600, height: 900 };
const VIDEO: CampaignPageVideo = {
  url: 'https://media.example/v.mp4',
  posterUrl: 'https://media.example/v.jpg',
  width: 1280,
  height: 720,
  durationMs: 45_200,
  blurDataUrl: null,
};

/** How many drawn paths sit under a host element. */
function pathsIn(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;
  const { type, children } = node as { type?: unknown; children?: readonly unknown[] };
  const own = type === 'RNSVGPath' ? 1 : 0;
  return own + (children ?? []).reduce<number>((sum, child) => sum + pathsIn(child), 0);
}

function tree(cover: CampaignCover | null, video: CampaignPageVideo | null, active = true) {
  return (
    <IntlProvider locale="en" messages={en}>
      <CampaignMedia cover={cover} video={video} active={active} tag="campaign-cover:aysel/solar-lamp" />
    </IntlProvider>
  );
}

async function show(cover: CampaignCover | null, video: CampaignPageVideo | null) {
  await act(async () => setLocale('en'));
  return await render(tree(cover, video));
}

beforeEach(() => {
  players.length = 0;
});

describe('CampaignMedia', () => {
  it('without a video, is the cover alone, with nothing to press', async () => {
    await show(COVER, null);
    expect(screen.getByTestId('campaign-cover', { includeHiddenElements: true }).props.source).toEqual({ uri: COVER.url });
    expect(screen.queryByTestId('campaign-video-play')).toBeNull();
    expect(players).toHaveLength(0);
  });

  it('with a video, offers to play it over its own poster, named with its length, and plays nothing yet', async () => {
    await show(COVER, VIDEO);
    // The video is the cover: its poster, not the uploaded picture — what the card shows too.
    expect(screen.getByTestId('campaign-cover', { includeHiddenElements: true }).props.source).toEqual({
      uri: VIDEO.posterUrl,
    });
    const play = screen.getByRole('button', { name: 'Play the campaign video, 45 seconds long' });
    expect(play).toBeTruthy();
    expect(screen.getByTestId('campaign-video-length')).toHaveTextContent('0:45');
    // No autoplay: the player does not exist until the press.
    expect(screen.queryByTestId('campaign-video-player')).toBeNull();
    expect(players).toHaveLength(0);
  });

  it("shows the video's poster when the campaign has no cover", async () => {
    await show(null, VIDEO);
    expect(screen.getByTestId('campaign-cover', { includeHiddenElements: true }).props.source).toEqual({ uri: VIDEO.posterUrl });
  });

  it('pressed, mounts the native player with its controls and fullscreen, and starts it', async () => {
    await show(COVER, VIDEO);
    await fireEvent.press(screen.getByTestId('campaign-video-play'));

    const player = screen.getByTestId('campaign-video-player');
    expect(player.props).toMatchObject({
      nativeControls: true,
      contentFit: 'contain',
      fullscreenOptions: { enable: true },
      allowsPictureInPicture: false,
      // A SurfaceView ignores the frame's rounded clip and shows through the sticky header.
      surfaceType: 'textureView',
      accessibilityLabel: en.mobile.campaign.video.player,
    });
    expect(players).toHaveLength(1);
    expect(players[0]?.source).toBe(VIDEO.url);
    expect(players[0]?.play).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('campaign-video-play')).toBeNull();
  });

  it('draws the play glyph in the Bulk style at the button size (mobile-design §5)', async () => {
    await show(COVER, VIDEO);
    const glyph = screen.getByTestId('icon-Play', { includeHiddenElements: true });
    expect(glyph.props.width).toBe(20);
    // Bulk is the two-layer drawing, its second layer the same colour at 40%.
    // Bulk is the two-layer drawing (its second layer the same colour at 40%); Bold is one.
    expect(Glyphs.Play.bulk).toHaveLength(2);
    expect(Glyphs.Play.bold).toHaveLength(1);
    expect(pathsIn(glyph)).toBe(Glyphs.Play.bulk.length);
  });

  it('moves screen-reader focus onto the player once it is drawn', async () => {
    jest.useFakeTimers();
    const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    try {
      await show(COVER, VIDEO);
      await fireEvent.press(screen.getByTestId('campaign-video-play'));
      expect(send).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(FOCUS_DELAY_MS);
      });
      expect(send).toHaveBeenCalledWith(expect.anything(), 'focus');
      const [target] = send.mock.calls[0] as [{ props?: { testID?: string } }, string];
      expect(target).not.toBeNull();
    } finally {
      send.mockRestore();
      jest.useRealTimers();
    }
  });

  it('pauses when the page stops being the one in front, and stays paused when it comes back', async () => {
    const view = await show(COVER, VIDEO);
    await fireEvent.press(screen.getByTestId('campaign-video-play'));
    const player = players[0];
    expect(player?.pause).not.toHaveBeenCalled();

    // A push to checkout or sign-in leaves this screen mounted underneath.
    await view.rerender(tree(COVER, VIDEO, false));
    expect(player?.pause).toHaveBeenCalledTimes(1);

    await view.rerender(tree(COVER, VIDEO, true));
    expect(player?.play).toHaveBeenCalledTimes(1);
    // The same player, on the frame it stopped at: nothing was torn down or started again.
    expect(players).toHaveLength(1);
    expect(screen.getByTestId('campaign-video-player')).toBeTruthy();
  });

  it('before the press, a page that is not in front creates no player at all', async () => {
    const view = await show(COVER, VIDEO);
    await view.rerender(tree(COVER, VIDEO, false));
    expect(players).toHaveLength(0);
  });
});

describe('CampaignMedia with a video and a cover (#545)', () => {
  const page = (name: 'video' | 'cover') =>
    screen.getByTestId(`campaign-media-page-${name}`, { includeHiddenElements: true });

  /** The pager as the platform reports it: measured, then settled after a swipe. */
  async function measure(width = 360) {
    await fireEvent(screen.getByTestId('campaign-media-pager'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width, height: (width * 9) / 16 } },
    });
  }
  async function settle(x: number) {
    await fireEvent(screen.getByTestId('campaign-media-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x, y: 0 } },
    });
  }

  it('pages sideways between the video and the cover, with the cover out of sight at first', async () => {
    await show(COVER, VIDEO);
    expect(screen.getByTestId('campaign-media-pager').props).toMatchObject({ horizontal: true, pagingEnabled: true });
    expect(screen.getByTestId('campaign-cover', { includeHiddenElements: true }).props.source).toEqual({
      uri: VIDEO.posterUrl,
    });
    expect(screen.getByTestId('campaign-cover-image', { includeHiddenElements: true }).props.source).toEqual({
      uri: COVER.url,
    });
    // One page in front: the other is hidden from a screen reader.
    expect(page('video').props.importantForAccessibility).toBe('auto');
    expect(page('cover').props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByRole('button', { name: en.mobile.campaign.video.showVideo }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByRole('button', { name: en.mobile.campaign.video.showCover }).props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('follows a swipe to the cover, and pauses the video it left without starting it again', async () => {
    await show(COVER, VIDEO);
    await measure();
    await fireEvent.press(screen.getByTestId('campaign-video-play'));
    const player = players[0];

    await settle(360);
    expect(player?.pause).toHaveBeenCalledTimes(1);
    expect(page('cover').props.importantForAccessibility).toBe('auto');
    expect(page('video').props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByRole('button', { name: en.mobile.campaign.video.showCover }).props.accessibilityState).toEqual({
      selected: true,
    });

    await settle(0);
    expect(player?.play).toHaveBeenCalledTimes(1);
    expect(page('video').props.importantForAccessibility).toBe('auto');
  });

  it.each([
    ['scrolls to it', false],
    ['with Reduce Motion on, moves there without the scroll', true],
  ])('jumps to a page from its dot: %s', async (_, reduced) => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduced);
    const scrollTo = jest.spyOn(ScrollView.prototype as { scrollTo: (to: unknown) => void }, 'scrollTo');
    try {
      await show(COVER, VIDEO);
      await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
      await measure();

      await fireEvent.press(screen.getByRole('button', { name: en.mobile.campaign.video.showCover }));
      expect(scrollTo).toHaveBeenCalledWith({ x: 360, animated: !reduced });
      expect(page('cover').props.importantForAccessibility).toBe('auto');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it.each([
    ['a cover', COVER, null],
    ['a video', null, VIDEO],
  ] as const)('has no pager and no dots for a campaign with only %s', async (_, cover, video) => {
    await show(cover, video);
    expect(screen.queryByTestId('campaign-media-pager')).toBeNull();
    expect(screen.queryByRole('button', { name: en.mobile.campaign.video.showCover })).toBeNull();
  });
});
