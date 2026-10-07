import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { CoverImage } from '@ideanest/campaign-editor/contract';
import type { CoverImageCopy } from '@ideanest/campaign-editor/copy';
import {
  COVER_MIN_HEIGHT,
  COVER_MIN_WIDTH,
  describeSize,
  meetsCoverMinimum,
} from '@ideanest/campaign-editor/cover-image';
import { Caption, Field, InlineAlert, Media, Pill } from '../../components/ui';
import { colors, radius, spacing } from '../../theme';
import { ImageSourceControls, imageSourceCopyFrom, useImageSource, type ChosenImage } from './image-source';

const MINIMUM = `${COVER_MIN_WIDTH}×${COVER_MIN_HEIGHT}`;

/**
 * The cover image — the web's `CoverImageField`, on a phone (#162). Basics now, Pre-launch next.
 *
 * <ul>
 *   <li>The current cover in the discovery card's 16:9 crop (the card crops, so the preview
 *       does), with "Cover is W×H pixels" (· uploaded) and a ghost "Remove cover".</li>
 *   <li>"Choose from library" and "Take a photo" upload through the presigned flow; "Use an image
 *       address" measures an address instead (`image-source.tsx`).</li>
 *   <li>The result: under 1024×576 an info "This will look soft at full width" — advice, the
 *       cover is still set — otherwise "Cover set from a W×H pixel image.".</li>
 * </ul>
 *
 * <p>`onAccept` receives the cover to save: an upload carries its `mediaId` (the service fills
 * in the address and size from what it measured), an address carries `mediaId: null`.
 */
export function CoverImageField({
  copy,
  cover,
  disabled = false,
  error,
  onAccept,
  onRemove,
}: {
  readonly copy: CoverImageCopy;
  readonly cover: CoverImage | null;
  readonly disabled?: boolean;
  readonly error?: string | undefined;
  readonly onAccept: (cover: CoverImage) => void;
  readonly onRemove: () => void;
}) {
  const sourceCopy = useMemo(() => imageSourceCopyFrom(copy), [copy]);
  const [note, setNote] = useState<{ tone: 'success' | 'info'; title?: string; text: string } | null>(null);
  const [placeholder, setPlaceholder] = useState<string | null>(null);

  const source = useImageSource({
    copy: sourceCopy,
    onImage: (image: ChosenImage) => {
      setPlaceholder(image.blurDataUrl);
      onAccept({ url: image.url, width: image.width, height: image.height, mediaId: image.mediaId });
      setNote(
        meetsCoverMinimum(image)
          ? { tone: 'success', text: fillPlaceholders(copy.set, { size: describeSize(image) }) }
          : {
              tone: 'info',
              title: copy.softTitle,
              text: fillPlaceholders(copy.setSmall, { size: describeSize(image), minimum: MINIMUM }),
            },
      );
    },
  });

  return (
    <Field label={copy.label} hint={fillPlaceholders(copy.hint, { minimum: MINIMUM })} error={error} grouped>
      <View style={styles.body}>
        {cover === null ? null : (
          <View style={styles.figure} testID="cover-preview">
            <Media src={cover.url} ratio="16/9" placeholder={placeholder} decorative />
            <View style={styles.caption}>
              <Caption testID="cover-size">
                {fillPlaceholders(
                  cover.mediaId !== null && cover.mediaId !== undefined && cover.mediaId !== ''
                    ? copy.sizeUploaded
                    : copy.size,
                  { size: describeSize(cover) },
                )}
              </Caption>
              <Pill
                label={copy.remove}
                variant="ghost"
                size="sm"
                disabled={disabled}
                onPress={() => {
                  setPlaceholder(null);
                  setNote(null);
                  onRemove();
                }}
                testID="cover-remove"
              />
            </View>
          </View>
        )}

        <ImageSourceControls source={source} copy={sourceCopy} disabled={disabled} testID="cover-source" />

        {source.stage === null && note !== null ? (
          <InlineAlert
            variant={note.tone}
            title={note.title}
            description={note.text}
            politeness="polite"
            testID="cover-note"
          />
        ) : null}
      </View>
    </Field>
  );
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
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
});
