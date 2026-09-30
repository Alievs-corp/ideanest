import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import { colors, radius } from '../../theme';
import { Field } from './field';
import { FilePicker } from './file-picker';

/**
 * The picker returns a local asset or a sentence saying why not, and never a file the caller's
 * limits refuse. `expo-image-picker` is `jest.setup.ts`'s mock: cancelled unless a test sets
 * the next result.
 */

const picker = ImagePicker as typeof ImagePicker & {
  __setNextResult(result: Record<string, unknown>): void;
  __reset(): void;
};

function English({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

const renderEn = (ui: ReactElement) => render(ui, { wrapper: English });

const MAX = 20 * 1024 * 1024;

function cover(onPick = jest.fn(), extra: Partial<Parameters<typeof FilePicker>[0]> = {}) {
  return (
    <Field label="Cover image" required>
      <FilePicker
        onPick={onPick}
        hint="Up to 20 MB."
        maxBytes={MAX}
        acceptedTypes={['image/jpeg', 'image/png']}
        {...extra}
      />
    </Field>
  );
}

async function chooseFromLibrary(tree: Awaited<ReturnType<typeof renderEn>>) {
  await fireEvent.press(tree.getByRole('button', { name: ZONE }));
  await fireEvent.press(tree.getByRole('button', { name: en.mobile.kitForm.filePicker.library }));
}

const ZONE = 'Cover image, required';

type Options = NonNullable<Parameters<typeof ImagePicker.launchImageLibraryAsync>[0]>;

describe('FilePicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    picker.__reset();
  });

  it('is one button named by its field, with its constraint line as the hint', async () => {
    const { getByRole } = await renderEn(cover());
    const zone = getByRole('button', { name: ZONE });
    expect(zone.props.accessibilityHint).toBe('Up to 20 MB.');
  });

  it('draws the web zone: dashed strong border, radius 20, surface-2', async () => {
    const { getByRole } = await renderEn(cover());
    const zone = getByRole('button', { name: ZONE });
    const { style: raw } = zone.props as { style?: unknown };
    const style = StyleSheet.flatten(typeof raw === 'function' ? raw({ pressed: false }) : raw);
    expect(style).toMatchObject({
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
      borderRadius: radius.lg,
      backgroundColor: colors.surface2,
    });
  });

  it('offers the photo library and the camera in a sheet titled with the plain label', async () => {
    const dismissed = jest.spyOn(Keyboard, 'dismiss');
    const { getByRole, queryByRole } = await renderEn(cover());
    await fireEvent.press(getByRole('button', { name: ZONE }));
    expect(dismissed).toHaveBeenCalled();
    expect(getByRole('header', { name: 'Cover image' })).toBeTruthy();
    expect(queryByRole('header', { name: ZONE })).toBeNull();
    expect(getByRole('button', { name: en.mobile.kitForm.filePicker.library })).toBeTruthy();
    expect(getByRole('button', { name: en.mobile.kitForm.filePicker.camera })).toBeTruthy();
  });

  it('returns the chosen picture as a local asset', async () => {
    picker.__setNextResult({
      canceled: false,
      assets: [{ uri: 'file:///cover.jpg', mimeType: 'image/jpeg', fileSize: 1_500_000 }],
    });
    const onPick = jest.fn();
    const tree = await renderEn(cover(onPick));
    await chooseFromLibrary(tree);

    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith({
        uri: 'file:///cover.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1_500_000,
      }),
    );
    // The sheet has gone.
    expect(tree.queryByRole('button', { name: en.mobile.kitForm.filePicker.library })).toBeNull();
  });

  it('refuses a picture over the size limit, says why, and does not return it', async () => {
    const announced = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    picker.__setNextResult({
      canceled: false,
      assets: [{ uri: 'file:///huge.jpg', mimeType: 'image/jpeg', fileSize: MAX + 1 }],
    });
    const onPick = jest.fn();
    const tree = await renderEn(cover(onPick));
    await chooseFromLibrary(tree);

    const sentence = 'That picture is too large. The limit is 20 MB.';
    expect(await tree.findByText(sentence, { includeHiddenElements: true })).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
    /*
     * Not announced — focus returns to the zone as the sheet closes and would cut it off — but
     * the zone's value, so it is read when focus lands there and every time after.
     */
    expect(announced).not.toHaveBeenCalled();
    expect(tree.getByRole('button', { name: ZONE }).props.accessibilityValue).toEqual({
      text: sentence,
    });
  });

  it('uses the owning screen’s sentence when it passes one', async () => {
    picker.__setNextResult({
      canceled: false,
      assets: [{ uri: 'file:///huge.jpg', mimeType: 'image/jpeg', fileSize: MAX + 1 }],
    });
    const tree = await renderEn(
      cover(jest.fn(), { messages: { tooLarge: en.campaignEditor.cover.failures.TOO_LARGE } }),
    );
    await chooseFromLibrary(tree);
    expect(
      await tree.findByText(en.campaignEditor.cover.failures.TOO_LARGE, {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
  });

  it('refuses a type the caller does not accept', async () => {
    picker.__setNextResult({
      canceled: false,
      assets: [{ uri: 'file:///clip.gif', mimeType: 'image/gif', fileSize: 1000 }],
    });
    const onPick = jest.fn();
    const tree = await renderEn(cover(onPick));
    await chooseFromLibrary(tree);
    expect(
      await tree.findByText(en.mobile.kitForm.filePicker.wrongType, {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('accepts a wildcard type, so image/* takes an iPhone’s HEIC', async () => {
    picker.__setNextResult({
      canceled: false,
      assets: [{ uri: 'file:///photo.heic', mimeType: 'image/heic', fileSize: 1000 }],
    });
    const onPick = jest.fn();
    const tree = await renderEn(cover(onPick, { acceptedTypes: ['image/*'] }));
    await chooseFromLibrary(tree);
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith({
        uri: 'file:///photo.heic',
        mimeType: 'image/heic',
        fileSize: 1000,
      }),
    );
  });

  it('asks the library for images only, and for its most compatible representation', async () => {
    const tree = await renderEn(cover());
    await chooseFromLibrary(tree);
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1));
    const [options] = jest.mocked(ImagePicker.launchImageLibraryAsync).mock.calls[0] ?? [];
    expect(options).toMatchObject({ mediaTypes: 'images' });
    expect(options).toHaveProperty('preferredAssetRepresentationMode');
    // `Compatible` is what makes iOS transcode a HEIC library photo to JPEG.
    expect((options as Options).preferredAssetRepresentationMode).toBe('compatible');
  });

  it('returns nothing, and says nothing, when the picker is cancelled', async () => {
    const announced = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    const onPick = jest.fn();
    const tree = await renderEn(cover(onPick));
    await chooseFromLibrary(tree);
    await waitFor(() =>
      expect(tree.queryByRole('button', { name: en.mobile.kitForm.filePicker.library })).toBeNull(),
    );
    expect(onPick).not.toHaveBeenCalled();
    expect(announced).not.toHaveBeenCalled();
  });

  it('says nothing was taken when the camera is refused but may be asked for again', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      status: ImagePicker.PermissionStatus.DENIED,
      canAskAgain: true,
      expires: 'never',
    });
    const tree = await renderEn(cover());
    await fireEvent.press(tree.getByRole('button', { name: ZONE }));
    await fireEvent.press(tree.getByRole('button', { name: en.mobile.kitForm.filePicker.camera }));

    expect(
      await tree.findByText(en.mobile.kitForm.filePicker.cameraRefused, {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('says where to allow the camera when it is refused for good, and does not open it', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      status: ImagePicker.PermissionStatus.DENIED,
      canAskAgain: false,
      expires: 'never',
    });
    const onPick = jest.fn();
    const tree = await renderEn(cover(onPick));
    await fireEvent.press(tree.getByRole('button', { name: ZONE }));
    await fireEvent.press(tree.getByRole('button', { name: en.mobile.kitForm.filePicker.camera }));

    expect(
      await tree.findByText(en.mobile.kitForm.filePicker.cameraDenied, {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('does not open while disabled', async () => {
    const tree = await renderEn(cover(jest.fn(), { disabled: true }));
    await fireEvent.press(tree.getByRole('button', { name: ZONE }));
    expect(tree.queryByRole('button', { name: en.mobile.kitForm.filePicker.library })).toBeNull();
    expect(tree.getByRole('button', { name: ZONE }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
