import { type CardTranslator, type SharedCardCopy, sharedCardCopyFrom } from './card-copy';

/**
 * Every word `/u/[slug]` draws — issue #324.
 *
 * <h2>Why the card's status vocabulary is its own and not `campaign.state`</h2>
 *
 * The catalogue already carries `campaign.state`, and it is a different vocabulary for the
 * same enum on purpose rather than by accident. That one is written for somebody deciding
 * whether to back a campaign — `PRELAUNCH` reads "Coming soon" — while a profile's archive is
 * a list of statuses and reads "Pre-launch". The two lists also do not cover the same states:
 * an archive shows `SCHEDULED` and `COLLECTING`, and a campaign page shows `CANCELED`.
 *
 * Reconciling the wording would be a copy decision about what a badge should say, not a
 * translation, so this change keeps both and says so here rather than quietly changing English
 * on one of the two screens.
 *
 * <h2>Four of the card's sentences are not here at all</h2>
 *
 * The progress bar's name, the completion figure, the goal under it and the backer count are
 * word for word what `components/discovery/ProjectCard` draws, so they live in `common.card`
 * and both cards read them — `lib/i18n/card-copy.ts` carries that decision. What is left in
 * `profile.card` is the nine status words of an archive.
 *
 * <p>The count is `PluralForms` rather than an ICU string for the reason that file gives:
 * `campaign.backers` is ICU because the campaign page resolves it on the server, and a
 * profile's grid appends cards after a click, so each card's count arrives in the browser.
 */

/**
 * A message lookup rooted at `profile`.
 *
 * `raw` is used for the states table, the plural forms, and every sentence carrying a
 * placeholder: `t('x')` on a template is a formatting error in next-intl, which renders the
 * key's own path rather than the sentence. `fillPlaceholders` puts the value in where it is
 * known, which is in the component.
 */
export interface ProfileRawTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

export interface ProfileCardCopy extends SharedCardCopy {
  /** Keyed by the service's state name; a state not in the table renders as itself. */
  readonly states: Readonly<Record<string, string>>;
}

export interface ProfileGridCopy {
  readonly failedTitle: string;
  readonly failedBody: string;
  readonly createdEmptyTitle: string;
  /** Carries `{name}`. */
  readonly createdEmptyBody: string;
  readonly backedEmptyTitle: string;
  /** Carries `{name}`. */
  readonly backedEmptyBody: string;
  readonly showMore: string;
  readonly showMoreCreated: string;
  readonly showMoreBacked: string;
  readonly loading: string;
  readonly nextFailedTitle: string;
  readonly refused: string;
  readonly unreachable: string;
  readonly card: ProfileCardCopy;
}

export interface ProfileAboutCopy {
  /** Carries `{name}`. */
  readonly heading: string;
  /** Carries `{name}`. */
  readonly empty: string;
  readonly basedIn: string;
  readonly website: string;
  readonly since: string;
  readonly elsewhere: string;
}

export interface ProfileCopy {
  /** Carries `{name}`. */
  readonly avatarAlt: string;
  readonly tabsLabel: string;
  readonly tabs: {
    readonly created: string;
    readonly backed: string;
    readonly about: string;
  };
  readonly about: ProfileAboutCopy;
  readonly grid: ProfileGridCopy;
}

function cardCopyFrom(t: ProfileRawTranslator, common: CardTranslator): ProfileCardCopy {
  return {
    ...sharedCardCopyFrom(common),
    states: t.raw('card.states') as Readonly<Record<string, string>>,
  };
}

export function profileGridCopyFrom(
  t: ProfileRawTranslator,
  common: CardTranslator,
): ProfileGridCopy {
  return {
    failedTitle: t('grid.failedTitle'),
    failedBody: t('grid.failedBody'),
    createdEmptyTitle: t('grid.createdEmptyTitle'),
    createdEmptyBody: String(t.raw('grid.createdEmptyBody')),
    backedEmptyTitle: t('grid.backedEmptyTitle'),
    backedEmptyBody: String(t.raw('grid.backedEmptyBody')),
    showMore: t('grid.showMore'),
    showMoreCreated: t('grid.showMoreCreated'),
    showMoreBacked: t('grid.showMoreBacked'),
    loading: t('grid.loading'),
    nextFailedTitle: t('grid.nextFailedTitle'),
    refused: t('grid.refused'),
    unreachable: t('grid.unreachable'),
    card: cardCopyFrom(t, common),
  };
}

/** The route resolves `profile` and `common`; the card's shared sentences are in the second. */
export function profileCopyFrom(t: ProfileRawTranslator, common: CardTranslator): ProfileCopy {
  return {
    avatarAlt: String(t.raw('avatarAlt')),
    tabsLabel: t('tabsLabel'),
    tabs: {
      created: t('tabs.created'),
      backed: t('tabs.backed'),
      about: t('tabs.about'),
    },
    about: {
      heading: String(t.raw('about.heading')),
      empty: String(t.raw('about.empty')),
      basedIn: t('about.basedIn'),
      website: t('about.website'),
      since: t('about.since'),
      elsewhere: t('about.elsewhere'),
    },
    grid: profileGridCopyFrom(t, common),
  };
}

/* -------------------------------------------------------------------------
 * The editor that writes the profile above — issue #82, epic #78
 *
 * <h2>Why it is in this namespace rather than a new one</h2>
 *
 * The two halves describe the same six fields. Somebody who edits "Biography" should meet
 * the word they saw on their own profile, and a `settings.profile` group beside
 * `profile.about` would be two vocabularies for one thing, free to drift the first time
 * either is edited. `/u/[slug]` and `/settings/profile` read different keys out of one
 * namespace instead.
 *
 * <h2>Two of these are accessible names for images rather than labels</h2>
 *
 * `avatar.noPicture` is what a reader who cannot see the initials fallback is told, and
 * `avatar.cropped` is what stands in for the circular preview. They are what the screen says
 * to somebody who cannot see it, so they are copy rather than decoration.
 *
 * <h2>The bounds are in the sentences and the rules are not</h2>
 *
 * `nameHint`, `bioHint` and `links.hint` carry `{max}`, filled from the constants in
 * `lib/profiles/api.ts`. The numbers are said because saying what a rule is costs nothing;
 * none of them is enforced here, because `ProfileEditorPanel` records at length why a second
 * copy of the service's validation is a rule free to drift from the one that actually holds.
 * ---------------------------------------------------------------------- */

/** §4.2's P-03 — the avatar field, which takes an address rather than a file. */
export interface ProfileAvatarCopy {
  readonly label: string;
  readonly hint: string;
  readonly pipelineTitle: string;
  readonly pipelineBody: string;
  /** Carries `{name}`. The accessible name of the initials fallback. */
  readonly noPicture: string;
  readonly broken: string;
  /** What stands in for the circular preview, which is decorative. */
  readonly cropped: string;
  readonly initials: string;
  readonly address: string;
  readonly addressPlaceholder: string;
  readonly remove: string;
  readonly squareTitle: string;
  readonly notSquareTitle: string;
  /** Carries `{file}` and `{size}`. */
  readonly square: string;
  /** Carries `{file}` and `{size}`. */
  readonly notSquare: string;
  readonly unreadable: string;
  readonly prompt: string;
  readonly dragPrompt: string;
  readonly buttonLabel: string;
  readonly dropHint: string;
}

/** §4.2's P-02 — at most five accounts elsewhere, one per platform. */
export interface ProfileLinksCopy {
  readonly label: string;
  /** Carries `{max}`. */
  readonly hint: string;
  readonly none: string;
  /** Carries `{number}`. */
  readonly platformFor: string;
  /** Carries `{platform}`, which is a brand name and stays as it is in every language. */
  readonly addressFor: string;
  readonly addressPlaceholder: string;
  /** Carries `{platform}`. */
  readonly removeLink: string;
  readonly remove: string;
  readonly add: string;
  /** Carries `{used}` and `{max}`. */
  readonly used: string;
  /** Carries `{max}`. */
  readonly atCap: string;
  readonly allListedTitle: string;
  readonly allListedBody: string;
}

/** §4.2's P-07 — the switch that answers `/u/{slug}` as though nothing were there. */
export interface ProfileVisibilityCopy {
  readonly heading: string;
  readonly intro: string;
  readonly toggle: string;
  readonly public: string;
  readonly hidden: string;
  readonly checking: string;
  readonly unknownTitle: string;
  readonly unknownBody: string;
  readonly failedTitle: string;
  readonly refused: string;
  readonly unreachable: string;
  readonly seeAsVisitor: string;
}

/** §4.2's P-01, P-02 and P-03 — the profile editor. */
export interface ProfileEditorCopy {
  readonly heading: string;
  /** Carries `{address}`, which is a link rather than a string. */
  readonly liveAt: string;
  /** Carries `{slug}`. */
  readonly handleFixed: string;
  readonly handleWhy: string;
  readonly loadFailedTitle: string;
  readonly loadFailed: string;
  readonly loading: string;
  readonly saveFailedTitle: string;
  readonly unreachable: string;
  readonly name: string;
  /** Carries `{max}`. */
  readonly nameHint: string;
  readonly bio: string;
  /** Carries `{max}`. */
  readonly bioHint: string;
  readonly website: string;
  readonly websiteHint: string;
  readonly websitePlaceholder: string;
  readonly location: string;
  readonly locationHint: string;
  /** A real, selectable option: this field has to be clearable. */
  readonly notSaying: string;
  readonly locationsUnavailable: string;
  /** Carries `{place}`. */
  readonly locationsUnavailableWithValue: string;
  readonly saving: string;
  readonly save: string;
  readonly savedTitle: string;
  /** Carries `{address}`, which is a link rather than a string. */
  readonly savedBody: string;
  readonly avatar: ProfileAvatarCopy;
  readonly links: ProfileLinksCopy;
}

export function profileEditorCopyFrom(t: ProfileRawTranslator): ProfileEditorCopy {
  return {
    heading: t('editor.heading'),
    liveAt: String(t.raw('editor.liveAt')),
    handleFixed: String(t.raw('editor.handleFixed')),
    handleWhy: t('editor.handleWhy'),
    loadFailedTitle: t('editor.loadFailedTitle'),
    loadFailed: t('editor.loadFailed'),
    loading: t('editor.loading'),
    saveFailedTitle: t('editor.saveFailedTitle'),
    unreachable: t('editor.unreachable'),
    name: t('editor.name'),
    nameHint: String(t.raw('editor.nameHint')),
    bio: t('editor.bio'),
    bioHint: String(t.raw('editor.bioHint')),
    website: t('editor.website'),
    websiteHint: t('editor.websiteHint'),
    websitePlaceholder: t('editor.websitePlaceholder'),
    location: t('editor.location'),
    locationHint: t('editor.locationHint'),
    notSaying: t('editor.notSaying'),
    locationsUnavailable: t('editor.locationsUnavailable'),
    locationsUnavailableWithValue: String(t.raw('editor.locationsUnavailableWithValue')),
    saving: t('editor.saving'),
    save: t('editor.save'),
    savedTitle: t('editor.savedTitle'),
    savedBody: String(t.raw('editor.savedBody')),
    avatar: {
      label: t('editor.avatar.label'),
      hint: t('editor.avatar.hint'),
      pipelineTitle: t('editor.avatar.pipelineTitle'),
      pipelineBody: t('editor.avatar.pipelineBody'),
      noPicture: String(t.raw('editor.avatar.noPicture')),
      broken: t('editor.avatar.broken'),
      cropped: t('editor.avatar.cropped'),
      initials: t('editor.avatar.initials'),
      address: t('editor.avatar.address'),
      addressPlaceholder: t('editor.avatar.addressPlaceholder'),
      remove: t('editor.avatar.remove'),
      squareTitle: t('editor.avatar.squareTitle'),
      notSquareTitle: t('editor.avatar.notSquareTitle'),
      square: String(t.raw('editor.avatar.square')),
      notSquare: String(t.raw('editor.avatar.notSquare')),
      unreadable: t('editor.avatar.unreadable'),
      prompt: t('editor.avatar.prompt'),
      dragPrompt: t('editor.avatar.dragPrompt'),
      buttonLabel: t('editor.avatar.buttonLabel'),
      dropHint: t('editor.avatar.dropHint'),
    },
    links: {
      label: t('editor.links.label'),
      hint: String(t.raw('editor.links.hint')),
      none: t('editor.links.none'),
      platformFor: String(t.raw('editor.links.platformFor')),
      addressFor: String(t.raw('editor.links.addressFor')),
      addressPlaceholder: t('editor.links.addressPlaceholder'),
      removeLink: String(t.raw('editor.links.removeLink')),
      remove: t('editor.links.remove'),
      add: t('editor.links.add'),
      used: String(t.raw('editor.links.used')),
      atCap: String(t.raw('editor.links.atCap')),
      allListedTitle: t('editor.links.allListedTitle'),
      allListedBody: t('editor.links.allListedBody'),
    },
  };
}

export function profileVisibilityCopyFrom(t: ProfileRawTranslator): ProfileVisibilityCopy {
  return {
    heading: t('editor.visibility.heading'),
    intro: t('editor.visibility.intro'),
    toggle: t('editor.visibility.toggle'),
    public: t('editor.visibility.public'),
    hidden: t('editor.visibility.hidden'),
    checking: t('editor.visibility.checking'),
    unknownTitle: t('editor.visibility.unknownTitle'),
    unknownBody: t('editor.visibility.unknownBody'),
    failedTitle: t('editor.visibility.failedTitle'),
    refused: t('editor.visibility.refused'),
    unreachable: t('editor.visibility.unreachable'),
    seeAsVisitor: t('editor.visibility.seeAsVisitor'),
  };
}
