import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Glyphs } from '../../icons';
import { useLocale } from 'use-intl';
import { formatCount, useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, size as measure, spacing } from '../../theme';
import { useFieldControl } from './field';
import { useFocusRing } from './focus';
import { Icon } from './icon';
import { Sheet } from './sheet';

/**
 * Choose a picture from the phone — the native `FileDropZone` (`docs/ui-kit.md` §7.13).
 *
 * <h2>The web's zone, without the drag</h2>
 *
 * A dashed `--border-strong` outline, radius 20, `--surface-2`, an Upload icon, a prompt, a
 * "choose" pill and the constraint line. There is nothing to drag a file from on a phone, so the
 * drag state is gone and the whole zone is the button — one stop for a screen reader, named by
 * the surrounding `Field` (or `label`), with the constraint line as its hint.
 *
 * <h2>Two sources</h2>
 *
 * Pressing opens a `Sheet` with the photo library and the camera (§4.12 MB-06), through
 * `expo-image-picker`. The result is a LOCAL asset — `{ uri, mimeType, fileSize }` — handed to
 * `onPick`. Uploading it belongs to the screen that owns it, as it does on the web.
 *
 * <h2>Refused before it is returned</h2>
 *
 * The caller's `maxBytes` and `acceptedTypes` are checked here, before `onPick` is called, so a
 * 40 MB photo is refused on the phone with a sentence rather than after a minute of uploading.
 * The sentences are the caller's when it passes them (the web's owning screens have their own:
 * `campaignEditor.cover.failures.TOO_LARGE`), and the catalogue's otherwise.
 *
 * <p>A refusal is drawn under the zone in danger with an icon, and it becomes the zone's
 * `accessibilityValue` while it stands. It is NOT announced: every refusal happens in the sheet,
 * and closing the sheet moves screen-reader focus back to the zone a moment later, which would
 * cut an announcement off mid-sentence. Landing on the zone reads "Cover image, That picture is
 * too large…, button" instead — the refusal arrives with the focus rather than racing it, and is
 * still there the next time somebody swipes past.
 *
 * <h2>Types, and the iPhone's HEIC</h2>
 *
 * An iPhone stores photos as HEIC, and the library hands them over as `image/heic` unless asked
 * otherwise, which an allow-list of JPEG and PNG would refuse for most of the photos on the
 * phone. So the library is asked for its most compatible representation
 * (`UIImagePickerPreferredAssetRepresentationMode.Compatible`, which transcodes to JPEG), and an
 * accepted type may be a wildcard — `['image/*']` accepts any image.
 *
 * <h2>Permission</h2>
 *
 * The camera needs a permission and asks for it. Refused with the system still willing to ask
 * again, the sentence says nothing was taken; refused for good (`canAskAgain` false), it says
 * where in the phone's settings to change it — sending somebody to Settings for a prompt they
 * would simply get again is a detour. The library needs no permission — both platforms' photo
 * pickers run outside the app — so it does not ask for access to every photo on the phone to let
 * somebody choose one.
 *
 * <p>A picker the platform returns with no size or no type cannot be checked for that limit; it
 * is passed on, and the server's own check is what refuses it.
 *
 * <p>Not handled here: Android can destroy the activity while the system picker is open, and
 * `ImagePicker.getPendingResultAsync()` recovers that result on the next launch. The recovered
 * asset carries nothing saying which picker asked for it, and after a restart there may be none
 * on screen or a different one, so delivering it here could attach a cover image to an avatar.
 * The screen that owns an upload, which knows what it was doing, is where that belongs.
 */

export interface PickedFile {
  readonly uri: string;
  readonly mimeType: string | null;
  readonly fileSize: number | null;
}

export interface FilePickerMessages {
  readonly tooLarge?: string;
  readonly wrongType?: string;
  /** The camera was refused for good; the sentence says where to allow it. */
  readonly cameraDenied?: string;
  /** The camera was refused this time; the system will ask again. */
  readonly cameraRefused?: string;
  readonly openFailed?: string;
}

export interface FilePickerProps {
  readonly onPick: (file: PickedFile) => void;
  /** The zone's name and the sheet's title. Optional inside a `Field`, which provides it. */
  readonly label?: string;
  /** The line under the icon. */
  readonly prompt?: string;
  /** The pill's words. */
  readonly buttonLabel?: string;
  /** The constraint line: accepted types, the size limit. Also the zone's accessibility hint. */
  readonly hint?: string;
  /** The largest file accepted, in bytes. */
  readonly maxBytes?: number;
  /**
   * MIME types accepted: exact (`'image/png'`) or a wildcard (`'image/*'`). Anything, when absent.
   * Library photos arrive as JPEG (see above), so `['image/jpeg', 'image/png']` accepts an
   * iPhone's photos too.
   */
  readonly acceptedTypes?: readonly string[];
  /** The refusals, in the words of the screen that owns the upload. */
  readonly messages?: FilePickerMessages;
  readonly disabled?: boolean;
  readonly testID?: string;
}

type Source = 'library' | 'camera';

export function FilePicker({
  onPick,
  label,
  prompt,
  buttonLabel,
  hint,
  maxBytes,
  acceptedTypes,
  messages = {},
  disabled = false,
  testID,
}: FilePickerProps) {
  const t = useT('mobile.kitForm.filePicker');
  const locale = useLocale();
  const field = useFieldControl({ accessibilityLabel: label, accessibilityHint: hint });
  const { ring, onFocus, onBlur } = useFocusRing();
  const zone = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const choose = buttonLabel ?? t('choose');
  const name = field.accessibilityLabel ?? choose;

  function refuse(message: string): void {
    setRefusal(message);
  }

  async function pick(source: Source): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setOpen(false);
          refuse(
            permission.canAskAgain === false
              ? (messages.cameraDenied ?? t('cameraDenied'))
              : (messages.cameraRefused ?? t('cameraRefused')),
          );
          return;
        }
      }

      let result: ImagePicker.ImagePickerResult;
      try {
        const options: ImagePicker.ImagePickerOptions = {
          mediaTypes: 'images',
          quality: 1,
          // iOS only, and ignored elsewhere. Read defensively: a build without the enum sends
          // nothing rather than failing to open the library.
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible,
        };
        result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync(options);
      } catch {
        setOpen(false);
        refuse(messages.openFailed ?? t('openFailed'));
        return;
      }

      setOpen(false);
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset === undefined) return;

      const mimeType = asset.mimeType ?? null;
      const fileSize = asset.fileSize ?? null;

      if (acceptedTypes !== undefined && mimeType !== null && !accepts(acceptedTypes, mimeType)) {
        refuse(messages.wrongType ?? t('wrongType'));
        return;
      }
      if (maxBytes !== undefined && fileSize !== null && fileSize > maxBytes) {
        refuse(
          messages.tooLarge ??
            t('tooLarge', { megabytes: formatCount(megabytes(maxBytes), locale) }),
        );
        return;
      }

      setRefusal(null);
      onPick({ uri: asset.uri, mimeType, fileSize });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrapper}>
      <Pressable
        ref={zone}
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityHint={field.accessibilityHint}
        accessibilityValue={refusal === null ? undefined : { text: refusal }}
        accessibilityState={{ disabled, busy }}
        disabled={disabled || busy}
        onPress={() => {
          // A keyboard left up by the previous field would cover the sheet's two choices.
          Keyboard.dismiss();
          setOpen(true);
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        testID={testID}
        style={({ pressed }) => [
          styles.zone,
          (field.invalid || refusal !== null) && styles.invalid,
          pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
          ring,
        ]}
      >
        <Icon icon={Glyphs.Export} size={20} color={colors.textTertiary} />
        <Text style={styles.prompt}>{prompt ?? t('prompt')}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillLabel}>{choose}</Text>
        </View>
        {hint !== undefined && hint !== '' ? <Text style={styles.hint}>{hint}</Text> : null}
      </Pressable>

      {refusal !== null ? (
        // Hidden: the zone's value already says it, and focus returns to the zone.
        <View
          style={styles.refusal}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.refusalIcon}>
            <Icon icon={Glyphs.Warning2} size={14} color={colors.danger} />
          </View>
          <Text style={styles.refusalText}>{refusal}</Text>
        </View>
      ) : null}

      <Sheet
        surface="dark"
        visible={open}
        onClose={() => setOpen(false)}
        // The plain label: a visible title, never "Cover image, required".
        title={field.label ?? choose}
        returnFocusTo={zone}
      >
        <SourceRow
          icon={Glyphs.Gallery}
          label={t('library')}
          onPress={() => void pick('library')}
          disabled={busy}
        />
        <SourceRow
          icon={Glyphs.Camera}
          label={t('camera')}
          onPress={() => void pick('camera')}
          disabled={busy}
        />
      </Sheet>
    </View>
  );
}

/** Whether a MIME type is on the list, where `image/*` stands for every image. */
function accepts(accepted: readonly string[], mimeType: string): boolean {
  const type = mimeType.toLowerCase();
  return accepted.some((entry) => {
    const pattern = entry.toLowerCase();
    return pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern;
  });
}

/** Megabytes as the web counts them for this limit: 20 MB is 20 × 1024 × 1024 bytes. */
function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function SourceRow({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: typeof Glyphs.Gallery;
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { ring, onFocus, onBlur } = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, ring]}
    >
      <Icon icon={icon} size={20} color={colors.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing[2] },
  zone: {
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[8],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  invalid: { borderColor: colors.danger },
  pressed: { backgroundColor: colors.surface3 },
  disabled: { opacity: 0.4 },
  prompt: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  // The web's "choose" button, drawn: the zone is the control, so this is its label, not a second button.
  pill: {
    marginTop: spacing[1],
    height: 36,
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    backgroundColor: colors.surface3,
    justifyContent: 'center',
  },
  pillLabel: { ...font.medium, fontSize: fontSize.caption, color: colors.textPrimary },
  hint: {
    ...font.regular,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  refusal: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  refusalIcon: { paddingTop: (lineHeight.small - 14) / 2 },
  refusalText: {
    flexShrink: 1,
    ...font.regular,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
    color: colors.danger,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: measure.touchTarget + spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: colors.surface3 },
  rowLabel: { ...font.regular, fontSize: fontSize.base, color: colors.textPrimary },
});
