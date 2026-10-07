import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import type { SaveFailure } from '@ideanest/campaign-editor/autosave';
import {
  BLURB_MAX_CHARACTERS,
  DURATION_MAX_DAYS,
  DURATION_MIN_DAYS,
  DURATION_RECOMMENDED_DAYS,
  TITLE_MAX_CHARACTERS,
  characterCount,
  draftFromProject,
  fromDateTimeLocal,
  isBasicsField,
  patchForField,
  toDateTimeLocal,
  validateBasics,
  type BasicsDraft,
  type BasicsErrors,
  type BasicsField,
} from '@ideanest/campaign-editor/basics';
import { isLocked, type ProjectEdit } from '@ideanest/campaign-editor/contract';
import { basicsPanelCopyFrom, type BasicsPanelCopy } from '@ideanest/campaign-editor/copy';
import { SUPPORTED_CURRENCIES } from '@ideanest/money';
import {
  Body,
  Caption,
  CharacterCount,
  Field,
  InlineAlert,
  Pill,
  Select,
  Skeleton,
  SkeletonGroup,
  Switch,
  TextInput,
  Textarea,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import { INPUT_HEIGHT } from '../../components/ui/text-input';
import { colors, radius, spacing } from '../../theme';
import { useEditorCategories } from './api';
import { CoverImageField } from './cover-image-field';
import { DateTimeField } from './date-time-field';
import { useEditor } from './editor-context';
import { MoneyField } from './money-field';
import { useEditorChromeCopy, useEditorTranslators } from './translator';

/**
 * The Basics tab — the web's `BasicsPanel` (#162): title, summary, category and subcategory,
 * goal, currency, duration, scheduled launch, late pledges, and the cover image, in one column.
 *
 * <p>There is no save button. Every change queues exactly ONE field's patch (`patchForField`) on
 * the editor's shared autosave — sent 800ms after the last change, or at once when the field
 * loses focus (the pickers, the switch and the cover send at once, having no blur). An invalid
 * value is not sent at all: the field says why and the server keeps the last value it accepted.
 * Validation is the shared `validateBasics`, plus whatever the server put in a 422's `errors`.
 *
 * <p>The form's state is seeded ONCE from the project, and again only when the frame says so
 * (`revision`: an unsent change from an earlier launch was sent). Re-seeding from every save's
 * answer would delete what was typed while it was in the air.
 *
 * <p>`lockedFields` (goal, duration, scheduled launch) disables the field and changes its hint.
 * Offline, every field is read-only. A category list that will not load disables only the two
 * category pickers.
 */
export function BasicsPanel() {
  const editor = useEditor();
  const { t } = useEditorTranslators();
  const basics = useMemo(() => basicsPanelCopyFrom(t), [t]);

  // Online, never from the cache alone: a form seeded from a week-old copy would PATCH its
  // stale values over edits made since. The skeleton stays until the service has answered.
  if (!editor.canSeed || editor.seed === null) {
    return editor.load === 'loading' || editor.load === 'ready' ? <Loading label={basics.loadingLabel} /> : null;
  }
  return <BasicsForm key={editor.projectId} seed={editor.seed} basics={basics} />;
}

const LOADING_ROWS = [0, 1, 2, 3];

function Loading({ label }: { readonly label: string }) {
  return (
    <View style={styles.page}>
      <SkeletonGroup label={label} testID="basics-loading">
        <View style={styles.form}>
          {LOADING_ROWS.map((row) => (
            <View key={row} style={styles.pair}>
              <Skeleton height={14} width="30%" />
              <Skeleton height={44} radius="lg" />
            </View>
          ))}
        </View>
      </SkeletonGroup>
    </View>
  );
}

/** A 422's `errors`, on the basics fields; `goal.amount` is about the goal. Pre-launch edits three of them. */
export function basicsServerErrors(failure: SaveFailure | null): BasicsErrors {
  if (failure === null) return {};
  const mapped: BasicsErrors = {};
  for (const [key, message] of Object.entries(failure.fieldErrors)) {
    const [field = ''] = key.split('.');
    if (isBasicsField(field)) mapped[field] = message;
  }
  return mapped;
}

/** The draft's keys each field owns, for keeping text that is only on this phone across a re-seed. */
const DRAFT_KEYS: Readonly<Record<BasicsField, readonly (keyof BasicsDraft)[]>> = {
  title: ['title'],
  blurb: ['blurb'],
  categoryId: ['categoryId', 'subcategoryId'],
  subcategoryId: ['subcategoryId'],
  goal: ['goalAmount', 'currency'],
  durationDays: ['durationDays'],
  scheduledLaunchAt: ['scheduledLaunchAt'],
  latePledgeEnabled: ['latePledgeEnabled'],
  coverImage: ['coverImage', 'coverImageUrl'],
};

/**
 * A new draft from `seed`, keeping the fields in `localOnly` as they are in `current`: text typed
 * here that was not sent (an amount with three decimals, an empty title) has no copy anywhere else.
 */
export function reseedDraft(
  seed: ProjectEdit,
  current: BasicsDraft,
  localOnly: ReadonlySet<BasicsField>,
): BasicsDraft {
  const next: BasicsDraft = draftFromProject(seed);
  const kept: Partial<BasicsDraft> = {};
  for (const field of localOnly) {
    for (const key of DRAFT_KEYS[field]) Object.assign(kept, { [key]: current[key] });
  }
  return { ...next, ...kept };
}

function BasicsForm({ seed, basics }: { readonly seed: ProjectEdit; readonly basics: BasicsPanelCopy }) {
  const editor = useEditor();
  const chrome = useEditorChromeCopy();
  const tEditor = useT('mobile.editor');
  const insets = useSafeAreaInsets();
  const categoriesQuery = useEditorCategories();
  const [draft, setDraft] = useState<BasicsDraft>(() => draftFromProject(seed));
  /** Fields whose text is only on this phone: changed, and refused before it was sent. */
  const localOnly = useRef(new Set<BasicsField>());

  // Seeded once; again only when the frame says so (`revision`), keeping what is only local.
  const seen = useRef(editor.revision);
  const latestSeed = useRef(seed);
  latestSeed.current = seed;
  useEffect(() => {
    if (seen.current === editor.revision) return;
    seen.current = editor.revision;
    setDraft((current) => reseedDraft(latestSeed.current, current, localOnly.current));
  }, [editor.revision]);

  const { autosave, readOnly } = editor;
  // The server is the authority on the state and the locks; the fields belong to the draft.
  const project = editor.project ?? seed;
  const categories = categoriesQuery.data ?? null;
  const categoriesFailed = categoriesQuery.isError;

  function change(field: BasicsField, next: BasicsDraft, sendNow = false): void {
    if (readOnly) return;
    setDraft(next);
    const patch = patchForField(field, next);
    if (patch === null) {
      localOnly.current.add(field);
      return;
    }
    localOnly.current.delete(field);
    autosave.save(patch);
    if (sendNow) autosave.flush();
  }

  const failure = autosave.failure;
  const errors: BasicsErrors = { ...validateBasics(draft, basics.validation), ...basicsServerErrors(failure) };
  const selected = categories?.find((category) => category.id === draft.categoryId) ?? null;
  const subcategories = selected?.subcategories ?? [];

  const goalLocked = isLocked(project, 'goal');
  const durationLocked = isLocked(project, 'durationDays');
  const launchLocked = isLocked(project, 'scheduledLaunchAt');

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + spacing[8] }]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      testID="basics-panel"
    >
      <View style={styles.form}>
        {failure === null ? null : (
          <InlineAlert
            variant="danger"
            title={basics.notSavedTitle}
            description={failure.message}
            testID="basics-not-saved"
            action={
              <View style={styles.failure}>
                <Caption>{basics.notSavedDetail}</Caption>
                <View style={styles.start}>
                  <Pill
                    label={chrome.tryAgain}
                    variant="ghost"
                    size="sm"
                    disabled={!editor.online}
                    onPress={autosave.retry}
                    testID="basics-retry"
                  />
                </View>
              </View>
            }
          />
        )}

        <Field
          label={basics.title}
          required
          hint={fillPlaceholders(basics.titleHint, { max: String(TITLE_MAX_CHARACTERS) })}
          error={errors.title}
        >
          <TextInput
            value={draft.title}
            autoComplete="off"
            disabled={readOnly}
            onChangeText={(title) => change('title', { ...draft, title })}
            onBlur={autosave.flush}
            testID="basics-title"
          />
          <CharacterCount count={characterCount(draft.title)} limit={TITLE_MAX_CHARACTERS} />
        </Field>

        <Field
          label={basics.summary}
          hint={fillPlaceholders(basics.summaryHint, { max: String(BLURB_MAX_CHARACTERS) })}
          error={errors.blurb}
        >
          <Textarea
            value={draft.blurb}
            numberOfLines={3}
            disabled={readOnly}
            onChangeText={(blurb) => change('blurb', { ...draft, blurb })}
            onBlur={autosave.flush}
            testID="basics-summary"
          />
          <CharacterCount count={characterCount(draft.blurb)} limit={BLURB_MAX_CHARACTERS} />
        </Field>

        {categoriesFailed ? (
          <InlineAlert
            variant="warning"
            politeness="polite"
            title={basics.categoriesUnavailableTitle}
            description={basics.categoriesUnavailableDetail}
            testID="basics-categories-failed"
          />
        ) : null}

        <Field label={basics.category} hint={basics.categoryHint} error={errors.categoryId}>
          <Select
            options={(categories ?? []).map((category) => ({ value: category.id, label: category.name }))}
            value={draft.categoryId === '' ? null : draft.categoryId}
            placeholder={basics.categoryPlaceholder}
            disabled={readOnly || categories === null}
            onChange={(categoryId) =>
              // A subcategory of a category nobody chose is orphaned data.
              change('categoryId', { ...draft, categoryId, subcategoryId: '' }, true)
            }
            testID="basics-category"
          />
        </Field>

        <Field
          label={basics.subcategory}
          hint={
            selected === null
              ? basics.subcategoryHintNoCategory
              : subcategories.length === 0
                ? basics.subcategoryHintNone
                : basics.subcategoryHint
          }
          error={errors.subcategoryId}
        >
          <Select
            options={[
              { value: '', label: basics.subcategoryPlaceholder },
              ...subcategories.map((subcategory) => ({ value: subcategory.id, label: subcategory.name })),
            ]}
            value={draft.subcategoryId === '' ? null : draft.subcategoryId}
            placeholder={basics.subcategoryPlaceholder}
            disabled={readOnly || subcategories.length === 0}
            onChange={(subcategoryId) => change('subcategoryId', { ...draft, subcategoryId }, true)}
            testID="basics-subcategory"
          />
        </Field>

        <Field label={basics.goal} required hint={goalLocked ? basics.goalHintLocked : basics.goalHint} error={errors.goal}>
          <MoneyField
            value={draft.goalAmount}
            currency={draft.currency}
            disabled={readOnly || goalLocked}
            onChangeText={(goalAmount) => change('goal', { ...draft, goalAmount })}
            onBlur={autosave.flush}
            testID="basics-goal"
          />
        </Field>

        <Field label={basics.currency} hint={basics.currencyHint}>
          {SUPPORTED_CURRENCIES.length > 1 ? (
            <Select
              options={SUPPORTED_CURRENCIES.map((currency) => ({ value: currency, label: currency }))}
              value={draft.currency}
              disabled={readOnly || goalLocked}
              onChange={(currency) => change('goal', { ...draft, currency }, true)}
              testID="basics-currency"
            />
          ) : (
            // One currency: a value, not a control that offers no choice.
            <View style={styles.readOnly} accessible accessibilityLabel={`${basics.currency}, ${draft.currency}`}>
              <Body testID="basics-currency">{draft.currency}</Body>
            </View>
          )}
        </Field>

        <Field
          label={basics.duration}
          required
          hint={
            durationLocked
              ? basics.durationHintLocked
              : fillPlaceholders(basics.durationHint, {
                  min: String(DURATION_MIN_DAYS),
                  max: String(DURATION_MAX_DAYS),
                  recommended: String(DURATION_RECOMMENDED_DAYS),
                })
          }
          error={errors.durationDays}
        >
          <TextInput
            value={draft.durationDays}
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="off"
            disabled={readOnly || durationLocked}
            onChangeText={(durationDays) => change('durationDays', { ...draft, durationDays })}
            onBlur={autosave.flush}
            testID="basics-duration"
          />
        </Field>

        <Field
          label={basics.scheduledLaunch}
          hint={launchLocked ? tEditor('scheduledLaunchLocked') : basics.scheduledLaunchHint}
          error={errors.scheduledLaunchAt}
        >
          <DateTimeField
            value={fromDateTimeLocal(draft.scheduledLaunchAt)}
            label={basics.scheduledLaunch}
            minimumDate={new Date()}
            disabled={readOnly || launchLocked}
            onChange={(instant) =>
              change('scheduledLaunchAt', { ...draft, scheduledLaunchAt: toDateTimeLocal(instant) }, true)
            }
            testID="basics-launch"
          />
        </Field>

        <View style={styles.card}>
          <Switch
            label={basics.latePledges}
            description={basics.latePledgesHint}
            value={draft.latePledgeEnabled}
            disabled={readOnly}
            onValueChange={(latePledgeEnabled) =>
              change('latePledgeEnabled', { ...draft, latePledgeEnabled }, true)
            }
            testID="basics-late-pledges"
          />
        </View>

        <CoverImageField
          copy={basics.cover}
          cover={draft.coverImage}
          disabled={readOnly}
          error={errors.coverImage}
          onAccept={(coverImage) =>
            change('coverImage', { ...draft, coverImage, coverImageUrl: coverImage.url }, true)
          }
          onRemove={() => change('coverImage', { ...draft, coverImage: null, coverImageUrl: '' }, true)}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.surface1 },
  page: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  form: { gap: spacing[6] },
  pair: { gap: spacing[2] },
  failure: { gap: spacing[2] },
  start: { alignSelf: 'flex-start' },
  readOnly: {
    minHeight: INPUT_HEIGHT.md,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  card: {
    padding: spacing[5],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
