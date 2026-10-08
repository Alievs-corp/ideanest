import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { CampaignVideo } from '@ideanest/campaign-editor/contract';
import { Caption, Field, InlineAlert, Media, Pill } from '../../components/ui';
import { Glyphs } from '../../icons';
import { clockDuration } from '../../lib/media/duration';
import { useT, type Translate } from '../../lib/i18n';
import {
  UploadFailed,
  VIDEO_MAX_DURATION_MS,
  forgetPicked,
  isAbortError,
  isVideoTooLarge,
  isVideoTooLong,
  uploadVideo,
  type UploadStage,
} from '../../lib/media/upload';
import { colors, radius, spacing } from '../../theme';

/**
 * The campaign video — issue #331, the Basics tab's second upload, under the cover.
 *
 * <ul>
 *   <li>Empty: "Choose a video", which opens the library for videos only. On iOS the picker's
 *       trim UI is on (`allowsEditing`) and the export is H.264 at 1280×720, so the phone sends a
 *       720p file instead of a 4K one; the service transcodes every upload regardless.</li>
 *   <li>A clip over a minute or over 250 MB is refused HERE, with the picker's own figures, before
 *       a byte is sent: the service would refuse it anyway, after the creator had waited for the
 *       upload. Android's library has no trim, so this is the check that catches it there.</li>
 *   <li>Uploading says how much has been sent; processing says it can take about a minute — the
 *       service transcodes it, and `uploadVideo` asks every 2 seconds for up to 5 minutes.</li>
 *   <li>Ready: the poster in the page's 16:9 box with the length, "Replace video" and "Remove
 *       video". A refusal is drawn at once in the copy's words, by the service's code.</li>
 * </ul>
 *
 * <p>`onAccept` receives the READY video and the caller saves `{videoMediaId}`; `onRemove` saves
 * `{videoMediaId: null}`. Nothing is attached until the service says the video plays: the
 * service refuses an id that has not finished processing.
 *
 * <p>No camera: the app declares no microphone permission (`app.config.ts`, the image picker's
 * plugin), and a campaign video recorded without sound is not one anybody wants.
 */

/** The media service's codes with a sentence of their own in `mobile.editor.video.failures`. */
export const VIDEO_FAILURE_CODES = [
  'TOO_LONG',
  'TOO_LARGE',
  'UNSUPPORTED_FORMAT',
  'EMPTY',
  'TOO_SMALL',
  'UNREADABLE',
  'UPLOADS_UNAVAILABLE',
  'MEDIA_STORAGE_UNREACHABLE',
  'UPLOAD_STILL_PROCESSING',
  'UPLOAD_TRANSFER_FAILED',
  'UPLOAD_REFUSED',
  'UPLOAD_UNFINISHED',
  'MEDIA_NOT_FOUND',
] as const;

type VideoFailureCode = (typeof VIDEO_FAILURE_CODES)[number];

function isVideoFailureCode(code: string): code is VideoFailureCode {
  return (VIDEO_FAILURE_CODES as readonly string[]).includes(code);
}

/** A refusal in the catalogue's words: the code's sentence, else the service's own, else "unusable". */
export function describeVideoFailure(cause: unknown, t: Translate): string {
  if (cause instanceof UploadFailed) {
    if (isVideoFailureCode(cause.code)) return t(`mobile.editor.video.failures.${cause.code}`);
    if (cause.message !== '') return cause.message;
  }
  return t('mobile.editor.video.unusable');
}

/**
 * The picker's options. `videoMaxDuration` caps a recording, and on iOS the trim UI that
 * `allowsEditing` turns on; `videoExportPreset` is iOS's export, and is ignored on Android.
 */
export const VIDEO_PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['videos'],
  allowsEditing: true,
  videoMaxDuration: VIDEO_MAX_DURATION_MS / 1000,
  videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
};

interface Failure {
  readonly title?: string;
  readonly text: string;
}

export function VideoField({
  video,
  disabled = false,
  error,
  onAccept,
  onRemove,
}: {
  readonly video: CampaignVideo | null;
  readonly disabled?: boolean;
  readonly error?: string | undefined;
  readonly onAccept: (video: CampaignVideo) => void;
  readonly onRemove: () => void;
}) {
  const t = useT('mobile.editor.video');
  const tAll = useT();
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [added, setAdded] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const onAcceptRef = useRef(onAccept);
  useEffect(() => {
    onAcceptRef.current = onAccept;
  }, [onAccept]);

  // Leaving the screen abandons an upload rather than applying it to a screen that is gone.
  useEffect(() => () => inFlight.current?.abort(), []);

  const pick = useCallback(async (): Promise<void> => {
    Keyboard.dismiss();
    setFailure(null);
    setAdded(false);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync(VIDEO_PICKER_OPTIONS);
    } catch {
      setFailure({ text: t('openFailed') });
      return;
    }
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset === undefined) return;

    const refuse = (code: VideoFailureCode) => {
      forgetPicked(asset.uri);
      setFailure({ title: t('notUsedTitle'), text: t(`failures.${code}`) });
    };
    if (isVideoTooLong(asset.duration)) return refuse('TOO_LONG');
    if (isVideoTooLarge(asset.fileSize)) return refuse('TOO_LARGE');

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setPercent(0);
    try {
      const uploaded = await uploadVideo(asset.uri, {
        signal: controller.signal,
        mimeType: asset.mimeType ?? null,
        onStage: setStage,
        // A state update only when the whole percent moves: a progress event per network chunk
        // would re-render the field hundreds of times for a large file.
        onProgress: (fraction) => setPercent(Math.floor(fraction * 100)),
      });
      if (controller.signal.aborted) return;
      onAcceptRef.current({
        mediaId: uploaded.mediaId,
        url: uploaded.url,
        posterUrl: uploaded.posterUrl,
        width: uploaded.width,
        height: uploaded.height,
        durationMs: uploaded.durationMs,
        blurDataUrl: uploaded.blurDataUrl === '' ? null : uploaded.blurDataUrl,
      });
      setAdded(true);
    } catch (cause) {
      if (isAbortError(cause) || controller.signal.aborted) return;
      setFailure({ title: t('notUsedTitle'), text: describeVideoFailure(cause, tAll) });
    } finally {
      // The picker's copy in the cache: a minute of video is not something to leave behind.
      forgetPicked(asset.uri);
      if (inFlight.current === controller) {
        inFlight.current = null;
        setStage(null);
        setBusy(false);
      }
    }
  }, [t, tAll]);

  const off = disabled || busy;

  return (
    <Field label={t('label')} hint={t('hint')} error={error} grouped>
      <View style={styles.body}>
        {video === null ? null : (
          <View style={styles.figure} testID="video-preview">
            <Media
              src={video.posterUrl}
              ratio="16/9"
              fit="contain"
              placeholder={video.blurDataUrl ?? null}
              decorative
            />
            <View style={styles.caption}>
              <Caption testID="video-length">{t('length', { duration: clockDuration(video.durationMs) })}</Caption>
              <Pill
                label={t('remove')}
                variant="ghost"
                size="sm"
                disabled={off}
                onPress={() => {
                  setAdded(false);
                  setFailure(null);
                  onRemove();
                }}
                testID="video-remove"
              />
            </View>
          </View>
        )}

        <View style={styles.start}>
          <Pill
            label={video === null ? t('choose') : t('replace')}
            iconLeft={Glyphs.VideoPlay}
            variant="outline"
            size="sm"
            busy={busy}
            disabled={off}
            onPress={() => void pick()}
            testID="video-choose"
          />
        </View>

        {stage === null ? null : (
          <InlineAlert
            variant="info"
            politeness="polite"
            description={stage === 'uploading' ? t('stage.uploading', { percent }) : t(`stage.${stage}`)}
            testID="video-stage"
          />
        )}
        {failure === null ? null : (
          <InlineAlert variant="danger" title={failure.title} description={failure.text} testID="video-failure" />
        )}
        {stage === null && failure === null && added && video !== null ? (
          <InlineAlert variant="success" politeness="polite" description={t('set')} testID="video-note" />
        ) : null}
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing[3] },
  start: { alignSelf: 'flex-start' },
  figure: {
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  caption: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
});
