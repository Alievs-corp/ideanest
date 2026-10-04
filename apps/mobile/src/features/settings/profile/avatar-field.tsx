import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Glyphs } from '../../../icons';
import {
  announce,
  Body,
  Field,
  InlineAlert,
  initials,
  Pill,
  TextInput,
} from '../../../components/ui';
import { useT, type Translate } from '../../../lib/i18n';
import {
  isAbortError,
  MINIMUM_EDGE,
  uploadImage,
  UploadFailed,
  type UploadStage,
} from '../../../lib/media/upload';
import { colors, font, fontSize, radius, spacing } from '../../../theme';

/**
 * The profile picture, native — the web's `ProfileAvatarField` with an uploader instead of a
 * measuring drop zone (#161). A picture from the library or the camera, cropped square in the
 * system picker, goes through `lib/media/upload.ts` and is saved as `avatarUrl` at once: the
 * bytes already exist, and an upload that waited for "Save profile" would be an orphan when
 * somebody left the screen. The web's address field stays, behind "Use an image address", and
 * like "Remove picture" it is part of the form, saved with everything else.
 */

/** The web's `size-20`. */
const PREVIEW = 80;

/** The service's failure codes with a sentence of their own (`campaignEditor.cover.failures`). */
const KNOWN_FAILURES = [
  'UNSUPPORTED_FORMAT',
  'TOO_LARGE',
  'EMPTY',
  'UNREADABLE',
  'UPLOADS_UNAVAILABLE',
  'MEDIA_STORAGE_UNREACHABLE',
  'UPLOAD_TRANSFER_FAILED',
  'UPLOAD_REFUSED',
  'UPLOAD_UNFINISHED',
  'MEDIA_NOT_FOUND',
] as const;

type KnownFailure = (typeof KNOWN_FAILURES)[number];

function isKnownFailure(code: string): code is KnownFailure {
  return (KNOWN_FAILURES as readonly string[]).includes(code);
}

/** The sentence for a failed upload: the code's own where there is one, else the service's. */
export function describeUploadFailure(cause: unknown, t: Translate): string {
  if (cause instanceof UploadFailed) {
    // The cover's sentence says the image may still appear; an avatar keeps no media id, so it
    // never will.
    if (cause.code === 'UPLOAD_STILL_PROCESSING') {
      return t('mobile.settings.profile.avatar.stillProcessing');
    }
    if (cause.code === 'TOO_SMALL') {
      return t('campaignEditor.cover.failures.TOO_SMALL', {
        minimum: `${MINIMUM_EDGE}×${MINIMUM_EDGE}`,
      });
    }
    if (isKnownFailure(cause.code)) return t(`campaignEditor.cover.failures.${cause.code}`);
    if (cause.message !== '') return cause.message;
  }
  return t('campaignEditor.cover.unusable');
}

/**
 * The system picker hands over a copy in this app's cache (the crop is always a new file), which
 * nothing else removes. Anything outside the cache is not ours to delete.
 */
function forgetPicked(uri: string): void {
  try {
    const cache = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : `${Paths.cache.uri}/`;
    if (uri.startsWith(cache)) new File(uri).delete();
  } catch {
    // Already gone: nothing to tidy.
  }
}

type Note = { readonly tone: 'success' | 'danger'; readonly title?: string; readonly text: string };

export function AvatarField({
  url,
  name,
  disabled,
  error,
  onUrlChange,
  onUploaded,
}: {
  /** The address as the form holds it. */
  readonly url: string;
  /** Whose picture it is, for the initials. */
  readonly name: string;
  readonly disabled: boolean;
  readonly error?: string;
  readonly onUrlChange: (url: string) => void;
  /** Saves the uploaded address; false when the save was refused (the form says why). */
  readonly onUploaded: (url: string) => Promise<boolean>;
}) {
  const t = useT('profile.editor.avatar');
  const tCover = useT('campaignEditor.cover');
  const tPicker = useT('mobile.kitForm.filePicker');
  const tMobile = useT('mobile.settings.profile.avatar');
  const tEditor = useT('profile.editor');
  const tAll = useT();

  const [stage, setStage] = useState<UploadStage | 'saving' | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const busy = stage !== null;
  const address = url.trim();
  // The service accepts https only; anything shorter is not worth asking the network for.
  const previewable = address.startsWith('https://') && broken !== address;

  const stageText =
    stage === null ? '' : stage === 'saving' ? tEditor('saving') : tCover(`stage.${stage}`);

  useEffect(() => {
    // iOS has no live regions; Android's region below speaks on its own.
    if (Platform.OS === 'ios' && stageText !== '') announce(stageText);
  }, [stageText]);

  async function upload(uri: string): Promise<void> {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setNote(null);
    setStage('preparing');
    try {
      const image = await uploadImage(uri, { signal: controller.signal, onStage: setStage });
      setStage('saving');
      setBroken(null);
      if (await onUploaded(image.url)) setNote({ tone: 'success', text: tMobile('saved') });
    } catch (cause) {
      if (isAbortError(cause)) return;
      setNote({ tone: 'danger', title: tCover('notUsedTitle'), text: describeUploadFailure(cause, tAll) });
    } finally {
      forgetPicked(uri);
      if (inFlight.current === controller) {
        inFlight.current = null;
        setStage(null);
      }
    }
  }

  async function pick(source: 'library' | 'camera'): Promise<void> {
    if (busy || disabled) return;
    setNote(null);
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setNote({
          tone: 'danger',
          text: permission.canAskAgain === false ? tPicker('cameraDenied') : tPicker('cameraRefused'),
        });
        return;
      }
    }

    let result: ImagePicker.ImagePickerResult;
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: 'images',
        // The frame is a circle: offer the square crop in the system's own editor.
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible,
      };
      result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
    } catch {
      setNote({ tone: 'danger', text: tPicker('openFailed') });
      return;
    }

    const asset = result.canceled ? undefined : result.assets[0];
    if (asset !== undefined) await upload(asset.uri);
  }

  const status =
    address !== '' && broken === address ? t('broken') : previewable ? t('cropped') : t('initials');

  return (
    <Field grouped label={t('label')} hint={t('hint')} error={error} testID="avatar-field">
      <View style={styles.stack}>
        <View style={styles.preview}>
          {previewable ? (
            <View
              style={styles.circle}
              // The sentence beside it says what it is.
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="avatar-preview-image"
            >
              <Image
                source={{ uri: address }}
                style={styles.fill}
                contentFit="cover"
                transition={0}
                onError={() => setBroken(address)}
              />
            </View>
          ) : (
            <View
              style={styles.circle}
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('noPicture', { name })}
              testID="avatar-preview-initials"
            >
              <Text style={styles.initials} maxFontSizeMultiplier={1} importantForAccessibility="no">
                {initials(name)}
              </Text>
            </View>
          )}
          <View style={styles.words}>
            <Body tone="tertiary" testID="avatar-status">
              {status}
            </Body>
          </View>
        </View>

        <View accessibilityLiveRegion="polite">
          {stageText === '' ? null : (
            <Body tone="secondary" testID="avatar-stage">
              {stageText}
            </Body>
          )}
        </View>

        <View style={styles.actions}>
          <Pill
            label={tPicker('library')}
            iconLeft={Glyphs.Gallery}
            variant="ghost"
            disabled={disabled || busy}
            busy={busy}
            onPress={() => void pick('library')}
            testID="avatar-library"
          />
          <Pill
            label={tPicker('camera')}
            iconLeft={Glyphs.Camera}
            variant="ghost"
            disabled={disabled || busy}
            onPress={() => void pick('camera')}
            testID="avatar-camera"
          />
          {address === '' ? null : (
            <Pill
              label={t('remove')}
              variant="outline"
              disabled={disabled || busy}
              onPress={() => {
                setBroken(null);
                setNote(null);
                onUrlChange('');
              }}
              testID="avatar-remove"
            />
          )}
        </View>

        {note === null ? null : (
          <InlineAlert
            variant={note.tone}
            title={note.title}
            description={note.text}
            politeness={note.tone === 'success' ? 'polite' : 'assertive'}
            testID={note.tone === 'success' ? 'avatar-saved' : 'avatar-failed'}
          />
        )}

        {typing ? (
          <TextInput
            value={url}
            onChangeText={(next) => {
              setBroken(null);
              onUrlChange(next);
            }}
            accessibilityLabel={t('address')}
            placeholder={t('addressPlaceholder')}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="URL"
            disabled={disabled || busy}
            testID="avatar-address"
          />
        ) : (
          <View style={styles.secondary}>
            <Pill
              label={tMobile('useAddress')}
              variant="outline"
              size="sm"
              disabled={disabled || busy}
              onPress={() => setTyping(true)}
              testID="avatar-use-address"
            />
          </View>
        )}
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing[3] },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  circle: {
    width: PREVIEW,
    height: PREVIEW,
    borderRadius: radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fill: { width: '100%', height: '100%' },
  initials: { ...font.medium, fontSize: fontSize.h3, color: colors.textSecondary },
  words: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  secondary: { alignItems: 'flex-start' },
});
