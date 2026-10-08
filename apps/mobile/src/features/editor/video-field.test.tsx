import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { IntlProvider } from 'use-intl';
import type { CampaignVideo } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../lib/locale';
import {
  UploadFailed,
  forgetPicked,
  uploadVideo,
  type VideoUploadOptions,
} from '../../lib/media/upload';
import { VIDEO_PICKER_OPTIONS, VideoField } from './video-field';

/*
 * The upload itself — the declared video type, the presigned PUT, the 5-minute poll — is
 * `lib/media/upload.ts`'s and is tested in `upload-video.test.ts`. Here it is a stand-in that walks
 * the stages the test asks for, so this file tests what the FIELD does with them.
 */
jest.mock('../../lib/media/upload', () => {
  const actual = jest.requireActual('../../lib/media/upload');
  return { ...actual, uploadVideo: jest.fn(), forgetPicked: jest.fn() };
});

jest.setTimeout(30_000);

const picker = ImagePicker as unknown as typeof ImagePicker & {
  __setNextResult: (result: Record<string, unknown>) => void;
  __reset: () => void;
};
const upload = jest.mocked(uploadVideo);
const forget = jest.mocked(forgetPicked);
const COPY = en.mobile.editor.video;

const VIDEO: CampaignVideo = {
  mediaId: 'v1',
  url: 'https://cdn/v1.mp4',
  posterUrl: 'https://cdn/v1.jpg',
  width: 1280,
  height: 720,
  durationMs: 45_200,
  blurDataUrl: null,
};

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(video: CampaignVideo | null = null) {
  const onAccept = jest.fn();
  const onRemove = jest.fn();
  await act(async () => setLocale('en'));
  await render(
    <IntlProvider locale="en" messages={en}>
      <VideoField video={video} onAccept={onAccept} onRemove={onRemove} />
    </IntlProvider>,
  );
  return { onAccept, onRemove };
}

function picked(asset: Record<string, unknown> = {}) {
  picker.__setNextResult({
    canceled: false,
    assets: [
      {
        uri: 'file:///app/cache/ImagePicker/clip.mov',
        type: 'video',
        mimeType: 'video/quicktime',
        duration: 45_200,
        fileSize: 12_000_000,
        ...asset,
      },
    ],
  });
}

async function choose() {
  await fireEvent.press(screen.getByLabelText(COPY.choose));
  await settle();
}

beforeEach(() => {
  jest.clearAllMocks();
  picker.__reset();
});

describe('VideoField', () => {
  it('opens the library for videos only, trimmed to a minute and exported at 720p on iOS', async () => {
    await show();
    await choose();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(VIDEO_PICKER_OPTIONS);
    expect(VIDEO_PICKER_OPTIONS).toEqual({
      mediaTypes: ['videos'],
      allowsEditing: true,
      videoMaxDuration: 60,
      videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
    });
    // Cancelled: nothing uploads, nothing is said.
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByTestId('video-failure')).toBeNull();
  });

  it('refuses a clip over a minute before sending a byte, and removes the picked copy', async () => {
    picked({ duration: 61_000 });
    const { onAccept } = await show();
    await choose();
    expect(screen.getByText(COPY.notUsedTitle)).toBeTruthy();
    expect(screen.getByText(COPY.failures.TOO_LONG)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(forget).toHaveBeenCalledWith('file:///app/cache/ImagePicker/clip.mov');
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('takes a clip half a second over the minute: the container runs long, the service decides', async () => {
    picked({ duration: 60_400 });
    upload.mockReturnValueOnce(new Promise(() => {}));
    await show();
    await choose();
    expect(upload).toHaveBeenCalled();
  });

  it('refuses a file over 250 MB before sending a byte', async () => {
    picked({ fileSize: 250 * 1024 * 1024 + 1 });
    await show();
    await choose();
    expect(screen.getByText(COPY.failures.TOO_LARGE)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads, saying how much is sent and then that it is processing, and accepts the READY video', async () => {
    let options: VideoUploadOptions | undefined;
    let finish: () => void = () => {};
    upload.mockImplementation(
      (_uri, given) =>
        new Promise((resolve) => {
          options = given;
          finish = () =>
            resolve({
              mediaId: 'v9',
              url: 'https://cdn/v9.mp4',
              posterUrl: 'https://cdn/v9.jpg',
              width: 1280,
              height: 720,
              durationMs: 30_000,
              blurDataUrl: '',
            });
        }),
    );
    picked();
    const { onAccept } = await show();
    await choose();

    expect(upload).toHaveBeenCalledWith(
      'file:///app/cache/ImagePicker/clip.mov',
      expect.objectContaining({ mimeType: 'video/quicktime' }),
    );
    expect(screen.getByLabelText(COPY.choose).props.accessibilityState).toMatchObject({ disabled: true });

    await act(async () => options?.onStage?.('preparing'));
    expect(screen.getByText(COPY.stage.preparing)).toBeTruthy();
    await act(async () => {
      options?.onStage?.('uploading');
      options?.onProgress?.(0.426);
    });
    expect(screen.getByText('Uploading the video… 42%')).toBeTruthy();
    await act(async () => options?.onStage?.('processing'));
    expect(screen.getByText(COPY.stage.processing)).toBeTruthy();

    await act(async () => finish());
    await settle();
    expect(onAccept).toHaveBeenCalledWith({
      mediaId: 'v9',
      url: 'https://cdn/v9.mp4',
      posterUrl: 'https://cdn/v9.jpg',
      width: 1280,
      height: 720,
      durationMs: 30_000,
      blurDataUrl: null,
    });
    expect(screen.queryByTestId('video-stage')).toBeNull();
    expect(forget).toHaveBeenCalledWith('file:///app/cache/ImagePicker/clip.mov');
  });

  it.each([
    ['TOO_LONG', COPY.failures.TOO_LONG],
    ['UNSUPPORTED_FORMAT', COPY.failures.UNSUPPORTED_FORMAT],
    ['UPLOAD_STILL_PROCESSING', COPY.failures.UPLOAD_STILL_PROCESSING],
    ['UPLOADS_UNAVAILABLE', COPY.failures.UPLOADS_UNAVAILABLE],
    ['UPLOAD_TRANSFER_FAILED', COPY.failures.UPLOAD_TRANSFER_FAILED],
  ])('words a refused upload by its code: %s', async (code, words) => {
    upload.mockRejectedValueOnce(new UploadFailed(code));
    picked();
    const { onAccept } = await show();
    await choose();
    expect(screen.getByText(COPY.notUsedTitle)).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();
    expect(forget).toHaveBeenCalled();
  });

  it("uses the service's own sentence for a code it has no words for, and 'unusable' otherwise", async () => {
    upload.mockRejectedValueOnce(new UploadFailed('SOMETHING_NEW', 'The service says no.'));
    picked();
    await show();
    await choose();
    expect(screen.getByText('The service says no.')).toBeTruthy();

    upload.mockRejectedValueOnce(new Error('boom'));
    picked();
    await choose();
    expect(screen.getByText(COPY.unusable)).toBeTruthy();
  });

  it('says the library could not be opened', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValueOnce(new Error('no'));
    await show();
    await choose();
    expect(screen.getByText(COPY.openFailed)).toBeTruthy();
  });

  it('shows the video with its length, and offers to replace or remove it', async () => {
    const { onRemove } = await show(VIDEO);
    expect(screen.getByTestId('video-length')).toHaveTextContent('Video length: 0:45');
    expect(screen.getByLabelText(COPY.replace)).toBeTruthy();
    expect(screen.queryByLabelText(COPY.choose)).toBeNull();
    await fireEvent.press(screen.getByLabelText(COPY.remove));
    expect(onRemove).toHaveBeenCalled();
  });

  it('disabled, offers nothing', async () => {
    const onRemove = jest.fn();
    await act(async () => setLocale('en'));
    await render(
      <IntlProvider locale="en" messages={en}>
        <VideoField video={VIDEO} disabled onAccept={jest.fn()} onRemove={onRemove} />
      </IntlProvider>,
    );
    await fireEvent.press(screen.getByLabelText(COPY.replace));
    await fireEvent.press(screen.getByLabelText(COPY.remove));
    await settle();
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
