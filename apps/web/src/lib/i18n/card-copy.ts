import type { PluralForms } from './plurals';

/**
 * The words a campaign card draws, wherever it is drawn — issue #324.
 *
 * <h2>Why `common.card` exists as well as `discovery.card`</h2>
 *
 * This platform has two campaign cards. `components/discovery/ProjectCard` is the one the home
 * page, the feed, the search results, the category landings and the collections all render —
 * `CampaignGrid`'s docblock argues at length that a second card for the same JSON is a second
 * place for the money rules to be wrong. `components/profile/ProfileCampaignCard` is the other,
 * and it exists because §4.2's P-04 withholds amounts on a backed list, which is a rule about
 * what may be shown rather than about how to show it.
 *
 * Four of their sentences are word for word the same: the progress bar's accessible name, the
 * completion figure, the goal under it, and the backer count. Those live in `common.card` and
 * both read them. A second copy in each namespace would be two spellings of "of {amount} goal"
 * that agree until somebody edits one.
 *
 * `discovery.card` holds what is genuinely this card's own: the five status words, the deadline
 * and the creator's byline. `profile.card` holds the nine status words of an archive, which are
 * a different vocabulary for a different reader — `lib/i18n/profile-copy.ts` says why.
 *
 * <h2>Why it is a prop</h2>
 *
 * `ProjectCard` has no `'use client'` and is rendered both by `CampaignGrid`, which is a server
 * component, and by `DiscoveryView`, which is not. A component in both graphs cannot call
 * `getTranslations`; it is handed the words by whichever parent resolved them.
 */

/** A message lookup, narrowed to what these builders need. */
export interface CardTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** The four sentences both cards draw. `common.card` in the catalogue. */
export interface SharedCardCopy {
  /** Carries `{percent}`. The accessible name of the progress bar. */
  readonly progressLabel: string;
  /** Carries `{percent}`. */
  readonly funded: string;
  /** Carries `{amount}`, already formatted by `lib/money.ts` against the campaign's currency. */
  readonly ofGoal: string;
  readonly backers: PluralForms;
  /** IDN-EXT-01 §9: "succeeds at 80% of the goal", printed under the progress bar (#44). */
  readonly rule: string;
}

export interface ProjectCardCopy extends SharedCardCopy {
  /** Keyed by `DiscoveryStatus`. Five words, each of which also carries an icon and a hue. */
  readonly badges: Readonly<Record<string, string>>;
  /** Carries `{creator}`, which is a styled node — `fillNodes` fills it. */
  readonly by: string;
  /** The deadline when it is today. Not "0 days left", which reads as "none". */
  readonly lastDay: string;
  readonly daysLeft: PluralForms;
  readonly notOpen: string;
}

export function sharedCardCopyFrom(common: CardTranslator): SharedCardCopy {
  return {
    progressLabel: String(common.raw('card.progressLabel')),
    funded: String(common.raw('card.funded')),
    ofGoal: String(common.raw('card.ofGoal')),
    backers: common.raw('card.backers') as PluralForms,
    rule: String(common.raw('card.rule')),
  };
}

export function projectCardCopyFrom(t: CardTranslator, common: CardTranslator): ProjectCardCopy {
  return {
    ...sharedCardCopyFrom(common),
    badges: t.raw('badges') as Readonly<Record<string, string>>,
    by: String(t.raw('by')),
    lastDay: t('lastDay'),
    daysLeft: t.raw('daysLeft') as PluralForms,
    notOpen: t('notOpen'),
  };
}
