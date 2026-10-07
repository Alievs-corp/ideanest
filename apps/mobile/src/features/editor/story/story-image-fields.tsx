import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { coverImageCopyFrom, type StoryBlocksCopy } from '@ideanest/campaign-editor/copy';
import { describeSize } from '@ideanest/campaign-editor/cover-image';
import type { ImageBlock } from '@ideanest/campaign-editor/story';
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
 */

/** The tallest the preview is drawn, so a portrait photo does not fill the editor. */
const PREVIEW_MAX_HEIGHT = 256;

export function StoryImageFields({
  copy,
  block,
  name,
  disabled,
  invalid,
  onChange,
  onFlush,
  testID,
}: {
  readonly copy: StoryCopy;
  readonly block: ImageBlock;
  /** The block's description, for every control's name. */
  readonly name: string;
  readonly disabled: boolean;
  readonly invalid: boolean;
  /** `sendNow` when there is no blur to wait for — a picture that just arrived. */
  readonly onChange: (block: ImageBlock, sendNow?: boolean) => void;
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
    // `useImageSource` keeps the newest of these, so the block it spreads is the current one.
    onImage: (image) => {
      setAdded(fillPlaceholders(blocks.measured, { size: describeSize(image) }));
      onChange({ ...block, url: image.url, width: image.width, height: image.height }, true);
    },
  });
  const altField = useRef<View>(null);
  const { reveal } = useStoryScroll();
  const measured = block.url !== '' && block.width > 0 && block.height > 0;

  return (
    <View style={styles.fields}>
      <ImageSourceControls source={source} copy={sourceCopy} disabled={disabled} testID={`${testID}-source`} />

      {added === null ? null : (
        <InlineAlert variant="success" politeness="polite" description={added} testID={`${testID}-added`} />
      )}

      {measured ? (
        <View style={styles.preview}>
          <View style={[styles.frame, { maxWidth: (PREVIEW_MAX_HEIGHT * block.width) / block.height }]}>
            <Media
              src={block.url}
              ratio={{ width: block.width, height: block.height }}
              fit="contain"
              radius="md"
              testID={`${testID}-preview`}
              {...(block.alt.trim() === '' ? { decorative: true as const } : { alt: block.alt })}
            />
          </View>
          <Caption testID={`${testID}-size`}>{copy.mobile('pixels', { size: describeSize(block) })}</Caption>
        </View>
      ) : null}

      <View ref={altField} style={styles.alt}>
        <TextInput
          value={block.alt}
          disabled={disabled}
          invalid={invalid && measured && block.alt.trim() === ''}
          accessibilityLabel={fillPlaceholders(blocks.descriptionOf, { name })}
          accessibilityHint={copy.mobile('altHint')}
          placeholder={blocks.imageAltPlaceholder}
          onChangeText={(alt) => onChange({ ...block, alt })}
          onFocus={() => reveal(altField.current)}
          onBlur={onFlush}
          testID={`${testID}-alt`}
        />
        <Caption accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {copy.mobile('altHint')}
        </Caption>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing[3] },
  preview: { gap: spacing[2] },
  frame: { width: '100%', alignSelf: 'center' },
  alt: { gap: spacing[2] },
});
