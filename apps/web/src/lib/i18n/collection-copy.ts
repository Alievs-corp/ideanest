import type { WindowCopy } from '@ideanest/discovery/collections';
import type { PluralForms } from './plurals';

/**
 * Every word the two collection surfaces draw — issue #324.
 *
 * <h2>Why this is a prop and not a `getTranslations` inside each component</h2>
 *
 * `CollectionHeader`, `CollectionCard` and `CollectionIndex` are synchronous server components
 * with tests that render them directly, and Testing Library cannot render an async component —
 * `test-support/server-tree.ts` explains what that failure looks like when it happens. They
 * already took `locale` and `windowCopy` as props for exactly this reason since #123, and this
 * is the same arrangement widened to the rest of their vocabulary. `CollectionCampaigns` is a
 * client component and could not read the catalogue at all.
 *
 * <h2>Three counted sentences, and none of them can be ICU</h2>
 *
 * `count` is the collection's own total, drawn by a synchronous component; `shown` and
 * `shownMore` are drawn by a client component after a button appends a page. next-intl formats
 * ICU on the server inside an async call, so all three go through
 * `packages/messages/src/plurals.ts` instead — which carries the same CLDR data and none of the
 * runtime.
 *
 * <p>`shown` and `shownMore` are two sets rather than one plus a suffix. English appends ",
 * with more to load" and Russian changes the verb's agreement with the number in front of it,
 * so a suffix concatenated onto a formatted count is a sentence that is correct in exactly one
 * of the four languages.
 */

/** A message lookup rooted at `discovery.collections`. */
export interface CollectionTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** The two terms a collection's window is stated with. `windowFacts` takes it. */
export type { WindowCopy };

export interface CollectionCardCopy {
  /** Keyed by the service's kind; a kind not in the table renders no tag at all. */
  readonly kinds: Readonly<Record<string, string>>;
  readonly campaigns: string;
  readonly window: WindowCopy;
}

export interface CollectionHeaderCopy {
  /** The trail: what the nav is called, and the name of the index it climbs to. */
  readonly breadcrumb: string;
  readonly collections: string;
  readonly kinds: Readonly<Record<string, string>>;
  /** One sentence per kind, keyed the same way. Absent for a kind this build does not know. */
  readonly sentences: Readonly<Record<string, string>>;
  readonly inCollection: string;
  readonly count: PluralForms;
  readonly badge: string;
  readonly badgeOpenCall: string;
  readonly badgeCurated: string;
  readonly window: WindowCopy;
}

export interface CollectionCampaignsCopy {
  readonly emptyTitle: string;
  /** Carries `{title}`. */
  readonly emptyBody: string;
  readonly emptyAction: string;
  /** Carries `{title}`. */
  readonly gridLabel: string;
  /** Carries `{title}`. */
  readonly showMoreLabel: string;
  readonly showMore: string;
  readonly loading: string;
  readonly nextFailedTitle: string;
  readonly refused: string;
  readonly unreachable: string;
  readonly shown: PluralForms;
  readonly shownMore: PluralForms;
}

export interface CollectionIndexCopy {
  readonly title: string;
  readonly intro: string;
  readonly listLabel: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyAction: string;
  readonly card: CollectionCardCopy;
}

function windowCopyFrom(t: CollectionTranslator): WindowCopy {
  return { closes: t('window.closes'), openSince: t('window.openSince') };
}

function kindsFrom(t: CollectionTranslator): Readonly<Record<string, string>> {
  return t.raw('kinds') as Readonly<Record<string, string>>;
}

export function collectionCardCopyFrom(t: CollectionTranslator): CollectionCardCopy {
  return {
    kinds: kindsFrom(t),
    campaigns: t('cardCampaigns'),
    window: windowCopyFrom(t),
  };
}

/**
 * The header takes `common` as well as its own namespace.
 *
 * Its breadcrumb is the same pair of words `CategoryLanding` renders — the nav's name and
 * "Collections" — and those live under `common` precisely so two surfaces cannot come to two
 * spellings of one trail.
 */
export function collectionHeaderCopyFrom(
  t: CollectionTranslator,
  common: (key: string) => string,
): CollectionHeaderCopy {
  return {
    breadcrumb: common('breadcrumb'),
    collections: common('trail.collections'),
    kinds: kindsFrom(t),
    sentences: t.raw('sentences') as Readonly<Record<string, string>>,
    inCollection: t('inCollection'),
    count: t.raw('count') as PluralForms,
    badge: t('badge'),
    badgeOpenCall: t('badgeOpenCall'),
    badgeCurated: t('badgeCurated'),
    window: windowCopyFrom(t),
  };
}

export function collectionCampaignsCopyFrom(t: CollectionTranslator): CollectionCampaignsCopy {
  return {
    emptyTitle: t('campaignsEmptyTitle'),
    emptyBody: String(t.raw('campaignsEmptyBody')),
    emptyAction: t('emptyAction'),
    gridLabel: String(t.raw('gridLabel')),
    showMoreLabel: String(t.raw('showMoreLabel')),
    showMore: t('showMore'),
    loading: t('loading'),
    nextFailedTitle: t('nextFailedTitle'),
    refused: t('refused'),
    unreachable: t('unreachable'),
    shown: t.raw('shown') as PluralForms,
    shownMore: t.raw('shownMore') as PluralForms,
  };
}

export function collectionIndexCopyFrom(t: CollectionTranslator): CollectionIndexCopy {
  return {
    title: t('title'),
    intro: t('intro'),
    listLabel: t('listLabel'),
    emptyTitle: t('emptyTitle'),
    emptyBody: t('emptyBody'),
    emptyAction: t('emptyAction'),
    card: collectionCardCopyFrom(t),
  };
}
