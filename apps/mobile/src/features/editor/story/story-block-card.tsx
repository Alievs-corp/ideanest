import { memo, useCallback, useRef, useState, type ComponentProps } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from 'react-native';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import {
  EMBED_PROVIDERS,
  describeBlock,
  isEmbedProvider,
  parseSpans,
  renameHeading,
  spansToText,
  type EmbedBlock,
  type HeadingBlock,
  type ListBlock,
  type StoryBlock,
} from '@ideanest/campaign-editor/story';
import { Caption, Icon, IconButton, Meta, Pill, Select, TextInput } from '../../../components/ui';
import { Glyphs } from '../../../icons';
import { colors, radius, spacing } from '../../../theme';
import type { StoryCopy } from './story-copy';
import { StoryImageFields } from './story-image-fields';
import { useStoryScroll } from './story-scroll';
import { StoryTextField } from './story-text-field';

/**
 * One block of the story as a card (#162): the head — "Paragraph · 2 of 5", move up, move down
 * and a danger delete — then the block's own fields, then what is wrong with it, if anything.
 *
 * <p>The head is the card's accessible stop: it is named with the shared `describeBlock` ("Quote
 * 3 of 5: …") and carries the `moveUp` / `moveDown` / `delete` accessibility actions, so the
 * rotor (VoiceOver) and the actions menu (TalkBack) reorder and remove without hunting for the
 * buttons. The buttons stay visible and are the primary way; each one's name carries the block's
 * description, because eleven identical "Move up" buttons are no use by ear. They are disabled,
 * not removed, at the ends, so the count of controls per card never changes under a finger.
 *
 * <p>A block with a problem gets a danger border AND the sentence under it with a warning icon —
 * never the colour alone.
 */

export type MoveDirection = 'up' | 'down';

/**
 * What the panel hands every card. Each takes the card's `blockKey` rather than its index, so one
 * set of functions serves every card and stays the same object from render to render — which is
 * what lets `StoryBlockCard` skip re-rendering when another block is typed into.
 */
export interface StoryBlockHandlers {
  readonly change: (key: string, block: StoryBlock, sendNow?: boolean) => void;
  readonly move: (key: string, direction: MoveDirection) => void;
  readonly remove: (key: string) => void;
  readonly flush: () => void;
  /** Every OTHER heading's anchor, read when a heading is renamed rather than on every render. */
  readonly takenAnchors: (key: string) => readonly string[];
  readonly registerHead: (key: string, node: View | null) => void;
  readonly registerButton: (key: string, direction: MoveDirection, node: View | null) => void;
}

export interface StoryBlockCardProps {
  readonly copy: StoryCopy;
  /** The card's identity, which the document's blocks have none of. */
  readonly blockKey: string;
  readonly block: StoryBlock;
  readonly index: number;
  readonly total: number;
  readonly disabled: boolean;
  /** The client's or the server's sentence about this block, or null. */
  readonly problem: string | null;
  /** The block was just added: its first field takes focus. */
  readonly autoFocus: boolean;
  readonly handlers: StoryBlockHandlers;
  readonly testID: string;
}

/** A card re-renders only when its own block, place, state or words change. */
export const StoryBlockCard = memo(function StoryBlockCard({
  copy,
  blockKey,
  block,
  index,
  total,
  disabled,
  problem,
  autoFocus,
  handlers,
  testID,
}: StoryBlockCardProps) {
  const onChange = useCallback(
    (next: StoryBlock, sendNow?: boolean) => handlers.change(blockKey, next, sendNow),
    [handlers, blockKey],
  );
  const onMove = useCallback((direction: MoveDirection) => handlers.move(blockKey, direction), [handlers, blockKey]);
  const onRemove = useCallback(() => handlers.remove(blockKey), [handlers, blockKey]);
  const takenAnchors = useCallback(() => handlers.takenAnchors(blockKey), [handlers, blockKey]);
  const headRef = useCallback((node: View | null) => handlers.registerHead(blockKey, node), [handlers, blockKey]);
  const upRef = useCallback((node: View | null) => handlers.registerButton(blockKey, 'up', node), [handlers, blockKey]);
  const downRef = useCallback(
    (node: View | null) => handlers.registerButton(blockKey, 'down', node),
    [handlers, blockKey],
  );
  const onFlush = handlers.flush;
  const { blocks, vocabulary } = copy.story;
  const name = describeBlock(block, index, total, vocabulary);
  const position = fillPlaceholders(vocabulary.describe.position, {
    index: String(index + 1),
    total: String(total),
  });
  const canUp = index > 0;
  const canDown = index < total - 1;
  const moveUp = fillPlaceholders(blocks.moveUp, { name });
  const moveDown = fillPlaceholders(blocks.moveDown, { name });
  const remove = fillPlaceholders(blocks.remove, { name });

  const actions: AccessibilityActionInfo[] = [];
  if (!disabled && canUp) actions.push({ name: 'moveUp', label: moveUp });
  if (!disabled && canDown) actions.push({ name: 'moveDown', label: moveDown });
  if (!disabled) actions.push({ name: 'delete', label: remove });

  function act(event: AccessibilityActionEvent): void {
    const action = event.nativeEvent.actionName;
    if (action === 'moveUp' && canUp) onMove('up');
    else if (action === 'moveDown' && canDown) onMove('down');
    else if (action === 'delete') onRemove();
  }

  return (
    <View style={[styles.card, problem === null ? styles.calm : styles.wrong]} testID={testID}>
      <View style={styles.head}>
        <View
          ref={headRef}
          style={styles.title}
          accessible
          accessibilityRole="header"
          accessibilityLabel={name}
          accessibilityActions={actions}
          onAccessibilityAction={act}
          testID={`${testID}-head`}
        >
          <Meta tone="secondary">
            {vocabulary.blockLabel[block.type]}
            <Meta tone="tertiary">{` · ${position}`}</Meta>
          </Meta>
        </View>
        <View style={styles.buttons}>
          <IconButton
            ref={upRef}
            icon={Glyphs.ArrowUp}
            label={moveUp}
            variant="ghost"
            size="sm"
            disabled={disabled || !canUp}
            onPress={() => onMove('up')}
            testID={`${testID}-up`}
          />
          <IconButton
            ref={downRef}
            icon={Glyphs.ArrowDown}
            label={moveDown}
            variant="ghost"
            size="sm"
            disabled={disabled || !canDown}
            onPress={() => onMove('down')}
            testID={`${testID}-down`}
          />
          <IconButton
            icon={Glyphs.Trash}
            label={remove}
            variant="danger"
            size="sm"
            disabled={disabled}
            onPress={onRemove}
            testID={`${testID}-remove`}
          />
        </View>
      </View>

      <BlockFields
        copy={copy}
        block={block}
        name={name}
        disabled={disabled}
        invalid={problem !== null}
        problem={problem}
        takenAnchors={takenAnchors}
        autoFocus={autoFocus}
        onChange={onChange}
        onFlush={onFlush}
        testID={testID}
      />

      {problem === null ? null : (
        <View style={styles.problem} testID={`${testID}-problem`}>
          <Icon icon={Glyphs.Warning2} size={16} color={colors.danger} />
          <Caption style={styles.problemText}>{problem}</Caption>
        </View>
      )}
    </View>
  );
});

/* -------------------------------------------------------------------------
 * The fields of each kind of block
 * ---------------------------------------------------------------------- */

interface FieldsProps {
  readonly copy: StoryCopy;
  readonly block: StoryBlock;
  readonly name: string;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly problem: string | null;
  readonly takenAnchors: () => readonly string[];
  readonly autoFocus: boolean;
  readonly onChange: (block: StoryBlock, sendNow?: boolean) => void;
  readonly onFlush: () => void;
  readonly testID: string;
}

function BlockFields(props: FieldsProps) {
  const { copy, block, name, disabled, invalid, problem, autoFocus, onChange, onFlush, testID } = props;
  const blocks = copy.story.blocks;
  switch (block.type) {
    case 'paragraph':
    case 'quote':
      return (
        <StoryTextField
          toolbar={copy.story.toolbar}
          value={spansToText(block.spans)}
          label={name}
          placeholder={block.type === 'quote' ? blocks.quoteHint : blocks.paragraphHint}
          disabled={disabled}
          invalid={invalid}
          accessibilityHint={problem ?? undefined}
          autoFocus={autoFocus}
          onChange={(text) => onChange({ ...block, spans: parseSpans(text) })}
          onBlur={onFlush}
          testID={`${testID}-text`}
        />
      );
    case 'heading':
      return <HeadingFields {...props} block={block} />;
    case 'list':
      return <ListFields {...props} block={block} />;
    case 'rule':
      return (
        <View style={styles.rule}>
          {/* Decorative here as in the story: the card's name already says a divider is there. */}
          <View style={styles.line} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <Caption>{blocks.ruleHint}</Caption>
        </View>
      );
    case 'image':
      return (
        <StoryImageFields
          copy={copy}
          block={block}
          name={name}
          disabled={disabled}
          invalid={invalid}
          onChange={onChange}
          onFlush={onFlush}
          testID={testID}
        />
      );
    case 'embed':
      return <EmbedFields {...props} block={block} />;
  }
}

/** A text input that brings itself into view when it takes focus, and lets go when it loses it. */
function RevealingInput(props: ComponentProps<typeof TextInput>) {
  const holder = useRef<View>(null);
  const { reveal, release } = useStoryScroll();
  const { onFocus, onBlur } = props;
  return (
    <View ref={holder}>
      <TextInput
        {...props}
        onFocus={(event) => {
          reveal(holder.current);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          release(holder.current);
          onBlur?.(event);
        }}
      />
    </View>
  );
}

function HeadingFields({
  copy,
  block,
  name,
  disabled,
  invalid,
  problem,
  takenAnchors,
  autoFocus,
  onChange,
  onFlush,
  testID,
}: FieldsProps & { readonly block: HeadingBlock }) {
  const blocks = copy.story.blocks;
  return (
    <View style={styles.fields}>
      <Select
        label={fillPlaceholders(blocks.levelOf, { name })}
        options={[
          { value: '2', label: blocks.section },
          { value: '3', label: blocks.subsection },
        ]}
        value={String(block.level)}
        disabled={disabled}
        onChange={(level) => onChange({ ...block, level: level === '3' ? 3 : 2 }, true)}
        testID={`${testID}-level`}
      />
      <RevealingInput
        value={block.text}
        disabled={disabled}
        invalid={invalid}
        accessibilityLabel={fillPlaceholders(blocks.textOf, { name })}
        accessibilityHint={problem ?? undefined}
        placeholder={blocks.headingPlaceholder}
        autoFocus={autoFocus}
        onChangeText={(text) => onChange(renameHeading(block, text, takenAnchors()))}
        onBlur={onFlush}
        testID={`${testID}-heading`}
      />
    </View>
  );
}

function ListFields({
  copy,
  block,
  name,
  disabled,
  autoFocus,
  onChange,
  onFlush,
  testID,
}: FieldsProps & { readonly block: ListBlock }) {
  const blocks = copy.story.blocks;
  /** The item just added, which takes focus as it mounts. */
  const [added, setAdded] = useState<number | null>(autoFocus ? 0 : null);
  const count = block.items.length;

  return (
    <View style={styles.fields}>
      <Select
        label={fillPlaceholders(blocks.styleOf, { name })}
        options={[
          { value: 'bulleted', label: blocks.bulleted },
          { value: 'ordered', label: blocks.numbered },
        ]}
        value={block.ordered ? 'ordered' : 'bulleted'}
        disabled={disabled}
        onChange={(style) => onChange({ ...block, ordered: style === 'ordered' }, true)}
        testID={`${testID}-style`}
      />

      {block.items.map((item, at) => {
        const words = { at: String(at + 1), count: String(count), name };
        return (
          // The index is the item's identity here: items have none of their own, and a key from
          // the content would remount the field being typed into on every keystroke.
          <View key={at} style={styles.item}>
            <View style={styles.itemText}>
              <StoryTextField
                toolbar={copy.story.toolbar}
                value={spansToText(item)}
                label={fillPlaceholders(blocks.itemOf, words)}
                disabled={disabled}
                autoFocus={added === at}
                onChange={(text) =>
                  onChange({
                    ...block,
                    items: block.items.map((existing, index) => (index === at ? parseSpans(text) : existing)),
                  })
                }
                onBlur={onFlush}
                testID={`${testID}-item-${at}`}
              />
            </View>
            <IconButton
              icon={Glyphs.Trash}
              label={fillPlaceholders(blocks.removeItemOf, words)}
              variant="ghost"
              size="sm"
              // The last item stays: a list with nothing in it presents nothing to edit.
              disabled={disabled || count === 1}
              onPress={() => {
                setAdded(null);
                onChange({ ...block, items: block.items.filter((_, index) => index !== at) }, true);
              }}
              testID={`${testID}-item-${at}-remove`}
            />
          </View>
        );
      })}

      <View style={styles.start}>
        <Pill
          label={blocks.addItem}
          accessibilityLabel={fillPlaceholders(blocks.addItemTo, { name })}
          iconLeft={Glyphs.Add}
          variant="ghost"
          size="sm"
          disabled={disabled}
          onPress={() => {
            setAdded(count);
            onChange({ ...block, items: [...block.items, []] });
          }}
          testID={`${testID}-add-item`}
        />
      </View>
    </View>
  );
}

function EmbedFields({
  copy,
  block,
  name,
  disabled,
  invalid,
  problem,
  autoFocus,
  onChange,
  onFlush,
  testID,
}: FieldsProps & { readonly block: EmbedBlock }) {
  const blocks = copy.story.blocks;
  return (
    <View style={styles.fields}>
      <Select
        label={fillPlaceholders(blocks.providerOf, { name })}
        options={EMBED_PROVIDERS.map((provider) => ({
          value: provider,
          label: copy.mobile(`providers.${provider}`),
        }))}
        value={block.provider}
        disabled={disabled}
        onChange={(provider) => {
          // Narrowed rather than cast: the options are ours, but a picked value is a string.
          if (isEmbedProvider(provider)) onChange({ ...block, provider }, true);
        }}
        testID={`${testID}-provider`}
      />
      <RevealingInput
        value={block.url}
        disabled={disabled}
        invalid={invalid && block.url.trim() === '' ? true : undefined}
        accessibilityLabel={fillPlaceholders(blocks.addressOf, { name })}
        accessibilityHint={problem ?? undefined}
        placeholder={blocks.embedUrlPlaceholder}
        keyboardType="url"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        autoFocus={autoFocus}
        onChangeText={(url) => onChange({ ...block, url })}
        onBlur={onFlush}
        testID={`${testID}-url`}
      />
      <RevealingInput
        value={block.title}
        disabled={disabled}
        invalid={invalid && block.url.trim() !== '' && block.title.trim() === '' ? true : undefined}
        accessibilityLabel={fillPlaceholders(blocks.titleOf, { name })}
        accessibilityHint={copy.mobile('embedHint')}
        placeholder={blocks.embedTitlePlaceholder}
        onChangeText={(title) => onChange({ ...block, title })}
        onBlur={onFlush}
        testID={`${testID}-title`}
      />
      <Caption accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {copy.mobile('embedHint')}
      </Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  calm: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  wrong: { borderWidth: 1, borderColor: colors.danger },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: { flex: 1, minHeight: 44, justifyContent: 'center' },
  // 32pt buttons with 44pt targets: 12pt between them keeps the targets from overlapping, so a
  // finger meant for "move down" cannot land on "delete".
  buttons: { flexDirection: 'row', gap: spacing[3] },
  fields: { gap: spacing[3] },
  rule: { gap: spacing[2] },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  itemText: { flex: 1 },
  start: { alignSelf: 'flex-start' },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  problemText: { flex: 1, color: colors.danger },
});
