import type { CharacterCountCopy, PluralForms } from '@ideanest/ui';
import type { ProjectState } from '../projects/api';
import type { EditorTabKey } from '../../components/campaign-editor/tabs';

/**
 * The words the campaign editor's frame draws — issue #324, docs/architecture.md §21.1.
 *
 * <h2>Why the copy arrives as a prop, like the checkout's</h2>
 *
 * Every panel under `components/campaign-editor` is a client component and has to be: the
 * form autosaves as it is typed, the story editor holds a document in state, the reward
 * editor opens a drawer. None of them can call `getTranslations`.
 *
 * `useTranslations` would need a `NextIntlClientProvider` above them, and `lib/i18n/shell-copy.ts`
 * carries what this repository measured that to cost — up to **27.4 KiB on every route in a
 * group**, paid by routes that draw none of the words. So each page under
 * `app/[locale]/projects/[id]/edit` resolves this on the server and hands it down, the same
 * move `checkout-copy.ts` makes for the same reason.
 *
 * <h2>This is the frame only, not the panels</h2>
 *
 * `EditorShell` and `SaveStatus` are drawn by every tab, so their words are resolved once and
 * threaded through each panel rather than repeated per tab. The panels' own copy — the field
 * labels, the hints, the refusals — belongs to the panel and follows in its own change.
 * Keeping them apart is what lets a tab be translated without touching the other five.
 *
 * <h2>The state vocabulary is the editor's own, and that is not an oversight</h2>
 *
 * `admin.screens.campaignDirectory.state` already names all sixteen states of §6.1, and this
 * deliberately does not reuse it. The two audiences are different: a moderator reading a queue
 * sees `SUBMITTED` as "awaiting review", and the creator whose campaign it is sees "in review".
 * The English the editor already drew is preserved key for key.
 *
 * **The two vocabularies have already drifted in English**, and this change does not silence
 * that: the console spells `CANCELED` "Cancelled" and the editor "Canceled". Which of the two
 * the product says is a copy decision rather than a translation one, so it is reported rather
 * than quietly resolved here.
 */

/** Whether the work is safe — the three words `SaveStatus` can show. */
export interface SaveStatusCopy {
  readonly saving: string;
  readonly saved: string;
  readonly notSaved: string;
}

/**
 * The frame: the heading, the section links, the state tag and the save indicator.
 *
 * `tabs` and `states` are exhaustive records rather than index signatures, for the reason
 * `checkout-copy.ts` gives: a missing key should be a compile error and not a
 * `campaignEditor.tabs.story` printed where a section name belongs.
 */
export interface EditorChromeCopy {
  /** Sits above the title. Names the surface, not the campaign. */
  readonly eyebrow: string;
  /** Stands in for the title until the project has loaded. */
  readonly loadingTitle: string;
  /** Names the section links for assistive technology. */
  readonly sectionsLabel: string;
  readonly tabs: Readonly<Record<EditorTabKey, string>>;
  /** The visible cue on a section that has no route yet. */
  readonly soon: string;
  /**
   * The spoken half of that cue, appended to the tab's own name.
   *
   * IT CARRIES ITS OWN LEADING COMMA, and the comma is load-bearing. An accessible name is
   * the concatenation of its parts with each trimmed and no separator inserted, so a name
   * built from "Rewards" and "not available yet" reads "Rewardsnot available yet".
   */
  readonly notAvailable: string;
  readonly states: Readonly<Record<ProjectState, string>>;
  readonly save: SaveStatusCopy;
  /**
   * The length counter's sentences, and the language whose plural rule picks between them.
   *
   * It rides with the frame rather than with each panel because five of the six tabs count
   * characters, and one spelling of "{count} characters remaining" is the point of §7.13's
   * rule that a counter is a sentence.
   */
  readonly characterCount: CharacterCountCopy;
  readonly locale: string;
}

/**
 * A message lookup rooted at `campaignEditor`, narrowed to what these builders need.
 *
 * The same shape `AuthTranslator` takes, and for the same reason: the builders are pure
 * functions of a lookup, so a component test can build the identical object out of
 * `messages/*.json` and assert against the words the application will actually draw.
 */
export interface CampaignEditorTranslator {
  (key: string): string;
  /**
   * next-intl's escape hatch for a message that is not to be formatted here.
   *
   * EVERY TEMPLATE CARRYING A PLACEHOLDER IS READ THROUGH THIS, and calling `t()` on one
   * instead is not a style question — next-intl formats the message as ICU, finds no value
   * for `{max}`, calls `onError` with a FORMATTING_ERROR and renders the key's own path. The
   * field's hint becomes `campaignEditor.basics.titleHint` in production and throws in
   * development. `auth-copy.ts` carries the same warning for the same reason.
   *
   * The value is filled by `fillPlaceholders` in the component, where the number of
   * characters the creator has typed is actually known.
   */
  raw(key: string): unknown;
}

/** A template read raw, narrowed to the string it is. */
function template(t: CampaignEditorTranslator, key: string): string {
  const value = t.raw(key);
  if (typeof value !== 'string') throw new Error(`campaignEditor.${key} is not a template`);
  return value;
}

/** Every state in §6.1. Listed rather than derived, so a new one fails to compile. */
const PROJECT_STATES = [
  'DRAFT',
  'PRELAUNCH',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'LIVE',
  'SUSPENDED',
  'CANCELED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
] as const satisfies readonly ProjectState[];

/** The editor's sections, in the order `tabs.ts` declares them. */
const EDITOR_TAB_KEYS = [
  'basics',
  'rewards',
  'story',
  'faq',
  'prelaunch',
  'review',
] as const satisfies readonly EditorTabKey[];

function record<K extends string>(
  keys: readonly K[],
  read: (key: K) => string,
): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const key of keys) out[key] = read(key);
  return out;
}

/**
 * The frame, plus the reader's language.
 *
 * `locale` is a value rather than a hook because `CharacterCount` needs it to select a plural
 * form, and the panels that draw it are client components that would otherwise each reach for
 * the route's parameters to learn something the server already knew.
 */
export function editorChromeCopyFrom(
  t: CampaignEditorTranslator,
  counter: CampaignEditorTranslator,
  locale: string,
): EditorChromeCopy {
  return {
    eyebrow: t('eyebrow'),
    loadingTitle: t('loadingTitle'),
    sectionsLabel: t('sectionsLabel'),
    tabs: record(EDITOR_TAB_KEYS, (key) => t(`tabs.${key}`)),
    soon: t('soon'),
    notAvailable: t('notAvailable'),
    states: record(PROJECT_STATES, (state) => t(`state.${state}`)),
    save: {
      saving: t('save.saving'),
      saved: t('save.saved'),
      notSaved: t('save.notSaved'),
    },
    /*
     * Read raw and cast, the way `card-copy.ts` reads `common.card.backers`: the forms carry
     * `{count}`, so `t()` would format them as ICU and render the key's own path instead.
     * `catalogue.test.ts` is what keeps all four categories present in all four languages.
     */
    characterCount: {
      remaining: counter.raw('remaining') as PluralForms,
      tooMany: counter.raw('tooMany') as PluralForms,
    },
    locale,
  };
}

/* -------------------------------------------------------------------------
 * Basics — §4.5's first tab
 * ---------------------------------------------------------------------- */

/**
 * What the basics form refuses, and why.
 *
 * <h2>It is an argument, not a lookup</h2>
 *
 * `validateBasics` is a pure function of a draft, called on every keystroke from two panels.
 * It cannot reach a catalogue, and giving it one would make it a function of the request.
 * `lib/auth/failures.ts` is handed its vocabulary for the same reason, and the argument is
 * REQUIRED rather than optional there too: an optional one leaves a form quietly refusing in
 * English at the moment somebody is already stuck.
 *
 * The templates carry `{max}`, `{over}`, `{min}` — filled by `fillPlaceholders` where the
 * number is known, because a server cannot count characters the creator has not typed yet.
 */
export interface BasicsValidationCopy {
  readonly titleRequired: string;
  /** Carries `{max}` and `{over}`. */
  readonly titleTooLong: string;
  /** Carries `{max}` and `{over}`. */
  readonly summaryTooLong: string;
  readonly subcategoryWithoutCategory: string;
  readonly currencyUnsupported: string;
  readonly durationNotWhole: string;
  /** Carries `{min}` and `{max}`. */
  readonly durationOutOfRange: string;
  readonly launchNotADate: string;
  readonly launchInPast: string;
  /** One per `AmountRejection`, so a new rejection fails to compile. */
  readonly amount: {
    readonly empty: string;
    readonly notANumber: string;
    readonly comma: string;
    readonly tooManyDecimals: string;
    readonly tooLarge: string;
    readonly notPositive: string;
  };
}

/** The basics tab's own words. The frame's are in {@link EditorChromeCopy}. */
export interface BasicsPanelCopy {
  readonly signedOutTitle: string;
  readonly signedOutDetail: string;
  readonly loadFailedTitle: string;
  readonly tryAgain: string;
  readonly loadingLabel: string;
  readonly notSavedTitle: string;
  readonly notSavedDetail: string;
  readonly categoriesUnavailableTitle: string;
  readonly categoriesUnavailableDetail: string;
  readonly title: string;
  /** Carries `{max}`. */
  readonly titleHint: string;
  readonly summary: string;
  /** Carries `{max}`. */
  readonly summaryHint: string;
  readonly category: string;
  readonly categoryHint: string;
  readonly categoryPlaceholder: string;
  readonly subcategory: string;
  readonly subcategoryPlaceholder: string;
  readonly subcategoryHintNoCategory: string;
  readonly subcategoryHintNone: string;
  readonly subcategoryHint: string;
  readonly goal: string;
  readonly goalHint: string;
  readonly goalHintLocked: string;
  readonly currency: string;
  readonly currencyHint: string;
  readonly duration: string;
  /** Carries `{min}`, `{max}` and `{recommended}`. */
  readonly durationHint: string;
  readonly durationHintLocked: string;
  readonly scheduledLaunch: string;
  readonly scheduledLaunchHint: string;
  readonly latePledges: string;
  readonly latePledgesHint: string;
  readonly validation: BasicsValidationCopy;
}

export function basicsValidationCopyFrom(t: CampaignEditorTranslator): BasicsValidationCopy {
  return {
    titleRequired: t('basics.validation.titleRequired'),
    titleTooLong: template(t, 'basics.validation.titleTooLong'),
    summaryTooLong: template(t, 'basics.validation.summaryTooLong'),
    subcategoryWithoutCategory: t('basics.validation.subcategoryWithoutCategory'),
    currencyUnsupported: t('basics.validation.currencyUnsupported'),
    durationNotWhole: t('basics.validation.durationNotWhole'),
    durationOutOfRange: template(t, 'basics.validation.durationOutOfRange'),
    launchNotADate: t('basics.validation.launchNotADate'),
    launchInPast: t('basics.validation.launchInPast'),
    amount: {
      empty: t('basics.validation.amount.empty'),
      notANumber: t('basics.validation.amount.notANumber'),
      comma: t('basics.validation.amount.comma'),
      tooManyDecimals: t('basics.validation.amount.tooManyDecimals'),
      tooLarge: t('basics.validation.amount.tooLarge'),
      notPositive: t('basics.validation.amount.notPositive'),
    },
  };
}

export function basicsPanelCopyFrom(t: CampaignEditorTranslator): BasicsPanelCopy {
  return {
    signedOutTitle: t('basics.signedOutTitle'),
    signedOutDetail: t('basics.signedOutDetail'),
    loadFailedTitle: t('basics.loadFailedTitle'),
    tryAgain: t('basics.tryAgain'),
    loadingLabel: t('basics.loadingLabel'),
    notSavedTitle: t('basics.notSavedTitle'),
    notSavedDetail: t('basics.notSavedDetail'),
    categoriesUnavailableTitle: t('basics.categoriesUnavailableTitle'),
    categoriesUnavailableDetail: t('basics.categoriesUnavailableDetail'),
    title: t('basics.title'),
    titleHint: template(t, 'basics.titleHint'),
    summary: t('basics.summary'),
    summaryHint: template(t, 'basics.summaryHint'),
    category: t('basics.category'),
    categoryHint: t('basics.categoryHint'),
    categoryPlaceholder: t('basics.categoryPlaceholder'),
    subcategory: t('basics.subcategory'),
    subcategoryPlaceholder: t('basics.subcategoryPlaceholder'),
    subcategoryHintNoCategory: t('basics.subcategoryHintNoCategory'),
    subcategoryHintNone: t('basics.subcategoryHintNone'),
    subcategoryHint: t('basics.subcategoryHint'),
    goal: t('basics.goal'),
    goalHint: t('basics.goalHint'),
    goalHintLocked: t('basics.goalHintLocked'),
    currency: t('basics.currency'),
    currencyHint: t('basics.currencyHint'),
    duration: t('basics.duration'),
    durationHint: template(t, 'basics.durationHint'),
    durationHintLocked: t('basics.durationHintLocked'),
    scheduledLaunch: t('basics.scheduledLaunch'),
    scheduledLaunchHint: t('basics.scheduledLaunchHint'),
    latePledges: t('basics.latePledges'),
    latePledgesHint: t('basics.latePledgesHint'),
    validation: basicsValidationCopyFrom(t),
  };
}
