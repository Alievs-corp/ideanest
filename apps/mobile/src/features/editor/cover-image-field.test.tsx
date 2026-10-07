import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { IntlProvider } from 'use-intl';
import type { CoverImage } from '@ideanest/campaign-editor/contract';
import en from '@ideanest/messages/en.json';
import { setLocale } from '../../lib/locale';
import { UploadFailed, uploadImage, type UploadOptions } from '../../lib/media/upload';
import { CoverImageField } from './cover-image-field';
import { editorTranslators } from './translator';
import { coverImageCopyFrom } from '@ideanest/campaign-editor/copy';

/*
 * The upload itself — the presigned PUT with no `Authorization`, the poll — is `lib/media/upload.ts`'s
 * and is tested there (`upload.test.ts`). Here it is a stand-in that walks the stages the test asks
 * for, so this file tests what the FIELD does with them.
 */
jest.mock('../../lib/media/upload', () => {
  const actual = jest.requireActual('../../lib/media/upload');
  return { ...actual, uploadImage: jest.fn() };
});

jest.setTimeout(30_000);

const picker = ImagePicker as unknown as typeof ImagePicker & {
  __setNextResult: (result: Record<string, unknown>) => void;
  __reset: () => void;
};
const upload = jest.mocked(uploadImage);
const COPY = coverImageCopyFrom(editorTranslators('en').t);
const COVER = en.campaignEditor.cover;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(cover: CoverImage | null = null) {
  const onAccept = jest.fn();
  const onRemove = jest.fn();
  await act(async () => setLocale('en'));
  await render(
    <IntlProvider locale="en" messages={en}>
      <CoverImageField copy={COPY} cover={cover} onAccept={onAccept} onRemove={onRemove} />
    </IntlProvider>,
  );
  return { onAccept, onRemove };
}

function picked() {
  picker.__setNextResult({ canceled: false, assets: [{ uri: 'file:///photo.heic', mimeType: 'image/jpeg', fileSize: 1000 }] });
}

beforeEach(() => {
  jest.clearAllMocks();
  picker.__reset();
});

describe('CoverImageField', () => {
  it('shows the cover in 16:9 with its size, and removes it', async () => {
    const { onRemove } = await show({ url: 'https://cdn/c.jpg', width: 1600, height: 900, mediaId: 'm1' });
    expect(screen.getByTestId('cover-size')).toHaveTextContent('Cover is 1600×900 pixels · uploaded');
    await fireEvent.press(screen.getByLabelText(COVER.remove));
    expect(onRemove).toHaveBeenCalled();
  });

  it('says a typed address is not an upload', async () => {
    await show({ url: 'https://example.com/c.jpg', width: 1600, height: 900, mediaId: null });
    expect(screen.getByTestId('cover-size')).toHaveTextContent('Cover is 1600×900 pixels');
  });

  it('uploads from the library, saying each stage, and sets the cover from the upload', async () => {
    let resolveUpload: () => void = () => {};
    let stage: UploadOptions['onStage'];
    upload.mockImplementation(
      (_uri, options) =>
        new Promise((resolve) => {
          stage = options?.onStage;
          resolveUpload = () =>
            resolve({ mediaId: 'm9', url: 'https://cdn/m9.jpg', width: 1600, height: 900, blurDataUrl: '' });
        }),
    );
    picked();
    const { onAccept } = await show();

    await fireEvent.press(screen.getByLabelText(en.mobile.editor.image.library));
    await settle();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(upload).toHaveBeenCalledWith('file:///photo.heic', expect.anything());

    for (const step of ['preparing', 'uploading', 'processing'] as const) {
      await act(async () => stage?.(step));
      expect(screen.getByText(COVER.stage[step])).toBeTruthy();
    }

    await act(async () => resolveUpload());
    await settle();
    expect(onAccept).toHaveBeenCalledWith({ url: 'https://cdn/m9.jpg', width: 1600, height: 900, mediaId: 'm9' });
    expect(screen.getByText('Cover set from a 1600×900 pixel image.')).toBeTruthy();
  });

  it('accepts a cover under 1024×576 and says it will look soft', async () => {
    upload.mockResolvedValueOnce({ mediaId: 'm2', url: 'https://cdn/m2.jpg', width: 800, height: 600, blurDataUrl: '' });
    picked();
    const { onAccept } = await show();
    await fireEvent.press(screen.getByLabelText(en.mobile.editor.image.camera));
    await settle();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600, mediaId: 'm2' }));
    expect(screen.getByText(COVER.softTitle)).toBeTruthy();
  });

  it.each([
    ['TOO_LARGE', COVER.failures.TOO_LARGE],
    ['UPLOAD_TRANSFER_FAILED', COVER.failures.UPLOAD_TRANSFER_FAILED],
    ['UNREADABLE', COVER.failures.UNREADABLE],
    ['TOO_SMALL', COVER.failures.TOO_SMALL.replace('{minimum}', '1024×576')],
  ])('words a refused upload by its code: %s', async (code, words) => {
    upload.mockRejectedValueOnce(new UploadFailed(code));
    picked();
    const { onAccept } = await show();
    await fireEvent.press(screen.getByLabelText(en.mobile.editor.image.library));
    await settle();
    expect(screen.getByText(COVER.notUsedTitle)).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('says the camera was refused, and takes nothing', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      status: ImagePicker.PermissionStatus.DENIED,
      expires: 'never',
    });
    await show();
    await fireEvent.press(screen.getByLabelText(en.mobile.editor.image.camera));
    await settle();
    expect(screen.getByText(en.mobile.kitForm.filePicker.cameraRefused)).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('measures a typed address and sets it with no upload behind it', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_url, success) => success(1920, 1080));
    const { onAccept } = await show();
    await fireEvent.press(screen.getByLabelText(en.mobile.editor.image.address));
    await fireEvent.changeText(screen.getByTestId('cover-source-address'), ' https://example.com/c.jpg ');
    await fireEvent.press(screen.getByLabelText(COVER.useAddress));
    await settle();
    expect(onAccept).toHaveBeenCalledWith({ url: 'https://example.com/c.jpg', width: 1920, height: 1080, mediaId: null });
    expect(upload).not.toHaveBeenCalled();
  });

  it('asks for an address first, and says when one cannot be used', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_url, _success, failure) => failure?.(new Error('404')));
    await show();
    await fireEvent.press(screen.getByLabelText(en.mobile.editor.image.address));
    await fireEvent.press(screen.getByLabelText(COVER.useAddress));
    await settle();
    expect(screen.getByText(COVER.needUrlFirst)).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('cover-source-address'), 'https://example.com/missing.jpg');
    await fireEvent.press(screen.getByLabelText(COVER.useAddress));
    await settle();
    expect(screen.getByText(COVER.unusable)).toBeTruthy();
  });

  it('accepts only a web address', async () => {
    const getSize = jest.spyOn(Image, 'getSize');
    const { onAccept } = await show();
    await fireEvent.press(screen.getByLabelText(en.mobile.editor.image.address));
    for (const address of ['file:///photo.jpg', 'data:image/png;base64,AAAA', 'ftp://example.com/c.jpg']) {
      await fireEvent.changeText(screen.getByTestId('cover-source-address'), address);
      await fireEvent.press(screen.getByLabelText(COVER.useAddress));
      await settle();
      expect(screen.getByText(COVER.unusable)).toBeTruthy();
    }
    expect(getSize).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
