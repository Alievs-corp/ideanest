import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { pluralise } from '@ideanest/messages/plurals';
import { DEFAULT_CURRENCY } from '@ideanest/money';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import { characterCount, fromDateTimeLocal, toDateTimeLocal } from '@ideanest/campaign-editor/basics';
import type { Item, ProjectEdit, Reward } from '@ideanest/campaign-editor/contract';
import type { RewardsPanelCopy } from '@ideanest/campaign-editor/copy';
import {
  REWARD_TITLE_MAX_CHARACTERS,
  SHIPPING_SCOPES,
  emptyReward,
  fieldErrorsFrom,
  isEmptyPatch,
  isRewardField,
  isShippedScope,
  isShippingType,
  newRewardFrom,
  rewardDraftFrom,
  rewardPatchFrom,
  shippingRatesChanged,
  shippingRatesFrom,
  validateReward,
  type RewardDraft,
  type RewardErrors,
  type RewardLineDraft,
  type ShippingRateDraft,
} from '@ideanest/campaign-editor/rewards';
import {
  Body,
  Caption,
  CharacterCount,
  Field,
  IconButton,
  InlineAlert,
  Pill,
  Select,
  Subheading,
  Switch,
  TextInput,
  Textarea,
  announce,
} from '../../../components/ui';
import { Glyphs } from '../../../icons';
import { useT } from '../../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../../theme';
import { DateTimeField } from '../date-time-field';
import { EditorModal } from '../editor-modal';
import { MoneyField } from '../money-field';
import { useDescribeFailure } from '../use-describe-failure';
import { createReward, patchReward, replaceShippingRules } from './api';

/**
 * The web's `RewardTierEditor`, as a full-screen `EditorModal` (#162): what a backer selects and
 * pays for.
 *
 * <h2>Saved when the creator says so</h2>
 *
 * A half-typed price is a different valid price and a tier is created by a `POST`, so nothing is
 * sent until Save. The client's refusals (`validateReward`: the title, the price through
 * `parseAmount`, places never below what is claimed plus reserved, the early-bird rule, the window,
 * the composition, the rate table) show after the first Save; the service's land on their fields
 * through `fieldErrorsFrom`. While saving, the modal cannot be dismissed.
 *
 * <h2>Two requests, and the second can fail alone</h2>
 *
 * The tier is created (`POST`) or patched with only what changed (`rewardPatchFrom`; nothing when
 * nothing did); then, only when the rate table changed, `PUT …/shipping-rules` replaces it. When
 * the tier was stored and only the rates were refused, the modal stays open with "The shipping
 * rates were not saved", and it remembers the stored tier — so the next Save patches it rather than
 * creating a second one, and the rest is not sent twice.
 *
 * <h2>Money</h2>
 *
 * The price and both rates are text in `MoneyField`s (the comma rule) and become wire strings only
 * through the package (`newRewardFrom`, `rewardPatchFrom`, `shippingRatesFrom`, all `parseAmount` /
 * `toWireAmount`); rates accept 0. No amount is ever a JavaScript number.
 *
 * <p>Mount it with a fresh `key` each time it opens, so the form is seeded once.
 */
export interface RewardEditorProps {
  readonly visible: boolean;
  readonly project: ProjectEdit;
  readonly reward: Reward | null;
  readonly items: readonly Item[];
  readonly copy: RewardsPanelCopy;
  readonly readOnly: boolean;
  readonly onClose: () => void;
  readonly onSaved: (reward: Reward) => void;
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function RewardEditor({ visible, project, reward, items, copy, readOnly, onClose, onSaved }: RewardEditorProps) {
  const words = copy.tier;
  const vocabulary = copy.vocabulary;
  const t = useT('mobile.editor.rewards');
  const describe = useDescribeFailure();
  const currency = project.goal?.currency ?? DEFAULT_CURRENCY;

  const [seed] = useState<RewardDraft>(() => (reward === null ? emptyReward(currency) : rewardDraftFrom(reward)));
  const [draft, setDraft] = useState<RewardDraft>(seed);
  /** The tier as the service last confirmed it: null until a new one has been created. */
  const [target, setTarget] = useState<Reward | null>(reward);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [ratesUnsaved, setRatesUnsaved] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  // Places may always go up, and down only to what is already taken (claimed plus reserved).
  const committedQuantity = target === null ? 0 : target.claimedQuantity + target.reservedQuantity;
  const errors = validateReward(draft, vocabulary.reward, { committedQuantity });
  const visibleErrors: RewardErrors = { ...(attempted ? errors : {}), ...fieldErrorsFrom(failure, isRewardField) };
  const invalid = Object.keys(errors).length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(seed);
  const priceLocked = target?.pricingLocked ?? false;
  /*
   * The table shows while the tier is shipped — and also while rates are left over from when it
   * was, because `validateReward` refuses rates on a tier that is not shipped, and a refusal
   * about a table that is not on screen is a Save that silently does nothing.
   */
  const shipped = isShippedScope(draft.shippingType) || draft.shippingRules.length > 0;

  async function save(): Promise<void> {
    setAttempted(true);
    if (invalid || readOnly) return;
    setSaving(true);
    setFailure(null);
    setRatesUnsaved(false);

    let stored: Reward | null = target;
    try {
      if (target === null) {
        stored = await createReward(project.id, newRewardFrom(draft));
      } else {
        const patch = rewardPatchFrom(draft, target);
        if (!isEmptyPatch(patch)) stored = await patchReward(target.id, patch);
      }
    } catch (cause) {
      setFailure(describe(cause));
      setSaving(false);
      return;
    }

    if (stored !== null && stored !== target) {
      setTarget(stored);
      onSaved(stored);
    }

    const rates = shippingRatesFrom(draft);
    const needsRates = target === null ? rates.length > 0 : shippingRatesChanged(draft, target);
    if (needsRates && stored !== null) {
      try {
        const repriced = await replaceShippingRules(stored.id, rates);
        setTarget(repriced);
        onSaved(repriced);
      } catch (cause) {
        // The tier is stored; only the table was refused. Stay open, keep everything typed.
        setRatesUnsaved(true);
        setFailure(describe(cause));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onClose();
  }

  function setLine(index: number, next: RewardLineDraft): void {
    setDraft({ ...draft, items: draft.items.map((old, at) => (at === index ? next : old)) });
  }

  function setRate(index: number, next: ShippingRateDraft): void {
    setDraft({ ...draft, shippingRules: draft.shippingRules.map((old, at) => (at === index ? next : old)) });
  }

  async function copyToken(token: string): Promise<void> {
    setCopied('idle');
    let ok = false;
    try {
      ok = await Clipboard.setStringAsync(token);
    } catch {
      ok = false;
    }
    setCopied(ok ? 'copied' : 'failed');
    if (ok) announce(t('tokenCopied'));
  }

  const chosen = new Set(draft.items.map((line) => line.itemId));
  const available = items.filter((item) => !chosen.has(item.id));

  return (
    <EditorModal
      visible={visible}
      title={target === null ? words.addTitle : words.editTitle}
      description={words.description}
      dirty={dirty}
      saving={saving}
      saveDisabled={readOnly}
      onSave={() => void save()}
      onClose={onClose}
      testID="reward-editor"
    >
      {failure === null ? null : (
        <InlineAlert
          variant="danger"
          title={ratesUnsaved ? words.ratesNotSavedTitle : words.notSavedTitle}
          description={failure.message}
          testID="reward-editor-failure"
          action={<Caption>{ratesUnsaved ? t('ratesNotSavedDetail') : t('notSavedDetail')}</Caption>}
        />
      )}

      <Field
        label={words.title}
        required
        hint={fillPlaceholders(words.titleHint, { max: String(REWARD_TITLE_MAX_CHARACTERS) })}
        error={visibleErrors.title}
      >
        <TextInput
          value={draft.title}
          autoComplete="off"
          onChangeText={(title) => setDraft({ ...draft, title })}
          testID="reward-title"
        />
        <CharacterCount count={characterCount(draft.title)} limit={REWARD_TITLE_MAX_CHARACTERS} />
      </Field>

      <Field label={words.summary} hint={words.summaryHint} error={visibleErrors.description}>
        <Textarea
          value={draft.description}
          numberOfLines={3}
          onChangeText={(description) => setDraft({ ...draft, description })}
          testID="reward-description"
        />
      </Field>

      <Field
        label={words.price}
        required
        hint={fillPlaceholders(priceLocked ? words.priceHintLocked : words.priceHint, { currency })}
        error={visibleErrors.price}
      >
        <MoneyField
          value={draft.priceAmount}
          currency={currency}
          disabled={priceLocked}
          onChangeText={(priceAmount) => setDraft({ ...draft, priceAmount })}
          testID="reward-price"
        />
      </Field>

      <Field label={words.estimatedDelivery} hint={words.estimatedDeliveryHint} error={visibleErrors.estimatedDelivery}>
        <DateTimeField
          mode="date"
          label={words.estimatedDelivery}
          value={draft.estimatedDelivery === '' ? null : draft.estimatedDelivery}
          onChange={(day) => setDraft({ ...draft, estimatedDelivery: day ?? '' })}
          testID="reward-delivery-date"
        />
      </Field>

      <Field
        label={words.places}
        hint={
          committedQuantity > 0 ? pluralise(words.locale, words.placesHintCommitted, committedQuantity) : words.placesHint
        }
        error={visibleErrors.limitQuantity}
      >
        <TextInput
          value={draft.limitQuantity}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="off"
          onChangeText={(limitQuantity) => setDraft({ ...draft, limitQuantity })}
          testID="reward-places"
        />
      </Field>

      <Field label={words.delivery} hint={vocabulary.scopes[draft.shippingType].hint} error={visibleErrors.shippingType}>
        <Select
          options={SHIPPING_SCOPES.map((scope) => ({
            value: scope,
            label: vocabulary.scopes[scope].label,
            description: vocabulary.scopes[scope].hint,
          }))}
          value={draft.shippingType}
          onChange={(scope) => {
            if (isShippingType(scope)) setDraft({ ...draft, shippingType: scope });
          }}
          testID="reward-delivery"
        />
      </Field>

      {shipped ? (
        <Field
          grouped
          label={words.shipping}
          hint={fillPlaceholders(words.ratesHint, { currency })}
          error={visibleErrors.rules}
          testID="reward-rates"
        >
          {draft.shippingRules.length === 0 ? <Caption>{words.noDestinations}</Caption> : null}
          {draft.shippingRules.map((rule, index) => {
            const code = rule.countryCode.trim().toUpperCase();
            const name = code === '' ? t('destination', { position: String(index + 1) }) : code;
            return (
              // Keyed by position: a destination starts empty and two rows may briefly share a code.
              <View key={index} style={styles.row} testID={`reward-rate-${index}`}>
                <View style={styles.rowTop}>
                  <View style={styles.grow}>
                    <TextInput
                      value={rule.countryCode}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      autoComplete="off"
                      maxLength={2}
                      placeholder={words.countryPlaceholder}
                      accessibilityLabel={fillPlaceholders(words.countryCodeFor, { name })}
                      onChangeText={(countryCode) => setRate(index, { ...rule, countryCode })}
                      testID={`reward-rate-${index}-country`}
                    />
                  </View>
                  <IconButton
                    icon={Glyphs.Trash}
                    label={fillPlaceholders(words.removeNamed, { name })}
                    variant="ghost"
                    onPress={() =>
                      setDraft({ ...draft, shippingRules: draft.shippingRules.filter((_, at) => at !== index) })
                    }
                    testID={`reward-rate-${index}-remove`}
                  />
                </View>
                <View style={styles.amounts}>
                  <View style={styles.grow}>
                    <Caption accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      {words.ratePlaceholder}
                    </Caption>
                    <MoneyField
                      value={rule.amount}
                      currency={currency}
                      accessibilityLabel={fillPlaceholders(words.shippingRateTo, { name })}
                      onChangeText={(amount) => setRate(index, { ...rule, amount })}
                      testID={`reward-rate-${index}-amount`}
                    />
                  </View>
                  <View style={styles.grow}>
                    <Caption accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      {words.extraPlaceholder}
                    </Caption>
                    <MoneyField
                      value={rule.additionalItemAmount}
                      currency={currency}
                      accessibilityLabel={fillPlaceholders(words.additionalRateTo, { name })}
                      onChangeText={(additionalItemAmount) => setRate(index, { ...rule, additionalItemAmount })}
                      testID={`reward-rate-${index}-extra`}
                    />
                  </View>
                </View>
              </View>
            );
          })}
          <View style={styles.start}>
            <Pill
              label={words.addDestination}
              iconLeft={Glyphs.Add}
              variant="ghost"
              size="sm"
              onPress={() =>
                setDraft({
                  ...draft,
                  shippingRules: [...draft.shippingRules, { countryCode: '', amount: '', additionalItemAmount: '0.00' }],
                })
              }
              testID="reward-rate-add"
            />
          </View>
        </Field>
      ) : null}

      <Field grouped label={words.contents} hint={words.contentsHint} error={visibleErrors.items} testID="reward-contents">
        {draft.items.map((entry, index) => {
          const name = items.find((item) => item.id === entry.itemId)?.name ?? words.missingItem;
          return (
            <View key={entry.itemId} style={[styles.row, styles.line]} testID={`reward-line-${index}`}>
              <Body style={styles.grow} numberOfLines={2}>
                {name}
              </Body>
              <Text style={styles.times} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                ×
              </Text>
              <View style={styles.quantity}>
                <TextInput
                  value={entry.quantity}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  autoComplete="off"
                  accessibilityLabel={fillPlaceholders(words.quantityOf, { name })}
                  onChangeText={(quantity) => setLine(index, { ...entry, quantity })}
                  testID={`reward-line-${index}-quantity`}
                />
              </View>
              <IconButton
                icon={Glyphs.Trash}
                label={fillPlaceholders(words.removeFromReward, { name })}
                variant="ghost"
                onPress={() => setDraft({ ...draft, items: draft.items.filter((_, at) => at !== index) })}
                testID={`reward-line-${index}-remove`}
              />
            </View>
          );
        })}
        {available.length > 0 ? (
          <Select
            options={available.map((item) => ({ value: item.id, label: item.name }))}
            value={null}
            label={words.addItem}
            placeholder={words.addItemPlaceholder}
            onChange={(itemId) => setDraft({ ...draft, items: [...draft.items, { itemId, quantity: '1' }] })}
            testID="reward-add-item"
          />
        ) : (
          <Caption>{draft.items.length === 0 ? words.noItemsYet : words.everyItemAdded}</Caption>
        )}
      </Field>

      <Field label={words.opens} hint={words.opensHint} error={visibleErrors.availableFrom}>
        <DateTimeField
          label={words.opens}
          value={fromDateTimeLocal(draft.availableFrom)}
          onChange={(instant) => setDraft({ ...draft, availableFrom: toDateTimeLocal(instant) })}
          testID="reward-opens"
        />
      </Field>

      <Field label={words.closes} hint={words.closesHint} error={visibleErrors.availableUntil}>
        <DateTimeField
          label={words.closes}
          value={fromDateTimeLocal(draft.availableUntil)}
          onChange={(instant) => setDraft({ ...draft, availableUntil: toDateTimeLocal(instant) })}
          testID="reward-closes"
        />
      </Field>

      <View style={styles.card} testID="reward-offering">
        <Subheading accessibilityRole="header">{words.offering}</Subheading>

        <View style={styles.option}>
          <Switch
            label={words.earlyBird}
            description={t('earlyBirdHint')}
            value={draft.isEarlyBird}
            onValueChange={(isEarlyBird) => setDraft({ ...draft, isEarlyBird })}
            testID="reward-early-bird"
          />
          {visibleErrors.isEarlyBird === undefined ? null : (
            <InlineAlert variant="danger" description={visibleErrors.isEarlyBird} testID="reward-early-bird-error" />
          )}
        </View>

        <View style={styles.option}>
          <Switch
            label={words.featured}
            description={words.featuredHint}
            value={draft.isFeatured}
            onValueChange={(isFeatured) => setDraft({ ...draft, isFeatured })}
            testID="reward-featured"
          />
          {visibleErrors.isFeatured === undefined ? null : (
            <InlineAlert variant="danger" description={visibleErrors.isFeatured} testID="reward-featured-error" />
          )}
        </View>

        <View style={styles.option}>
          <Switch
            label={words.secret}
            description={t('secretHint')}
            value={draft.isSecret}
            onValueChange={(isSecret) => setDraft({ ...draft, isSecret })}
            testID="reward-secret"
          />
          {/* The service's to mint: read from the stored tier, never from the draft. */}
          {target?.isSecret === true && target.secretToken != null && target.secretToken !== '' ? (
            <View style={styles.token} testID="reward-token">
              <Caption>{words.token}</Caption>
              <Text selectable style={styles.tokenText}>
                {target.secretToken}
              </Text>
              <View style={styles.start}>
                <Pill
                  label={copied === 'copied' ? t('copied') : t('copyToken')}
                  iconLeft={copied === 'copied' ? Glyphs.Tick : Glyphs.Copy}
                  variant="ghost"
                  size="sm"
                  onPress={() => void copyToken(target.secretToken ?? '')}
                  testID="reward-token-copy"
                />
              </View>
              {copied === 'failed' ? (
                <InlineAlert variant="danger" description={t('copyFailed')} testID="reward-token-failed" />
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.option}>
          <Switch
            label={words.addOn}
            description={words.addOnHint}
            value={draft.isAddon}
            onValueChange={(isAddon) => setDraft({ ...draft, isAddon })}
            testID="reward-add-on"
          />
        </View>
      </View>
    </EditorModal>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: spacing[1] },
  start: { alignSelf: 'flex-start' },
  row: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface3,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  amounts: { flexDirection: 'row', gap: spacing[2] },
  line: { flexDirection: 'row', alignItems: 'center' },
  times: { ...font.regular, fontSize: fontSize.sm, color: colors.textSecondary },
  quantity: { width: 72 },
  card: {
    gap: spacing[5],
    padding: spacing[5],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  option: { gap: spacing[3] },
  token: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface3,
  },
  tokenText: {
    fontFamily: MONO,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
});
