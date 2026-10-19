import { StyleSheet, View } from 'react-native';
import { Caption, Field, InlineAlert, Media, Pill } from '../../components/ui';
import { Glyphs } from '../../icons';
import { clockDuration } from '../../lib/media/duration';
import { useT } from '../../lib/i18n';
import { colors, radius, spacing } from '../../theme';
import type { VideoUpload } from './use-video-upload';

/**
 * The campaign video — issue #331, the Basics tab's second upload, under the cover.
 *
 * <ul>
 *   <li>Empty: "Choose a video", which opens the library for videos only. On iOS the picker's
 *       trim UI is on and the export is H.264 at 1280×720, so the phone sends a 720p file instead
 *       of a 4K one; the service transcodes every upload regardless.</li>
 *   <li>A clip over a minute or over 250 MB is refused before a byte is sent: the service would
 *       refuse it anyway, after the creator had waited for the upload. Android's library has no
 *       trim, so this is the check that catches it there, and its words say to trim it first.</li>
 *   <li>Uploading says how much has been sent; processing says it takes about a minute. Both say
 *       to keep the app open: the transfer is a foreground one.</li>
 *   <li>Ready: the poster in the page's 16:9 box with the length, "Replace video" and "Remove
 *       video". A refusal is drawn at once in the copy's words; a wait that ran out offers "Check
 *       again", which asks about the same upload rather than starting over.</li>
 * </ul>
 *
 * <p>The upload itself is the editor's (`useVideoUpload`, held by `EditorProvider`), not this
 * field's, so leaving the Basics tab does not stop it: coming back shows where it has got to.
 *
 * <p>No camera: the app declares no microphone permission (`app.config.ts`, the image picker's
 * plugin), and a campaign video recorded without sound is not one anybody wants.
 *
 * <p>A reward tier's clip is drawn by the same field with its own `words` (its label, its five
 * seconds, what "ready" means in a drawer that saves on Save) and its own `testID` prefix.
 */
export interface VideoFieldWords {
  readonly label: string;
  readonly hint: string;
  /** Said once the clip is ready. */
  readonly set: string;
  /** The processing stage, which for a minute-long clip says it takes a minute. */
  readonly processing?: string;
}

export function VideoField({
  upload,
  disabled = false,
  words,
  error,
  testID = 'video',
}: {
  readonly upload: VideoUpload;
  readonly disabled?: boolean;
  /** The campaign video's own words when absent. */
  readonly words?: VideoFieldWords;
  readonly error?: string | undefined;
  readonly testID?: string;
}) {
  const t = useT('mobile.editor.video');
  const { video, stage, percent, busy, failure, added } = upload;
  const off = disabled || busy;
  const stageText = (current: NonNullable<typeof stage>): string => {
    if (current === 'uploading') return t('stage.uploading', { percent });
    if (current === 'processing' && words?.processing !== undefined) return words.processing;
    return t(`stage.${current}`);
  };

  return (
    <Field label={words?.label ?? t('label')} hint={words?.hint ?? t('hint')} error={error} grouped>
      <View style={styles.body}>
        {video === null ? null : (
          <View style={styles.figure} testID={`${testID}-preview`}>
            <Media
              src={video.posterUrl}
              ratio="16/9"
              fit="contain"
              placeholder={video.blurDataUrl ?? null}
              decorative
            />
            <View style={styles.caption}>
              <Caption testID={`${testID}-length`}>{t('length', { duration: clockDuration(video.durationMs) })}</Caption>
              <Pill
                label={t('remove')}
                variant="ghost"
                size="sm"
                disabled={disabled}
                onPress={upload.remove}
                testID={`${testID}-remove`}
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
            onPress={() => void upload.pick()}
            testID={`${testID}-choose`}
          />
        </View>

        {stage === null ? null : (
          <InlineAlert
            variant="info"
            politeness="polite"
            description={stageText(stage)}
            testID={`${testID}-stage`}
          />
        )}
        {failure === null ? null : (
          <InlineAlert
            variant="danger"
            title={failure.title}
            description={failure.text}
            testID={`${testID}-failure`}
            action={
              upload.canCheckAgain ? (
                <View style={styles.start}>
                  <Pill
                    label={t('checkAgain')}
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onPress={() => void upload.checkAgain()}
                    testID={`${testID}-check-again`}
                  />
                </View>
              ) : undefined
            }
          />
        )}
        {stage === null && failure === null && added && video !== null ? (
          <InlineAlert
            variant="success"
            politeness="polite"
            description={words?.set ?? t('set')}
            testID={`${testID}-note`}
          />
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
