import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import { basicsPanelCopyFrom, type RewardsPanelCopy } from '@ideanest/campaign-editor/copy';
import { characterCount } from '@ideanest/campaign-editor/basics';
import type { Item } from '@ideanest/campaign-editor/contract';
import {
  EMPTY_ITEM,
  ITEM_NAME_MAX_CHARACTERS,
  ITEM_SKU_MAX_CHARACTERS,
  fieldErrorsFrom,
  isEmptyPatch,
  isItemField,
  itemDraftFrom,
  itemPatchFrom,
  newItemFrom,
  validateItem,
  type ItemDraft,
  type ItemErrors,
} from '@ideanest/campaign-editor/rewards';
import {
  Caption,
  CharacterCount,
  Field,
  InlineAlert,
  Media,
  Pill,
  Switch,
  TextInput,
  Textarea,
} from '../../../components/ui';
import { useT } from '../../../lib/i18n';
import { colors, radius, spacing } from '../../../theme';
import { EditorModal } from '../editor-modal';
import { ImageSourceControls, imageSourceCopyFrom, useImageSource } from '../image-source';
import { useEditorTranslators } from '../translator';
import { useDescribeFailure } from '../use-describe-failure';
import { createItem, patchItem } from './api';

/**
 * The web's `ItemEditor`, as a full-screen `EditorModal` (#162): one physical or digital thing a
 * reward is built from.
 *
 * <p>It saves when the creator presses Save, never on a pause in typing: creating an item is a
 * `POST`, and a debounced `POST` would publish an item called "Mu". An edit sends only the fields
 * that changed (`itemPatchFrom`), and an unchanged form sends nothing. The client's own refusals
 * (`validateItem`, in the catalogue's words) appear once Save has been pressed; the service's
 * appear as soon as they arrive, on their fields through `fieldErrorsFrom`. While the request is
 * in the air the modal cannot be dismissed.
 *
 * <p>The image is picked from the library, taken with the camera, or given as an address (#162,
 * "Native decisions: Images") — the web is address-only, but a phone has no practical way to
 * produce one. The upload's `url` is what the item stores as `imageUrl`.
 *
 * <p>Mount it with a fresh `key` each time it opens, so the form is seeded from `item` once.
 */
export interface ItemEditorProps {
  readonly visible: boolean;
  readonly projectId: string;
  /** The item being edited, or null to add one. */
  readonly item: Item | null;
  readonly copy: RewardsPanelCopy;
  /** Offline: nothing can be sent. */
  readonly readOnly: boolean;
  readonly onClose: () => void;
  /** The service's answer, which is the authority on what the item now is. */
  readonly onSaved: (item: Item) => void;
}

export function ItemEditor({ visible, projectId, item, copy, readOnly, onClose, onSaved }: ItemEditorProps) {
  const words = copy.item;
  const t = useT('mobile.editor.rewards');
  const { t: editorT } = useEditorTranslators();
  const describe = useDescribeFailure();
  const imageCopy = useMemo(() => imageSourceCopyFrom(basicsPanelCopyFrom(editorT).cover), [editorT]);

  const [seed] = useState<ItemDraft>(() => (item === null ? EMPTY_ITEM : itemDraftFrom(item)));
  const [draft, setDraft] = useState<ItemDraft>(seed);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [attempted, setAttempted] = useState(false);

  const image = useImageSource({
    copy: imageCopy,
    onImage: (chosen) => setDraft((current) => ({ ...current, imageUrl: chosen.url })),
  });

  const errors = validateItem(draft, copy.vocabulary.item);
  const visibleErrors: ItemErrors = { ...(attempted ? errors : {}), ...fieldErrorsFrom(failure, isItemField) };
  const invalid = Object.keys(errors).length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(seed);

  async function save(): Promise<void> {
    setAttempted(true);
    if (invalid || readOnly) return;
    setSaving(true);
    setFailure(null);
    try {
      if (item === null) {
        onSaved(await createItem(projectId, newItemFrom(draft)));
      } else {
        const patch = itemPatchFrom(draft, item);
        // Nothing changed, so nothing is sent: a write of the same values still moves `updated_at`.
        if (!isEmptyPatch(patch)) onSaved(await patchItem(item.id, patch));
      }
      setSaving(false);
      onClose();
    } catch (cause) {
      setFailure(describe(cause));
      setSaving(false);
    }
  }

  return (
    <EditorModal
      visible={visible}
      title={item === null ? words.addTitle : words.editTitle}
      description={words.drawerDescription}
      dirty={dirty}
      saving={saving}
      saveDisabled={readOnly || image.busy}
      onSave={() => void save()}
      onClose={onClose}
      testID="item-editor"
    >
      {failure === null ? null : (
        <InlineAlert
          variant="danger"
          title={words.notSavedTitle}
          description={failure.message}
          testID="item-editor-failure"
          action={<Caption>{t('notSavedDetail')}</Caption>}
        />
      )}

      <Field
        label={words.name}
        required
        hint={fillPlaceholders(words.nameHint, { max: String(ITEM_NAME_MAX_CHARACTERS) })}
        error={visibleErrors.name}
      >
        <TextInput
          value={draft.name}
          autoComplete="off"
          onChangeText={(name) => setDraft({ ...draft, name })}
          testID="item-name"
        />
        <CharacterCount count={characterCount(draft.name)} limit={ITEM_NAME_MAX_CHARACTERS} />
      </Field>

      <Field label={words.description} hint={words.descriptionHint} error={visibleErrors.description}>
        <Textarea
          value={draft.description}
          numberOfLines={3}
          onChangeText={(description) => setDraft({ ...draft, description })}
          testID="item-description"
        />
      </Field>

      <Field label={t('image')} hint={t('imageHint')} error={visibleErrors.imageUrl} grouped>
        {draft.imageUrl === '' ? null : (
          <View style={styles.image}>
            <View style={styles.preview}>
              <Media src={draft.imageUrl} ratio="1/1" radius="md" decorative testID="item-image-preview" />
            </View>
            <View style={styles.start}>
              <Pill
                label={t('imageRemove')}
                variant="ghost"
                size="sm"
                disabled={image.busy}
                onPress={() => setDraft({ ...draft, imageUrl: '' })}
                testID="item-image-remove"
              />
            </View>
          </View>
        )}
        <ImageSourceControls source={image} copy={imageCopy} testID="item-image" />
      </Field>

      <View style={styles.card}>
        <Switch
          label={words.isDigital}
          description={words.isDigitalHint}
          value={draft.isDigital}
          // A file has no shipping weight: the database refuses the pair, so the weight goes too.
          onValueChange={(isDigital) =>
            setDraft({ ...draft, isDigital, weightGrams: isDigital ? '' : draft.weightGrams })
          }
          testID="item-digital"
        />
      </View>

      <Field
        label={words.weight}
        hint={draft.isDigital ? words.weightHintDigital : t('weightHint')}
        error={visibleErrors.weightGrams}
      >
        <TextInput
          value={draft.weightGrams}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="off"
          disabled={draft.isDigital}
          onChangeText={(weightGrams) => setDraft({ ...draft, weightGrams })}
          testID="item-weight"
        />
      </Field>

      <Field label={words.sku} hint={words.skuHint} error={visibleErrors.sku}>
        <TextInput
          value={draft.sku}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={(sku) => setDraft({ ...draft, sku })}
          testID="item-sku"
        />
        <CharacterCount count={characterCount(draft.sku)} limit={ITEM_SKU_MAX_CHARACTERS} />
      </Field>
    </EditorModal>
  );
}

const styles = StyleSheet.create({
  image: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  preview: { width: 96 },
  start: { alignSelf: 'center' },
  card: {
    padding: spacing[5],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
