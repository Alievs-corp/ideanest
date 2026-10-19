import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ExpoVideo from 'expo-video';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { tiersOf } from '../../lib/campaign-page';
import { checkoutHref } from '../../lib/campaign-actions';
import { setLocale } from '../../lib/locale';
import { currentPreview } from '../../lib/media/hold-preview';
import { MotionBudgetProvider, type MotionLevel } from '../ui';
import { CampaignRewards } from './campaign-rewards';

/**
 * The rewards' picture and clip on the campaign page: a picture named for its tier, a clip's
 * poster that plays while held and stops on release, a tap that still selects the tier, and a
 * play/pause button for a screen reader instead of a hold.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

let mockAssisted = false;
jest.mock('../ui/assistive-tech', () => ({ useAssistiveTechnology: () => mockAssisted }));

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => <View {...props} /> };
});

const players = (ExpoVideo as unknown as {
  __players: { source: unknown; play: jest.Mock; loop: boolean; muted?: boolean }[];
}).__players;

const TIERS = tiersOf({
  rewards: [
    {
      id: 't-image',
      title: 'The mug',
      price: { amount: '15.00', currency: 'AZN' },
      image: { url: 'https://cdn.example/mug.jpg', width: 1200, height: 800 },
    },
    {
      id: 't-video',
      title: 'The lamp',
      price: { amount: '40.00', currency: 'AZN' },
      // A clip wins over a picture: the poster is drawn and the clip previews over it.
      image: { url: 'https://cdn.example/lamp.jpg', width: 1200, height: 800 },
      video: {
        url: 'https://cdn.example/lamp.mp4',
        posterUrl: 'https://cdn.example/lamp-poster.jpg',
        width: 1280,
        height: 720,
        durationMs: 4_000,
      },
    },
    { id: 't-plain', title: 'Thanks', price: { amount: '5.00', currency: 'AZN' } },
  ],
});

async function show(level: MotionLevel = 'full', pledgeable = true) {
  await act(async () => setLocale('en'));
  return render(
    <MotionBudgetProvider level={level}>
      <IntlProvider locale="en" messages={en}>
        <CampaignRewards projectId="p1" tiers={TIERS} pledgeable={pledgeable} />
      </IntlProvider>
    </MotionBudgetProvider>,
  );
}

const PREVIEW = 'reward-preview-t-video';

beforeEach(() => {
  players.length = 0;
  mockPush.mockClear();
  mockAssisted = false;
});

describe('a reward’s picture', () => {
  it('opens its card, named for its tier, in a reserved 3:2 box', async () => {
    await show();
    const image = screen.getByRole('image', { name: 'Picture of The mug' });
    expect(image.props.source).toEqual({ uri: 'https://cdn.example/mug.jpg' });
    expect(screen.getByTestId('reward-image-t-image')).toBeTruthy();
    // A tier with neither draws no box.
    expect(screen.queryByTestId('reward-image-t-plain')).toBeNull();
    expect(screen.queryByTestId('reward-video-t-plain')).toBeNull();
  });
});

describe('a reward’s clip', () => {
  it('shows its poster and its length, and plays nothing until held', async () => {
    await show();
    expect(screen.getByTestId('reward-poster-t-video', { includeHiddenElements: true }).props.source).toEqual({
      uri: 'https://cdn.example/lamp-poster.jpg',
    });
    expect(screen.getByText('0:04', { includeHiddenElements: true })).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Play the video of The lamp' });
    expect(button.props.accessibilityHint).toBe('Press and hold to play the video');
    expect(screen.queryByTestId(PREVIEW, { includeHiddenElements: true })).toBeNull();
    expect(players).toHaveLength(0);
  });

  it('plays muted and looping while held, and stops on release', async () => {
    await show();
    const button = screen.getByTestId('reward-video-t-video');
    await fireEvent(button, 'longPress');
    expect(screen.getByTestId(PREVIEW, { includeHiddenElements: true })).toBeTruthy();
    expect(players[0]).toMatchObject({ source: 'https://cdn.example/lamp.mp4', loop: true, muted: true });
    expect(players[0]?.play).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    await fireEvent(button, 'pressOut');
    expect(screen.queryByTestId(PREVIEW, { includeHiddenElements: true })).toBeNull();
    expect(currentPreview()).toBeNull();
  });

  it('selects the tier on a tap, like the rest of its card', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('reward-video-t-video'));
    expect(mockPush).toHaveBeenCalledWith(checkoutHref('p1', 't-video'));
    expect(screen.queryByTestId(PREVIEW, { includeHiddenElements: true })).toBeNull();
  });

  it('never plays on a hold under Reduce Motion', async () => {
    await show('none');
    const button = screen.getByTestId('reward-video-t-video');
    expect(button.props.accessibilityHint).toBeUndefined();
    await fireEvent(button, 'longPress');
    expect(screen.queryByTestId(PREVIEW, { includeHiddenElements: true })).toBeNull();
  });

  it('with a screen reader, is a button that plays and pauses it', async () => {
    mockAssisted = true;
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Play the video of The lamp' }));
    expect(screen.getByTestId(PREVIEW, { includeHiddenElements: true })).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    // A lifted finger does not stop what a button started.
    await fireEvent(screen.getByTestId('reward-video-t-video'), 'pressOut');
    expect(screen.getByTestId(PREVIEW, { includeHiddenElements: true })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Pause the video of The lamp' }));
    expect(screen.queryByTestId(PREVIEW, { includeHiddenElements: true })).toBeNull();
  });
});
