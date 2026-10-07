import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Keyboard, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import {
  COVER_FAILURE_CODES,
  type CoverFailureCode,
  type CoverFailureCopy,
  type CoverImageCopy,
} from '@ideanest/campaign-editor/copy';
import { COVER_MIN_HEIGHT, COVER_MIN_WIDTH } from '@ideanest/campaign-editor/cover-image';
import { Field, InlineAlert, Pill, TextInput } from '../../components/ui';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { UploadFailed, isAbortError, uploadImage, type UploadStage } from '../../lib/media/upload';
import { spacing } from '../../theme';

/**
 * Where an image comes from on a phone — the photo library, the camera, or a typed address — and
 * what it becomes: `{url, width, height, mediaId}` (#162).
 *
 * <p>The cover field uses it now; the story's image block and a reward item's image use it next,
 * because on a phone there is no practical way to produce an image address (#162, "Native
 * decisions"). An uploaded picture goes through `lib/media/upload.ts` (JPEG on the phone, the
 * presigned PUT with no `Authorization`, then the poll) and arrives with the service's
 * `mediaId`; an address is measured with `Image.getSize` and arrives with `mediaId: null`.
 *
 * <h2>Contract</h2>
 *
 * `useImageSource({ copy, onImage })` returns `{ stage, busy, failure, pick(source),
 * useAddress(url), clearFailure }`: `onImage` receives a {@link ChosenImage} once one is ready;
 * `stage` is the upload's stage for the "Preparing / Uploading / Processing" alert; `failure`
 * is a refusal in the copy's words. `<ImageSourceControls source={…} copy={…} />` draws the two
 * buttons, the "Use an image address" toggle, the address field, and the stage and failure
 * alerts. `imageSourceCopyFrom(coverCopy)` builds the copy from the cover's words, whose failure
 * codes are the media service's for every upload. An address must be `http:` or `https:`
 * (`isWebAddress`); anything else is refused before it is measured.
 */

export interface ChosenImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** The upload behind it; null for a typed address. */
  readonly mediaId: string | null;
  /** The service's blur placeholder for an upload, or null. */
  readonly blurDataUrl: string | null;
}

export interface ImageSourceCopy {
  readonly stage: Readonly<Record<UploadStage, string>>;
  readonly failures: CoverFailureCopy;
  /** Fills `{minimum}` in `failures.TOO_SMALL`. */
  readonly minimum: string;
  readonly unusable: string;
  readonly notUsedTitle: string;
  readonly needUrlFirst: string;
  readonly urlLabel: string;
  readonly urlPlaceholder: string;
  readonly useAddress: string;
  readonly checking: string;
}

export function imageSourceCopyFrom(cover: CoverImageCopy): ImageSourceCopy {
  return {
    stage: cover.stage,
    failures: cover.failures,
    minimum: `${COVER_MIN_WIDTH}×${COVER_MIN_HEIGHT}`,
    unusable: cover.unusable,
    notUsedTitle: cover.notUsedTitle,
    needUrlFirst: cover.needUrlFirst,
    urlLabel: cover.urlLabel,
    urlPlaceholder: cover.urlPlaceholder,
    useAddress: cover.useAddress,
    checking: cover.checking,
  };
}

export interface ImageFailure {
  readonly title?: string;
  readonly text: string;
}

export type ImageSourceKind = 'library' | 'camera';

/** The intrinsic size of the image at `url`, from React Native's own loader. */
export function measureImageAddress(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      url,
      (width, height) => resolve({ width, height }),
      (error) => reject(error instanceof Error ? error : new Error('unmeasurable')),
    );
  });
}

/** Whether `url` is an absolute `http:` or `https:` address with a host. */
export function isWebAddress(url: string): boolean {
  return /^https?:\/\/[^\s/?#]+/iu.test(url.trim());
}

function isKnownCode(code: string): code is CoverFailureCode {
  return (COVER_FAILURE_CODES as readonly string[]).includes(code);
}

/** A refusal in the copy's words: the code's sentence, else the service's own, else "unusable". */
export function describeImageFailure(cause: unknown, copy: ImageSourceCopy): string {
  if (cause instanceof UploadFailed) {
    if (isKnownCode(cause.code)) return fillPlaceholders(copy.failures[cause.code], { minimum: copy.minimum });
    return cause.message === '' ? copy.unusable : cause.message;
  }
  return copy.unusable;
}

export interface ImageSource {
  readonly stage: UploadStage | null;
  /** Something is being picked, uploaded or measured. */
  readonly busy: boolean;
  readonly failure: ImageFailure | null;
  readonly pick: (source: ImageSourceKind) => Promise<void>;
  readonly useAddress: (address: string) => Promise<void>;
  readonly clearFailure: () => void;
}

export function useImageSource({
  copy,
  onImage,
}: {
  readonly copy: ImageSourceCopy;
  readonly onImage: (image: ChosenImage) => void;
}): ImageSource {
  const t = useT('mobile.kitForm.filePicker');
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ImageFailure | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const onImageRef = useRef(onImage);
  useEffect(() => {
    onImageRef.current = onImage;
  }, [onImage]);

  // Leaving the screen abandons an upload rather than applying it to a screen that is gone.
  useEffect(() => () => inFlight.current?.abort(), []);

  const pick = useCallback(
    async (source: ImageSourceKind): Promise<void> => {
      Keyboard.dismiss();
      setFailure(null);
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setFailure({ text: permission.canAskAgain === false ? t('cameraDenied') : t('cameraRefused') });
          return;
        }
      }
      let result: ImagePicker.ImagePickerResult;
      try {
        const options: ImagePicker.ImagePickerOptions = {
          mediaTypes: 'images',
          quality: 1,
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible,
        };
        result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync(options);
      } catch {
        setFailure({ text: t('openFailed') });
        return;
      }
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset === undefined) return;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setBusy(true);
      try {
        const image = await uploadImage(asset.uri, { signal: controller.signal, onStage: setStage });
        if (controller.signal.aborted) return;
        onImageRef.current({
          url: image.url,
          width: image.width,
          height: image.height,
          mediaId: image.mediaId,
          blurDataUrl: image.blurDataUrl === '' ? null : image.blurDataUrl,
        });
      } catch (cause) {
        if (isAbortError(cause) || controller.signal.aborted) return;
        setFailure({ title: copy.notUsedTitle, text: describeImageFailure(cause, copy) });
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setStage(null);
          setBusy(false);
        }
      }
    },
    [copy, t],
  );

  const useAddress = useCallback(
    async (address: string): Promise<void> => {
      const url = address.trim();
      setFailure(null);
      if (url === '') {
        setFailure({ text: copy.needUrlFirst });
        return;
      }
      // A web address only: `file:`, `data:` or `content:` would measure here and mean nothing to
      // anybody else who opens the campaign.
      if (!isWebAddress(url)) {
        setFailure({ text: copy.unusable });
        return;
      }
      setBusy(true);
      try {
        const size = await measureImageAddress(url);
        // `mediaId: null`, not omitted: a stale upload id beside a new address is refused.
        onImageRef.current({ url, width: size.width, height: size.height, mediaId: null, blurDataUrl: null });
      } catch {
        setFailure({ text: copy.unusable });
      } finally {
        setBusy(false);
      }
    },
    [copy],
  );

  const clearFailure = useCallback(() => setFailure(null), []);

  return { stage, busy, failure, pick, useAddress, clearFailure };
}

/**
 * The controls for an {@link ImageSource}: "Choose from library" and "Take a photo", a secondary
 * "Use an image address" that opens the address field with "Use this address" ("Checking"), and
 * the stage (polite) and failure (assertive, drawn at once) alerts.
 */
export function ImageSourceControls({
  source,
  copy,
  disabled = false,
  testID = 'image-source',
}: {
  readonly source: ImageSource;
  readonly copy: ImageSourceCopy;
  readonly disabled?: boolean;
  readonly testID?: string;
}) {
  const t = useT('mobile.editor.image');
  const [addressOpen, setAddressOpen] = useState(false);
  const [address, setAddress] = useState('');
  const off = disabled || source.busy;

  return (
    <View style={styles.controls}>
      <View style={styles.buttons}>
        <Pill
          label={t('library')}
          iconLeft={Glyphs.Gallery}
          variant="outline"
          size="sm"
          disabled={off}
          onPress={() => void source.pick('library')}
          testID={`${testID}-library`}
        />
        <Pill
          label={t('camera')}
          iconLeft={Glyphs.Camera}
          variant="outline"
          size="sm"
          disabled={off}
          onPress={() => void source.pick('camera')}
          testID={`${testID}-camera`}
        />
        {addressOpen ? null : (
          <Pill
            label={t('address')}
            iconLeft={Glyphs.Link}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onPress={() => setAddressOpen(true)}
            testID={`${testID}-address-open`}
          />
        )}
      </View>

      {addressOpen ? (
        <Field label={copy.urlLabel}>
          <View style={styles.address}>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder={copy.urlPlaceholder}
              keyboardType="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              disabled={disabled}
              returnKeyType="done"
              onSubmitEditing={() => void source.useAddress(address)}
              testID={`${testID}-address`}
            />
            <View style={styles.start}>
              <Pill
                label={source.busy && source.stage === null ? copy.checking : copy.useAddress}
                variant="ghost"
                size="sm"
                busy={source.busy && source.stage === null}
                disabled={off}
                onPress={() => void source.useAddress(address)}
                testID={`${testID}-address-use`}
              />
            </View>
          </View>
        </Field>
      ) : null}

      {source.stage === null ? null : (
        <InlineAlert variant="info" politeness="polite" description={copy.stage[source.stage]} testID={`${testID}-stage`} />
      )}
      {source.failure === null ? null : (
        <InlineAlert
          variant="danger"
          title={source.failure.title}
          description={source.failure.text}
          testID={`${testID}-failure`}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { gap: spacing[3] },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  address: { gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
});
