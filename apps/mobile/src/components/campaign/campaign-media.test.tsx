import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ExpoVideo from 'expo-video';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import type { CampaignCover, CampaignPageVideo } from '../../lib/campaign-page';
import { setLocale } from '../../lib/locale';
import { CampaignMedia } from './campaign-media';

/*
 * The campaign page's first block with a video (#331): a play button over the picture, and the
 * native player only after somebody pressed it.
 */

jest.setTimeout(30_000);

const players = (ExpoVideo as unknown as { __players: { source: unknown; play: jest.Mock }[] }).__players;

const COVER: CampaignCover = { url: 'https://cdn.example/lamp.jpg', width: 1600, height: 900 };
const VIDEO: CampaignPageVideo = {
  url: 'https://media.example/v.mp4',
  posterUrl: 'https://media.example/v.jpg',
  width: 1280,
  height: 720,
  durationMs: 45_200,
  blurDataUrl: null,
};

async function show(cover: CampaignCover | null, video: CampaignPageVideo | null) {
  await act(async () => setLocale('en'));
  await render(
    <IntlProvider locale="en" messages={en}>
      <CampaignMedia cover={cover} video={video} tag="campaign-cover:aysel/solar-lamp" />
    </IntlProvider>,
  );
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

  it('with a video, offers to play it over the cover, named with its length, and plays nothing yet', async () => {
    await show(COVER, VIDEO);
    expect(screen.getByTestId('campaign-cover', { includeHiddenElements: true }).props.source).toEqual({ uri: COVER.url });
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
      accessibilityLabel: en.mobile.campaign.video.player,
    });
    expect(players).toHaveLength(1);
    expect(players[0]?.source).toBe(VIDEO.url);
    expect(players[0]?.play).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('campaign-video-play')).toBeNull();
  });
});
