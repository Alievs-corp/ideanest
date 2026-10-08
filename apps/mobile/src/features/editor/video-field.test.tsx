import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { IntlProvider } from 'use-intl';
import type { CampaignVideo } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../lib/locale';
import {
  UploadFailed,
  forgetPicked,
  resumeVideo,
  uploadVideo,
  type UploadedVideo,
  type VideoUploadOptions as UploadOptions,
} from '../../lib/media/upload';
import { VIDEO_PICKER_OPTIONS, useVideoUpload, videoRefusalOf, type VideoUploadOptions } from './use-video-upload';
import { VideoField } from './video-field';

/*
 * The upload itself — the declared video type, the presigned PUT, the 5-minute poll — is
 * `lib/media/upload.ts`'s and is tested in `upload-video.test.ts`. Here it is a stand-in that walks
 * the stages the test asks for, so this file tests what `useVideoUpload` and the field do with
 * them. The editor's half (the autosave, the tab switch) is in `basics-panel.test.tsx`.
 */
jest.mock('../../lib/media/upload', () => {
  const actual = jest.requireActual('../../lib/media/upload');
  return { ...actual, uploadVideo: jest.fn(), resumeVideo: jest.fn(), forgetPicked: jest.fn() };
});

jest.setTimeout(30_000);

const picker = ImagePicker as unknown as typeof ImagePicker & {
  __setNextResult: (result: Record<string, unknown>) => void;
  __reset: () => void;
};
const upload = jest.mocked(uploadVideo);
const resume = jest.mocked(resumeVideo);
const forgetFile = jest.mocked(forgetPicked);
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

const UPLOADED: UploadedVideo = {
  mediaId: 'v9',
  url: 'https://cdn/v9.mp4',
  posterUrl: 'https://cdn/v9.jpg',
  width: 1280,
  height: 720,
  durationMs: 30_000,
  blurDataUrl: '',
};

const save = jest.fn();
const forget = jest.fn();

function Harness({ disabled, ...options }: Partial<VideoUploadOptions> & { readonly disabled?: boolean }) {
  const state = useVideoUpload({ saved: null, save, refusal: null, forget, pending: false, ...options });
  return <VideoField upload={state} disabled={disabled ?? false} />;
}

function tree(props: Partial<VideoUploadOptions> & { readonly disabled?: boolean } = {}) {
  return (
    <IntlProvider locale="en" messages={en}>
      <Harness {...props} />
    </IntlProvider>
  );
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(props: Partial<VideoUploadOptions> & { readonly disabled?: boolean } = {}) {
  await act(async () => setLocale('en'));
  return await render(tree(props));
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

async function choose(label: string = COPY.choose) {
  await fireEvent.press(screen.getByLabelText(label));
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
    await show();
    await choose();
    expect(screen.getByText(COPY.notUsedTitle)).toBeTruthy();
    expect(screen.getByText(COPY.failures.TOO_LONG)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(forgetFile).toHaveBeenCalledWith('file:///app/cache/ImagePicker/clip.mov');
    expect(save).not.toHaveBeenCalled();
  });

  it('takes a clip half a second over the minute: the container runs long, the service decides', async () => {
    picked({ duration: 60_400 });
    upload.mockReturnValueOnce(new Promise(() => {}));
    await show();
    await choose();
    expect(upload).toHaveBeenCalled();
  });

  it('refuses a file over 250 MB before sending a byte, and says to trim it in the gallery first', async () => {
    picked({ fileSize: 250 * 1024 * 1024 + 1 });
    await show();
    await choose();
    expect(screen.getByText(COPY.failures.TOO_LARGE)).toBeTruthy();
    expect(COPY.failures.TOO_LARGE).toMatch(/gallery/u);
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads, saying how much is sent and to keep the app open, and attaches the READY video', async () => {
    let options: UploadOptions | undefined;
    let finish: () => void = () => {};
    upload.mockImplementation(
      (_uri, given) =>
        new Promise((resolve) => {
          options = given;
          finish = () => resolve(UPLOADED);
        }),
    );
    picked();
    await show();
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
    expect(screen.getByText('Uploading the video… 42%. Keep the app open until it is done.')).toBeTruthy();
    await act(async () => options?.onStage?.('processing'));
    expect(screen.getByText(COPY.stage.processing)).toBeTruthy();

    await act(async () => finish());
    await settle();
    expect(save).toHaveBeenCalledWith({ videoMediaId: 'v9' });
    // Shown at once, before the save has answered.
    expect(screen.getByTestId('video-length')).toHaveTextContent('Video length: 0:30');
    expect(screen.getByText(COPY.set)).toBeTruthy();
    expect(screen.queryByTestId('video-stage')).toBeNull();
    expect(forgetFile).toHaveBeenCalledWith('file:///app/cache/ImagePicker/clip.mov');
  });

  it.each([
    ['TOO_LONG', COPY.failures.TOO_LONG],
    ['UNSUPPORTED_FORMAT', COPY.failures.UNSUPPORTED_FORMAT],
    ['UPLOADS_UNAVAILABLE', COPY.failures.UPLOADS_UNAVAILABLE],
    ['UPLOAD_TRANSFER_FAILED', COPY.failures.UPLOAD_TRANSFER_FAILED],
  ])('words a refused upload by its code: %s', async (code, words) => {
    upload.mockRejectedValueOnce(new UploadFailed(code));
    picked();
    await show();
    await choose();
    expect(screen.getByText(COPY.notUsedTitle)).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByLabelText(COPY.checkAgain)).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(forgetFile).toHaveBeenCalled();
  });

  it('keeps an upload whose processing outlived the wait, and checks the same upload again', async () => {
    upload.mockRejectedValueOnce(new UploadFailed('UPLOAD_STILL_PROCESSING', '', 'v9'));
    resume.mockRejectedValueOnce(new UploadFailed('UPLOAD_STILL_PROCESSING', '', 'v9'));
    resume.mockResolvedValueOnce(UPLOADED);
    picked();
    await show();
    await choose();
    expect(screen.getByText(COPY.failures.UPLOAD_STILL_PROCESSING)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText(COPY.checkAgain));
    await settle();
    expect(resume).toHaveBeenLastCalledWith('v9', expect.anything());
    expect(screen.getByLabelText(COPY.checkAgain)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(COPY.checkAgain));
    await settle();
    expect(resume).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith({ videoMediaId: 'v9' });
    expect(screen.queryByTestId('video-failure')).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
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

  it('shows the saved video with its length, and removing it saves null', async () => {
    await show({ saved: VIDEO });
    expect(screen.getByTestId('video-length')).toHaveTextContent('Video length: 0:45');
    expect(screen.getByLabelText(COPY.replace)).toBeTruthy();
    expect(screen.queryByLabelText(COPY.choose)).toBeNull();
    await fireEvent.press(screen.getByLabelText(COPY.remove));
    expect(save).toHaveBeenCalledWith({ videoMediaId: null });
    expect(screen.queryByTestId('video-preview')).toBeNull();
  });

  it('a refused id is forgotten, the saved video comes back, and the service says why', async () => {
    upload.mockResolvedValueOnce(UPLOADED);
    picked();
    const view = await show({ saved: VIDEO });
    await choose(COPY.replace);
    expect(screen.getByTestId('video-length')).toHaveTextContent('Video length: 0:30');

    await view.rerender(tree({ saved: VIDEO, pending: true, refusal: 'That video is not available.' }));
    await settle();
    expect(forget).toHaveBeenCalledTimes(1);
    expect(screen.getByText('That video is not available.')).toBeTruthy();
    expect(screen.getByTestId('video-length')).toHaveTextContent('Video length: 0:45');
  });

  it('disabled, offers nothing', async () => {
    await show({ saved: VIDEO, disabled: true });
    await fireEvent.press(screen.getByLabelText(COPY.replace));
    await fireEvent.press(screen.getByLabelText(COPY.remove));
    await settle();
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('videoRefusalOf', () => {
  const failure = (extra: Record<string, unknown>) => ({
    message: 'That video is not available.',
    fieldErrors: {},
    status: 400,
    code: null,
    meta: null,
    ...extra,
  });

  it("reads the service's PROJECT_FIELD_INVALID on videoMediaId, and a listed field error", () => {
    expect(videoRefusalOf(failure({ code: 'PROJECT_FIELD_INVALID', meta: { field: 'videoMediaId' } }))).toBe(
      'That video is not available.',
    );
    expect(videoRefusalOf(failure({ fieldErrors: { videoMediaId: 'Not a video.' } }))).toBe('Not a video.');
  });

  it('is null for anything else', () => {
    expect(videoRefusalOf(null)).toBeNull();
    expect(videoRefusalOf(failure({ code: 'PROJECT_FIELD_INVALID', meta: { field: 'title' } }))).toBeNull();
    expect(videoRefusalOf(failure({ status: 500 }))).toBeNull();
  });
});
