import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import type { ProjectEdit, Reward } from '@ideanest/campaign-editor/contract';
import { editorChromeCopyFrom, rewardsPanelCopyFrom } from '@ideanest/campaign-editor/copy';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../../lib/locale';
import { forgetPicked, uploadImage, uploadVideo } from '../../../lib/media/upload';
import { editorTranslators } from '../translator';
import { RewardEditor } from './reward-editor';

/*
 * A reward tier's picture and its clip of at most five seconds, in the drawer: both uploads,
 * both kept in the draft until Save, both sent by id only, and a clip the service measured as too
 * long taken back out with the refusal said under the field.
 */

const mockSend = jest.fn();
jest.mock('../../../api/client', () => ({
  api: () => ({ get: jest.fn() }),
  sendJson: (...args: unknown[]) => mockSend(...args),
  traceIdOfError: () => null,
}));
jest.mock('../../../lib/media/upload', () => {
  const actual = jest.requireActual('../../../lib/media/upload');
  return { ...actual, uploadImage: jest.fn(), uploadVideo: jest.fn(), forgetPicked: jest.fn() };
});
jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => createElement(View, { testID: props.testID }),
    DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() },
  };
});

jest.setTimeout(30_000);

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const { t, counter } = editorTranslators('en');
const COPY = rewardsPanelCopyFrom(t, 'en', editorChromeCopyFrom(t, counter, 'en').characterCount);
const TIER = en.campaignEditor.rewards.tier;

const picker = ImagePicker as unknown as typeof ImagePicker & {
  __setNextResult: (result: Record<string, unknown>) => void;
  __reset: () => void;
};
const imageUpload = jest.mocked(uploadImage);
const videoUpload = jest.mocked(uploadVideo);

const PROJECT: ProjectEdit = {
  id: 'p1',
  slug: 'solar-lamp',
  state: 'LIVE',
  title: 'Solar Lamp',
  goal: { amount: '5000.00', currency: 'AZN' },
  lockedFields: [],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const STORED: Reward = {
  id: 'r1',
  projectId: 'p1',
  title: 'The lamp',
  description: null,
  price: { amount: '40.00', currency: 'AZN' },
  estimatedDelivery: null,
  limitQuantity: null,
  claimedQuantity: 3,
  reservedQuantity: 0,
  remainingQuantity: null,
  shippingType: 'NONE',
  isEarlyBird: false,
  isFeatured: false,
  isSecret: false,
  secretToken: null,
  isAddon: false,
  sortOrder: 0,
  availableFrom: null,
  availableUntil: null,
  items: [],
  shippingRules: [],
  version: 1,
  // Launched and backed: the price is locked, the picture and the clip are not.
  pricingLocked: true,
  image: null,
  video: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(reward: Reward) {
  const onClose = jest.fn();
  await act(async () => setLocale('en'));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <IntlProvider locale="en" messages={en}>
        <RewardEditor
          visible
          project={PROJECT}
          reward={reward}
          items={[]}
          copy={COPY}
          readOnly={false}
          onClose={onClose}
          onSaved={jest.fn()}
        />
      </IntlProvider>
    </SafeAreaProvider>,
  );
  return { onClose };
}

const save = async () => {
  await fireEvent.press(screen.getByTestId('reward-editor-save'));
  await settle();
};

function pickedVideo(durationMs: number) {
  picker.__setNextResult({
    canceled: false,
    assets: [
      {
        uri: 'file:///app/cache/ImagePicker/clip.mov',
        type: 'video',
        mimeType: 'video/quicktime',
        duration: durationMs,
        fileSize: 2_000_000,
      },
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  picker.__reset();
  mockSend.mockReset();
});

describe('a reward’s picture', () => {
  it('is uploaded from the library, previewed, and sent by its id on Save — after launch too', async () => {
    picker.__setNextResult({ canceled: false, assets: [{ uri: 'file:///mug.heic', mimeType: 'image/jpeg' }] });
    imageUpload.mockResolvedValue({ mediaId: 'm1', url: 'https://cdn.example/m1.jpg', width: 1200, height: 800, blurDataUrl: '' });
    mockSend.mockImplementation(async () => ({
      ...STORED,
      image: { mediaId: 'm1', url: 'https://cdn.example/m1.jpg', width: 1200, height: 800 },
    }));
    const { onClose } = await show(STORED);
    // Only an upload: a tier names its picture by `mediaId`, which an address does not have.
    expect(screen.queryByTestId('reward-image-source-address-open')).toBeNull();

    await fireEvent.press(screen.getByTestId('reward-image-source-library'));
    await settle();
    expect(imageUpload).toHaveBeenCalledWith('file:///mug.heic', expect.anything());
    expect(screen.getByTestId('reward-image-preview')).toBeTruthy();
    expect(screen.getByText(TIER.imageUploaded)).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();

    await save();
    expect(mockSend.mock.calls).toEqual([['PATCH', '/v1/rewards/r1', { imageMediaId: 'm1' }]]);
    expect(onClose).toHaveBeenCalled();
  });

  it('is taken down with Remove, which sends null', async () => {
    mockSend.mockImplementation(async () => ({ ...STORED, image: null }));
    await show({ ...STORED, image: { mediaId: 'm0', url: 'https://cdn.example/m0.jpg', width: 900, height: 600 } });
    await fireEvent.press(screen.getByTestId('reward-image-remove'));
    expect(screen.queryByTestId('reward-image-preview')).toBeNull();
    await save();
    expect(mockSend.mock.calls).toEqual([['PATCH', '/v1/rewards/r1', { imageMediaId: null }]]);
  });
});

describe('a reward’s clip', () => {
  it('opens the picker capped at five seconds, and says the five in its hint', async () => {
    await show(STORED);
    expect(screen.getByText(TIER.video.hint.replace('{seconds}', '5'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reward-video-choose'));
    await settle();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['videos'], videoMaxDuration: 5 }),
    );
  });

  it('refuses a clip over five seconds before sending a byte, in the reward’s words', async () => {
    pickedVideo(6_200);
    await show(STORED);
    await fireEvent.press(screen.getByTestId('reward-video-choose'));
    await settle();
    expect(
      screen.getByText(TIER.video.tooLong.replace('{duration}', '0:06').replace('{seconds}', '5')),
    ).toBeTruthy();
    expect(videoUpload).not.toHaveBeenCalled();
    expect(jest.mocked(forgetPicked)).toHaveBeenCalledWith('file:///app/cache/ImagePicker/clip.mov');
  });

  it('allows the container’s half second of rounding', async () => {
    pickedVideo(5_400);
    videoUpload.mockResolvedValue({
      mediaId: 'v5',
      url: 'https://cdn.example/v5.mp4',
      posterUrl: 'https://cdn.example/v5.jpg',
      width: 1280,
      height: 720,
      durationMs: 5_400,
      blurDataUrl: '',
    });
    await show(STORED);
    await fireEvent.press(screen.getByTestId('reward-video-choose'));
    await settle();
    expect(videoUpload).toHaveBeenCalled();
  });

  it('uploads a short clip, sends it by id on Save, and takes it back out when the service measures it too long', async () => {
    pickedVideo(4_000);
    videoUpload.mockResolvedValue({
      mediaId: 'v4',
      url: 'https://cdn.example/v4.mp4',
      posterUrl: 'https://cdn.example/v4.jpg',
      width: 1280,
      height: 720,
      durationMs: 4_000,
      blurDataUrl: '',
    });
    mockSend.mockRejectedValueOnce(
      new ApiError(422, {
        status: 422,
        code: 'REWARD_VIDEO_TOO_LONG',
        detail: 'The video runs 6.1 seconds.',
        meta: { field: 'videoMediaId', durationMs: 6_100, maxDurationMs: 5_000 },
      }),
    );
    const { onClose } = await show(STORED);
    await fireEvent.press(screen.getByTestId('reward-video-choose'));
    await settle();
    expect(screen.getByTestId('reward-video-length')).toHaveTextContent('Video length: 0:04');
    expect(screen.getByText(TIER.video.set)).toBeTruthy();

    await save();
    expect(mockSend.mock.calls).toEqual([['PATCH', '/v1/rewards/r1', { videoMediaId: 'v4' }]]);
    expect(onClose).not.toHaveBeenCalled();
    // The refusal under the field, in the reward's words, and the clip out of the draft.
    expect(screen.getByTestId('reward-video-failure')).toHaveTextContent(
      TIER.video.refusedTooLong.replace('{seconds}', '5'),
      { exact: false },
    );
    expect(screen.queryByTestId('reward-video-preview')).toBeNull();
  });
});
