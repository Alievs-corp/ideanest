import type { CharacterCountCopy, PluralForms } from '@ideanest/ui';
import type { PluralForms as AppPluralForms } from './plurals';
import type { Locale } from './locale';
import type { ProjectState, ShippingType } from '../projects/api';
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

/** The two controls every editor drawer ends with. */
export interface EditorDrawerCopy {
  readonly cancel: string;
  readonly save: string;
  readonly saving: string;
}

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
  /**
   * The three states every tab can be in besides "working", and the control that leaves them.
   *
   * They sit on the frame because all six panels render them with the same words. Six copies
   * in the catalogue would be six sentences to keep in step, and the first to drift would be
   * the one nobody reads in Turkish.
   */
  readonly signedOutTitle: string;
  readonly signedOutDetail: string;
  readonly loadFailedTitle: string;
  readonly tryAgain: string;
  /** The drawers open from three tabs, so their two buttons ride with the frame. */
  readonly drawer: EditorDrawerCopy;
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

function record<K extends string, V>(
  keys: readonly K[],
  read: (key: K) => V,
): Readonly<Record<K, V>> {
  const out = {} as Record<K, V>;
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
    signedOutTitle: t('signedOutTitle'),
    signedOutDetail: t('signedOutDetail'),
    loadFailedTitle: t('loadFailedTitle'),
    tryAgain: t('tryAgain'),
    drawer: {
      cancel: t('drawer.cancel'),
      save: t('drawer.save'),
      saving: t('drawer.saving'),
    },
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

/* -------------------------------------------------------------------------
 * Rewards — §4.5's second tab, and the items rewards are built from
 * ---------------------------------------------------------------------- */

/** `ItemEditor` — one physical or digital thing. */
export interface ItemEditorCopy {
  readonly drawer: EditorDrawerCopy;
  readonly characterCount: CharacterCountCopy;
  readonly locale: Locale;
  readonly addTitle: string;
  readonly editTitle: string;
  readonly notSavedTitle: string;
  readonly name: string;
  /** Carries `{max}`. */
  readonly nameHint: string;
  readonly description: string;
  readonly descriptionHint: string;
  /** The drawer's own sentence, not the field label above. */
  readonly drawerDescription: string;
  readonly imageUrl: string;
  readonly imageUrlHint: string;
  readonly imageUrlPlaceholder: string;
  readonly isDigital: string;
  readonly isDigitalHint: string;
  readonly weight: string;
  readonly weightHintDigital: string;
  readonly sku: string;
  readonly skuHint: string;
}

/** `ItemsSection` — the list the rewards are assembled from. */
export interface ItemsSectionCopy {
  readonly itemsHeading: string;
  readonly description: string;
  readonly loadingLabel: string;
  readonly emptyTitle: string;
  readonly add: string;
  readonly addFirst: string;
  readonly delete: string;
  readonly edit: string;
  readonly digital: string;
  readonly physical: string;
  /** Carries `{name}`. */
  readonly editNamed: string;
  /** Carries `{name}`. */
  readonly deleteNamed: string;
}

/** `RewardTierEditor` — the drawer one reward is edited in. */
export interface RewardTierEditorCopy {
  readonly drawer: EditorDrawerCopy;
  readonly characterCount: CharacterCountCopy;
  readonly addTitle: string;
  readonly editTitle: string;
  readonly description: string;
  readonly notSavedTitle: string;
  readonly ratesNotSavedTitle: string;
  readonly title: string;
  /** Carries `{max}`. */
  readonly titleHint: string;
  readonly summary: string;
  readonly summaryHint: string;
  readonly price: string;
  /** Carries `{currency}`. */
  readonly priceHint: string;
  /** Carries `{currency}`. */
  readonly priceHintLocked: string;
  readonly estimatedDelivery: string;
  readonly estimatedDeliveryHint: string;
  readonly places: string;
  readonly placesHint: string;
  /** One form per category, each carrying `{count}` — places already taken. */
  readonly placesHintCommitted: AppPluralForms;
  /** The language whose plural rule picks between them. */
  readonly locale: Locale;
  readonly rest: string;
  readonly offering: string;
  readonly opens: string;
  readonly opensHint: string;
  readonly closes: string;
  readonly closesHint: string;
  readonly earlyBird: string;
  readonly featured: string;
  readonly featuredHint: string;
  readonly secret: string;
  readonly addOn: string;
  readonly addOnHint: string;
  readonly contents: string;
  readonly contentsHint: string;
  readonly addItem: string;
  readonly addItemPlaceholder: string;
  readonly missingItem: string;
  readonly noItemsYet: string;
  readonly everyItemAdded: string;
  readonly shipping: string;
  /** The scope select's own label, which is not the rates section's. */
  readonly delivery: string;
  /** Carries `{currency}`. */
  readonly ratesHint: string;
  readonly noDestinations: string;
  readonly addDestination: string;
  readonly countryPlaceholder: string;
  readonly ratePlaceholder: string;
  readonly extraPlaceholder: string;
  readonly token: string;
  /** Carries `{name}`. */
  readonly quantityOf: string;
  /** Carries `{name}`. */
  readonly removeFromReward: string;
  /** Carries `{name}`. */
  readonly countryCodeFor: string;
  /** Carries `{name}`. */
  readonly shippingRateTo: string;
  /** Carries `{name}`. */
  readonly additionalRateTo: string;
  /** Carries `{name}`. */
  readonly removeNamed: string;
}

/** `RewardsPanel` — the tab itself. */
export interface RewardsPanelCopy {
  readonly loadingLabel: string;
  readonly failedTitle: string;
  readonly rewardsFailedTitle: string;
  readonly listLabel: string;
  readonly description: string;
  readonly emptyTitle: string;
  readonly add: string;
  readonly addFirst: string;
  readonly rewardsHeading: string;
  /** Carries `{count}` and `{max}`. */
  readonly countOf: string;
  readonly atCapacityTitle: string;
  readonly deleteItemTitle: string;
  readonly deleteRewardTitle: string;
  readonly cannotBeUndone: string;
  readonly keepIt: string;
  readonly delete: string;
  readonly duplicate: string;
  readonly edit: string;
  readonly show: string;
  readonly hide: string;
  readonly hidden: string;
  readonly opensLater: string;
  readonly featured: string;
  readonly secret: string;
  readonly earlyBird: string;
  readonly addOn: string;
  /*
   * The templates. Each carries the reward's or item's own name, because a control that says
   * only "Delete" is a control a screen-reader user meets seven times on this page with no
   * way to tell which row it belongs to.
   */
  /** Carries `{name}`. */
  readonly deleteItemNamed: string;
  /** Carries `{title}`. */
  readonly deleteRewardNamed: string;
  /** Carries `{title}`, `{position}` and `{total}`. */
  readonly movedAnnouncement: string;
  /** Carries `{title}` and `{position}`. */
  readonly duplicatedAnnouncement: string;
  /** Carries `{title}`. */
  readonly hiddenAnnouncement: string;
  /** Carries `{title}`. */
  readonly shownAnnouncement: string;
  /** Carries `{title}`. */
  readonly rewardDeletedAnnouncement: string;
  /** Carries `{name}`. */
  readonly itemDeletedAnnouncement: string;
  /** Carries `{title}`, `{position}` and `{total}`. */
  readonly moveUpLabel: string;
  /** Carries `{title}`, `{position}` and `{total}`. */
  readonly moveDownLabel: string;
  /** Carries `{title}`. */
  readonly editLabel: string;
  /** Carries `{title}`. */
  readonly duplicateLabel: string;
  /** Carries `{title}`. */
  readonly showLabel: string;
  /** Carries `{title}`. */
  readonly hideLabel: string;
  /** Carries `{title}`. */
  readonly deleteLabel: string;
  readonly containsNothing: string;
  /** Carries `{items}`, already joined. */
  readonly contains: string;
  /** Carries `{name}` and `{quantity}`. */
  readonly itemTimes: string;
  readonly missingItemInline: string;
  readonly aRewardInCampaign: string;
  readonly aReward: string;
  /** One form per category. Carries `{tiers}`, the reward titles already joined. */
  readonly itemInUse: AppPluralForms;
  readonly rewardHasBackers: string;
  /** The language whose plural rule picks the form above. */
  readonly locale: Locale;
  readonly vocabulary: RewardsVocabularyCopy;
  readonly items: ItemsSectionCopy;
  readonly item: ItemEditorCopy;
  readonly tier: RewardTierEditorCopy;
}

export function rewardsPanelCopyFrom(
  t: CampaignEditorTranslator,
  locale: Locale,
  counter: CharacterCountCopy,
): RewardsPanelCopy {
  const at = (key: string) => t(`rewards.${key}`);
  /* Anything with a `{placeholder}` in it, for the reason `template` states. */
  const tpl = (key: string) => template(t, key);
  const drawer = (where: string) => ({
    cancel: at(`${where}.drawer.cancel`),
    save: at(`${where}.drawer.save`),
    saving: at(`${where}.drawer.saving`),
  });

  return {
    loadingLabel: at('loadingLabel'),
    failedTitle: at('failedTitle'),
    rewardsFailedTitle: at('rewardsFailedTitle'),
    listLabel: at('listLabel'),
    description: at('description'),
    emptyTitle: at('emptyTitle'),
    add: at('add'),
    addFirst: at('addFirst'),
    rewardsHeading: at('rewardsHeading'),
    countOf: tpl('rewards.countOf'),
    atCapacityTitle: at('atCapacityTitle'),
    deleteItemTitle: at('deleteItemTitle'),
    deleteRewardTitle: at('deleteRewardTitle'),
    cannotBeUndone: at('cannotBeUndone'),
    keepIt: at('keepIt'),
    delete: at('delete'),
    duplicate: at('duplicate'),
    edit: at('edit'),
    show: at('show'),
    hide: at('hide'),
    hidden: at('hidden'),
    opensLater: at('opensLater'),
    featured: at('featured'),
    secret: at('secret'),
    earlyBird: at('earlyBird'),
    addOn: at('addOn'),
    deleteItemNamed: tpl('rewards.deleteItemNamed'),
    deleteRewardNamed: tpl('rewards.deleteRewardNamed'),
    movedAnnouncement: tpl('rewards.movedAnnouncement'),
    duplicatedAnnouncement: tpl('rewards.duplicatedAnnouncement'),
    hiddenAnnouncement: tpl('rewards.hiddenAnnouncement'),
    shownAnnouncement: tpl('rewards.shownAnnouncement'),
    rewardDeletedAnnouncement: tpl('rewards.rewardDeletedAnnouncement'),
    itemDeletedAnnouncement: tpl('rewards.itemDeletedAnnouncement'),
    moveUpLabel: tpl('rewards.moveUpLabel'),
    moveDownLabel: tpl('rewards.moveDownLabel'),
    editLabel: tpl('rewards.editLabel'),
    duplicateLabel: tpl('rewards.duplicateLabel'),
    showLabel: tpl('rewards.showLabel'),
    hideLabel: tpl('rewards.hideLabel'),
    deleteLabel: tpl('rewards.deleteLabel'),
    containsNothing: at('containsNothing'),
    contains: tpl('rewards.contains'),
    itemTimes: tpl('rewards.itemTimes'),
    missingItemInline: at('missingItemInline'),
    aRewardInCampaign: at('aRewardInCampaign'),
    aReward: at('aReward'),
    itemInUse: t.raw('rewards.itemInUse') as AppPluralForms,
    rewardHasBackers: at('rewardHasBackers'),
    locale,
    vocabulary: rewardsVocabularyCopyFrom(t, locale),
    items: {
      itemsHeading: at('items.itemsHeading'),
      description: at('items.description'),
      loadingLabel: at('items.loadingLabel'),
      emptyTitle: at('items.emptyTitle'),
      add: at('items.add'),
      addFirst: at('items.addFirst'),
      delete: at('items.delete'),
      edit: at('items.edit'),
      digital: at('items.digital'),
      physical: at('items.physical'),
      editNamed: tpl('rewards.items.editNamed'),
      deleteNamed: tpl('rewards.items.deleteNamed'),
    },
    item: {
      drawer: drawer('item'),
      characterCount: counter,
      locale,
      addTitle: at('item.addTitle'),
      editTitle: at('item.editTitle'),
      notSavedTitle: at('item.notSavedTitle'),
      name: at('item.name'),
      nameHint: tpl('rewards.item.nameHint'),
      drawerDescription: at('item.drawerDescription'),
      description: at('item.description'),
      descriptionHint: at('item.descriptionHint'),
      imageUrl: at('item.imageUrl'),
      imageUrlHint: at('item.imageUrlHint'),
      imageUrlPlaceholder: at('item.imageUrlPlaceholder'),
      isDigital: at('item.isDigital'),
      isDigitalHint: at('item.isDigitalHint'),
      weight: at('item.weight'),
      weightHintDigital: at('item.weightHintDigital'),
      sku: at('item.sku'),
      skuHint: at('item.skuHint'),
    },
    tier: {
      drawer: drawer('tier'),
      characterCount: counter,
      addTitle: at('tier.addTitle'),
      editTitle: at('tier.editTitle'),
      description: at('tier.description'),
      notSavedTitle: at('tier.notSavedTitle'),
      ratesNotSavedTitle: at('tier.ratesNotSavedTitle'),
      title: at('tier.title'),
      titleHint: tpl('rewards.tier.titleHint'),
      summary: at('tier.summary'),
      summaryHint: at('tier.summaryHint'),
      price: at('tier.price'),
      priceHint: tpl('rewards.tier.priceHint'),
      priceHintLocked: tpl('rewards.tier.priceHintLocked'),
      estimatedDelivery: at('tier.estimatedDelivery'),
      estimatedDeliveryHint: at('tier.estimatedDeliveryHint'),
      places: at('tier.places'),
      placesHint: at('tier.placesHint'),
      placesHintCommitted: t.raw('rewards.tier.placesHintCommitted') as AppPluralForms,
      locale,
      rest: at('tier.rest'),
      offering: at('tier.offering'),
      opens: at('tier.opens'),
      opensHint: at('tier.opensHint'),
      closes: at('tier.closes'),
      closesHint: at('tier.closesHint'),
      earlyBird: at('tier.earlyBird'),
      featured: at('tier.featured'),
      featuredHint: at('tier.featuredHint'),
      secret: at('tier.secret'),
      addOn: at('tier.addOn'),
      addOnHint: at('tier.addOnHint'),
      contents: at('tier.contents'),
      contentsHint: at('tier.contentsHint'),
      addItem: at('tier.addItem'),
      addItemPlaceholder: at('tier.addItemPlaceholder'),
      missingItem: at('tier.missingItem'),
      noItemsYet: at('tier.noItemsYet'),
      everyItemAdded: at('tier.everyItemAdded'),
      shipping: at('tier.shipping'),
      delivery: at('tier.delivery'),
      ratesHint: tpl('rewards.tier.ratesHint'),
      noDestinations: at('tier.noDestinations'),
      addDestination: at('tier.addDestination'),
      countryPlaceholder: at('tier.countryPlaceholder'),
      ratePlaceholder: at('tier.ratePlaceholder'),
      extraPlaceholder: at('tier.extraPlaceholder'),
      token: at('tier.token'),
      quantityOf: tpl('rewards.tier.quantityOf'),
      removeFromReward: tpl('rewards.tier.removeFromReward'),
      countryCodeFor: tpl('rewards.tier.countryCodeFor'),
      shippingRateTo: tpl('rewards.tier.shippingRateTo'),
      additionalRateTo: tpl('rewards.tier.additionalRateTo'),
      removeNamed: tpl('rewards.tier.removeNamed'),
    },
  };
}

/* -------------------------------------------------------------------------
 * The rewards vocabulary — what `lib/projects/rewards.ts` refuses in
 * ---------------------------------------------------------------------- */

/** The six ways an amount can be refused, shared by the price and the rates. */
export interface AmountMessagesCopy {
  readonly empty: string;
  readonly notANumber: string;
  readonly comma: string;
  readonly tooManyDecimals: string;
  readonly tooLarge: string;
  readonly notPositive: string;
}

/** What `validateItem` refuses. */
export interface ItemValidationCopy {
  readonly nameRequired: string;
  /** Carries `{max}` and `{over}`. */
  readonly nameTooLong: string;
  /** Carries `{max}`. */
  readonly skuTooLong: string;
  readonly weightOnDigital: string;
  readonly weightNotWhole: string;
  readonly weightNotPositive: string;
}

/** What `validateReward` and `validateShippingRates` refuse. */
export interface RewardValidationCopy {
  readonly titleRequired: string;
  /** Carries `{max}` and `{over}`. */
  readonly titleTooLong: string;
  readonly limitNotWhole: string;
  readonly limitBelowOne: string;
  /** One form per category, each carrying `{count}` — the places already taken. */
  readonly limitBelowCommitted: AppPluralForms;
  readonly secretAndFeatured: string;
  readonly earlyBirdNeedsLimit: string;
  readonly dateInvalid: string;
  readonly closesBeforeOpens: string;
  readonly itemsDuplicate: string;
  readonly itemsQuantity: string;
  readonly price: AmountMessagesCopy;
  readonly rate: AmountMessagesCopy;
  readonly rates: {
    readonly notShipped: string;
    readonly badCountryCode: string;
    /** Carries `{code}`. */
    readonly duplicateDestination: string;
    /**
     * Carries `{code}` and `{message}`.
     *
     * The destination goes in front of the rate's own refusal because the table is validated
     * as a whole and reports the first row it cannot accept — without the code, a creator
     * with eight destinations is told a rate is wrong and not which one.
     */
    readonly prefixed: string;
  };
  /** The language whose plural rule picks the committed-places form. */
  readonly locale: Locale;
}

/**
 * The delivery scopes, named and explained.
 *
 * A record rather than the list `SHIPPING_SCOPES` used to carry, for the reason `tabs.ts`
 * gives: the model keeps the values it is a model of, and the words belong to the catalogue.
 */
export interface ShippingScopeCopy {
  readonly label: string;
  readonly hint: string;
}

export interface RewardsVocabularyCopy {
  readonly scopes: Readonly<Record<ShippingType, ShippingScopeCopy>>;
  readonly item: ItemValidationCopy;
  readonly reward: RewardValidationCopy;
  readonly showBlockedEarlyBird: string;
  readonly stock: {
    readonly unlimited: string;
    /** Carries `{remaining}` and `{limit}`. */
    readonly remaining: string;
  };
}

/** Every scope in §5.3. Listed so a new one fails to compile rather than rendering blank. */
const SHIPPING_TYPES = [
  'NONE',
  'DIGITAL',
  'LOCAL_PICKUP',
  'DOMESTIC',
  'INTERNATIONAL',
] as const satisfies readonly ShippingType[];

function amountMessages(
  t: CampaignEditorTranslator,
  where: string,
): AmountMessagesCopy {
  return {
    empty: t(`${where}.empty`),
    notANumber: t(`${where}.notANumber`),
    comma: t(`${where}.comma`),
    tooManyDecimals: t(`${where}.tooManyDecimals`),
    tooLarge: t(`${where}.tooLarge`),
    notPositive: t(`${where}.notPositive`),
  };
}

export function rewardsVocabularyCopyFrom(
  t: CampaignEditorTranslator,
  locale: Locale,
): RewardsVocabularyCopy {
  const at = (key: string) => t(`rewards.vocabulary.${key}`);
  const tpl = (key: string) => template(t, `rewards.vocabulary.${key}`);

  return {
    scopes: record(SHIPPING_TYPES, (scope) => ({
      label: at(`scopes.${scope}.label`),
      hint: at(`scopes.${scope}.hint`),
    })),
    item: {
      nameRequired: at('item.nameRequired'),
      nameTooLong: tpl('item.nameTooLong'),
      skuTooLong: tpl('item.skuTooLong'),
      weightOnDigital: at('item.weightOnDigital'),
      weightNotWhole: at('item.weightNotWhole'),
      weightNotPositive: at('item.weightNotPositive'),
    },
    reward: {
      titleRequired: at('reward.titleRequired'),
      titleTooLong: tpl('reward.titleTooLong'),
      limitNotWhole: at('reward.limitNotWhole'),
      limitBelowOne: at('reward.limitBelowOne'),
      limitBelowCommitted: t.raw(
        'rewards.vocabulary.reward.limitBelowCommitted',
      ) as AppPluralForms,
      secretAndFeatured: at('reward.secretAndFeatured'),
      earlyBirdNeedsLimit: at('reward.earlyBirdNeedsLimit'),
      dateInvalid: at('reward.dateInvalid'),
      closesBeforeOpens: at('reward.closesBeforeOpens'),
      itemsDuplicate: at('reward.itemsDuplicate'),
      itemsQuantity: at('reward.itemsQuantity'),
      price: amountMessages(t, 'rewards.vocabulary.price'),
      rate: amountMessages(t, 'rewards.vocabulary.rate'),
      rates: {
        notShipped: at('rates.notShipped'),
        badCountryCode: at('rates.badCountryCode'),
        duplicateDestination: tpl('rates.duplicateDestination'),
        prefixed: tpl('rates.prefixed'),
      },
      locale,
    },
    showBlockedEarlyBird: at('showBlockedEarlyBird'),
    stock: {
      unlimited: at('stock.unlimited'),
      remaining: tpl('stock.remaining'),
    },
  };
}

/* -------------------------------------------------------------------------
 * Pre-launch — §4.5's fifth tab
 * ---------------------------------------------------------------------- */

/** The pre-launch tab: the page that goes public before the campaign does. */
export interface PrelaunchPanelCopy {
  readonly loadingLabel: string;
  readonly notSavedTitle: string;
  readonly notOpenHeading: string;
  readonly notOpenBody: string;
  readonly notOpenIrreversible: string;
  readonly openFailedTitle: string;
  readonly open: string;
  readonly openHeading: string;
  readonly followersFailed: string;
  /**
   * One form per category, carrying `{count}`.
   *
   * The count is rendered inside the sentence rather than beside it, so this is filled with
   * `fillNodes` — the number stays bold where the sentence puts it, which is not the same
   * place in every language.
   */
  readonly waiting: AppPluralForms;
  readonly link: string;
  readonly linkHint: string;
  readonly copy: string;
  readonly copied: string;
  readonly copiedAnnouncement: string;
  readonly closedTitle: string;
  readonly closedBody: string;
  readonly saysHeading: string;
  readonly saysBody: string;
  readonly title: string;
  /** Carries `{max}`. */
  readonly titleHint: string;
  readonly summary: string;
  /** Carries `{max}`. */
  readonly summaryHint: string;
  readonly confirmTitle: string;
  readonly confirmBody: string;
  readonly cancel: string;
  readonly opening: string;
  readonly confirmOpen: string;
  readonly characterCount: CharacterCountCopy;
  readonly locale: Locale;
}

export function prelaunchPanelCopyFrom(
  t: CampaignEditorTranslator,
  locale: Locale,
  counter: CharacterCountCopy,
): PrelaunchPanelCopy {
  const at = (key: string) => t(`prelaunch.${key}`);
  const tpl = (key: string) => template(t, `prelaunch.${key}`);

  return {
    loadingLabel: at('loadingLabel'),
    notSavedTitle: at('notSavedTitle'),
    notOpenHeading: at('notOpenHeading'),
    notOpenBody: at('notOpenBody'),
    notOpenIrreversible: at('notOpenIrreversible'),
    openFailedTitle: at('openFailedTitle'),
    open: at('open'),
    openHeading: at('openHeading'),
    followersFailed: at('followersFailed'),
    waiting: t.raw('prelaunch.waiting') as AppPluralForms,
    link: at('link'),
    linkHint: at('linkHint'),
    copy: at('copy'),
    copied: at('copied'),
    copiedAnnouncement: at('copiedAnnouncement'),
    closedTitle: at('closedTitle'),
    closedBody: at('closedBody'),
    saysHeading: at('saysHeading'),
    saysBody: at('saysBody'),
    title: at('title'),
    titleHint: tpl('titleHint'),
    summary: at('summary'),
    summaryHint: tpl('summaryHint'),
    confirmTitle: at('confirmTitle'),
    confirmBody: at('confirmBody'),
    cancel: at('cancel'),
    opening: at('opening'),
    confirmOpen: at('confirmOpen'),
    characterCount: counter,
    locale,
  };
}
