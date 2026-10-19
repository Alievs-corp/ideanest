import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { coverImageCopyFrom, type StoryBlocksCopy } from '@ideanest/campaign-editor/copy';
import { describeSize } from '@ideanest/campaign-editor/cover-image';
import { Caption, InlineAlert, Media, TextInput } from '../../../components/ui';
import { spacing } from '../../../theme';
import { ImageSourceControls, imageSourceCopyFrom, useImageSource, type ImageSourceCopy } from '../image-source';
import { useEditorTranslators } from '../translator';
import type { StoryCopy } from './story-copy';
import { useStoryScroll } from './story-scroll';

/**
 * An image block's fields (#162, "Images: pick and upload everywhere the web asks for an address").
 *
 * <p>The web takes only a published address here. A phone cannot practically produce one, so
 * the block offers the editor's shared image source: "Choose from library" and "Take a photo"
 * upload through the presigned flow (JPEG on the phone), and "Use an image address" measures a
 * typed address with "Measure and add". Either way the block stores what the contract's
 * `ImageBlock` holds — `url`, `width`, `height` — and the description, which is required.
 *
 * <p>The preview keeps the image's own shape, capped at 256pt tall, with "W×H pixels" under it.
 *
 * <p>A section's picture is drawn by the same fields: `value` is anything with the image block's
 * four fields, and what changes is spread back over it. A section that has no picture yet passes
 * `hideAltUntilMeasured`, so a description cannot be typed for a picture that does not exist.
 */

/** The tallest the preview is drawn, so a portrait photo does not fill the editor. */
const PREVIEW_MAX_HEIGHT = 256;

/** What an image block and a section's picture both hold. */
export interface StoryPicture {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

export function StoryImageFields<T extends StoryPicture>({
  copy,
  value,
  name,
  disabled,
  invalid,
  hideAltUntilMeasured = false,
  onChange,
  onFlush,
  testID,
}: {
  readonly copy: StoryCopy;
  readonly value: T;
  /** The block's description, for every control's name. */
  readonly name: string;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly hideAltUntilMeasured?: boolean;
  /** `sendNow` when there is no blur to wait for — a picture that just arrived. */
  readonly onChange: (value: T, sendNow?: boolean) => void;
  readonly onFlush: () => void;
  readonly testID: string;
}) {
  const { t } = useEditorTranslators();
  const blocks: StoryBlocksCopy = copy.story.blocks;
  const sourceCopy = useMemo<ImageSourceCopy>(
    () => ({
      ...imageSourceCopyFrom(coverImageCopyFrom(t)),
      needUrlFirst: blocks.needUrlFirst,
      unusable: blocks.notAnImage,
      urlLabel: fillPlaceholders(blocks.addressOf, { name }),
      urlPlaceholder: blocks.imageUrlPlaceholder,
      useAddress: blocks.measureAndAdd,
      checking: blocks.measuring,
    }),
    [t, blocks, name],
  );
  const [added, setAdded] = useState<string | null>(null);
  const source = useImageSource({
    copy: sourceCopy,
    // `useImageSource` keeps the newest of these, so the value it spreads is the current one.
    onImage: (image) => {
      setAdded(fillPlaceholders(blocks.measured, { size: describeSize(image) }));
      onChange({ ...value, url: image.url, width: image.width, height: image.height }, true);
    },
  });
  const altField = useRef<View>(null);
  const { reveal, release } = useStoryScroll();
  const measured = value.url !== '' && value.width > 0 && value.height > 0;

  return (
    <View style={styles.fields}>
      <ImageSourceControls
        source={source}
        copy={sourceCopy}
        disabled={disabled}
        onAddressFocus={reveal}
        onAddressBlur={release}
        testID={`${testID}-source`}
      />

      {added === null ? null : (
        <InlineAlert variant="success" politeness="polite" description={added} testID={`${testID}-added`} />
      )}

      {measured ? (
        <View style={styles.preview}>
          <View style={[styles.frame, { maxWidth: (PREVIEW_MAX_HEIGHT * value.width) / value.height }]}>
            <Media
              src={value.url}
              ratio={{ width: value.width, height: value.height }}
              fit="contain"
              radius="md"
              testID={`${testID}-preview`}
              {...(value.alt.trim() === '' ? { decorative: true as const } : { alt: value.alt })}
            />
          </View>
          <Caption testID={`${testID}-size`}>{fillPlaceholders(blocks.pixels, { size: describeSize(value) })}</Caption>
        </View>
      ) : null}

      {hideAltUntilMeasured && !measured ? null : (
        <View ref={altField} style={styles.alt}>
          <TextInput
            value={value.alt}
            disabled={disabled}
            invalid={invalid && measured && value.alt.trim() === ''}
            accessibilityLabel={fillPlaceholders(blocks.descriptionOf, { name })}
            accessibilityHint={blocks.altHint}
            placeholder={blocks.imageAltPlaceholder}
            onChangeText={(alt) => onChange({ ...value, alt })}
            onFocus={() => reveal(altField.current)}
            onBlur={() => {
              release(altField.current);
              onFlush();
            }}
            testID={`${testID}-alt`}
          />
          <Caption accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {blocks.altHint}
          </Caption>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing[3] },
  preview: { gap: spacing[2] },
  frame: { width: '100%', alignSelf: 'center' },
  alt: { gap: spacing[2] },
});
