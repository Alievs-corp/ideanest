import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { RewardImage, RewardVideo } from '@ideanest/campaign-editor/contract';
import type { RewardTierEditorCopy } from '@ideanest/campaign-editor/copy';
import { REWARD_VIDEO_MAX_SECONDS } from '@ideanest/campaign-editor/video';
import { Field, InlineAlert, Media, Pill } from '../../../components/ui';
import { clockDuration } from '../../../lib/media/duration';
import { MINIMUM_EDGE } from '../../../lib/media/upload';
import { colors, radius, spacing } from '../../../theme';
import { ImageSourceControls, useImageSource, type ImageSourceCopy } from '../image-source';
import { useVideoUpload } from '../use-video-upload';
import { VideoField, type VideoFieldWords } from '../video-field';

/**
 * A reward tier's picture and clip, in its drawer.
 *
 * <p>Both are uploads through the media pipeline and both live in the drawer's draft until Save:
 * the draft holds the response's shape so the drawer can preview it, and only its `mediaId` is
 * sent (`newRewardFrom`, `rewardPatchFrom`). The picture has no "image address" option — the
 * tier names its picture by upload. The clip is the campaign video's field with a five-second
 * limit: the picker caps a recording there, the preflight refuses a longer clip before a byte is
 * sent, and a save the service refused as too long (`REWARD_VIDEO_TOO_LONG`) puts the stored clip
 * back with the refusal under the field.
 */

const SECONDS = String(REWARD_VIDEO_MAX_SECONDS);

export function RewardImageField({
  words,
  image,
  disabled = false,
  error,
  onChange,
}: {
  readonly words: RewardTierEditorCopy;
  readonly image: RewardImage | null;
  readonly disabled?: boolean;
  readonly error?: string | undefined;
  readonly onChange: (image: RewardImage | null) => void;
}) {
  const upload = words.upload;
  const sourceCopy = useMemo<ImageSourceCopy>(
    () => ({
      stage: upload.stage,
      failures: upload.failures,
      minimum: `${MINIMUM_EDGE}×${MINIMUM_EDGE}`,
      unusable: upload.unusable,
      notUsedTitle: upload.notUsedTitle,
      // No address field is drawn here (`allowAddress={false}`), so its words are never read.
      needUrlFirst: '',
      urlLabel: '',
      urlPlaceholder: '',
      useAddress: '',
      checking: '',
    }),
    [upload],
  );
  const [note, setNote] = useState(false);
  const source = useImageSource({
    copy: sourceCopy,
    onImage: (chosen) => {
      if (chosen.mediaId === null) return;
      setNote(true);
      onChange({
        mediaId: chosen.mediaId,
        url: chosen.url,
        width: chosen.width,
        height: chosen.height,
        blurDataUrl: chosen.blurDataUrl,
      });
    },
  });

  return (
    <Field label={words.image} hint={words.imageHint} error={error} grouped testID="reward-image">
      <View style={styles.body}>
        {image === null ? null : (
          <View style={styles.figure} testID="reward-image-preview">
            <Media src={image.url} ratio="3/2" placeholder={image.blurDataUrl ?? null} decorative />
            <View style={styles.caption}>
              <Pill
                label={words.imageRemove}
                variant="ghost"
                size="sm"
                disabled={disabled}
                onPress={() => {
                  setNote(false);
                  onChange(null);
                }}
                testID="reward-image-remove"
              />
            </View>
          </View>
        )}

        <ImageSourceControls
          source={source}
          copy={sourceCopy}
          disabled={disabled}
          allowAddress={false}
          testID="reward-image-source"
        />

        {note && image !== null && source.stage === null ? (
          <InlineAlert variant="success" politeness="polite" description={words.imageUploaded} testID="reward-image-note" />
        ) : null}
      </View>
    </Field>
  );
}

export function RewardVideoField({
  words,
  saved,
  video,
  refusal,
  disabled = false,
  onChange,
}: {
  readonly words: RewardTierEditorCopy;
  /** The clip the stored tier has, which a refused save goes back to. */
  readonly saved: RewardVideo | null;
  /** The clip in the draft. */
  readonly video: RewardVideo | null;
  /** The service's sentence when it refused the draft's clip, else null. */
  readonly refusal: string | null;
  readonly disabled?: boolean;
  readonly onChange: (video: RewardVideo | null) => void;
}) {
  const copy = words.video;
  const upload = useVideoUpload({
    saved: video,
    // Nothing to queue: the drawer sends the clip's id when it is saved.
    save: () => undefined,
    onChosen: onChange,
    refusal,
    forget: () => onChange(saved),
    pending: false,
    maxSeconds: REWARD_VIDEO_MAX_SECONDS,
    tooLong: (durationMs) => fillPlaceholders(copy.tooLong, { duration: clockDuration(durationMs), seconds: SECONDS }),
  });
  const fieldWords = useMemo<VideoFieldWords>(
    () => ({
      label: copy.label,
      hint: fillPlaceholders(copy.hint, { seconds: SECONDS }),
      set: copy.set,
      processing: copy.stage.processing,
    }),
    [copy],
  );
  return <VideoField upload={upload} disabled={disabled} words={fieldWords} testID="reward-video" />;
}

const styles = StyleSheet.create({
  body: { gap: spacing[3] },
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
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
});
