import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
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
    <Field label="Cover image" grouped>
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
  await fireEvent.press(tree.getByRole('button', { name: 'Cover image' }));
  await fireEvent.press(tree.getByRole('button', { name: en.mobile.kitForm.filePicker.library }));
}

describe('FilePicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    picker.__reset();
  });

  it('is one button named by its field, with its constraint line as the hint', async () => {
    const { getByRole } = await renderEn(cover());
    const zone = getByRole('button', { name: 'Cover image' });
    expect(zone.props.accessibilityHint).toBe('Up to 20 MB.');
  });

  it('draws the web zone: dashed strong border, radius 20, surface-2', async () => {
    const { getByRole } = await renderEn(cover());
    const zone = getByRole('button', { name: 'Cover image' });
    const { style: raw } = zone.props as { style?: unknown };
    const style = StyleSheet.flatten(typeof raw === 'function' ? raw({ pressed: false }) : raw);
    expect(style).toMatchObject({
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
      borderRadius: radius.lg,
      backgroundColor: colors.surface2,
    });
  });

  it('offers the photo library and the camera in a sheet', async () => {
    const { getByRole } = await renderEn(cover());
    await fireEvent.press(getByRole('button', { name: 'Cover image' }));
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
    expect(await tree.findByText(sentence)).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
    expect(announced).toHaveBeenCalledWith(sentence, { queue: false });
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
    expect(await tree.findByText(en.campaignEditor.cover.failures.TOO_LARGE)).toBeTruthy();
  });

  it('refuses a type the caller does not accept', async () => {
    picker.__setNextResult({
      canceled: false,
      assets: [{ uri: 'file:///clip.gif', mimeType: 'image/gif', fileSize: 1000 }],
    });
    const onPick = jest.fn();
    const tree = await renderEn(cover(onPick));
    await chooseFromLibrary(tree);
    expect(await tree.findByText(en.mobile.kitForm.filePicker.wrongType)).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
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

  it('says where to allow the camera when permission is refused, and does not open it', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      status: ImagePicker.PermissionStatus?.DENIED ?? 'denied',
      canAskAgain: false,
      expires: 'never',
    } as Awaited<ReturnType<typeof ImagePicker.requestCameraPermissionsAsync>>);
    const onPick = jest.fn();
    const tree = await renderEn(cover(onPick));
    await fireEvent.press(tree.getByRole('button', { name: 'Cover image' }));
    await fireEvent.press(tree.getByRole('button', { name: en.mobile.kitForm.filePicker.camera }));

    expect(await tree.findByText(en.mobile.kitForm.filePicker.cameraDenied)).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('does not open while disabled', async () => {
    const tree = await renderEn(cover(jest.fn(), { disabled: true }));
    await fireEvent.press(tree.getByRole('button', { name: 'Cover image' }));
    expect(tree.queryByRole('button', { name: en.mobile.kitForm.filePicker.library })).toBeNull();
    expect(
      tree.getByRole('button', { name: 'Cover image' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });
});
