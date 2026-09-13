import type { PluralForms } from './plurals';

/**
 * Every word the discovery feed draws — issue #324.
 *
 * <h2>Why the vocabularies moved out of `lib/discovery/vocabulary.ts`</h2>
 *
 * That module pairs each value of a closed vocabulary with the word a reader sees:
 * `{ value: 'successful', label: 'Successful' }`. The values are the service's and must not
 * move — a typo there is `400 DISCOVERY_VALUE_UNKNOWN` and a feed that never loads. The labels
 * are copy, and they were the only English left on the platform's front door.
 *
 * So the values stayed and the labels became records keyed by value. A value this build sends
 * but has no word for renders as the value itself, which is what `labelOf` did.
 *
 * <h2>Everything on this route is a client component</h2>
 *
 * `DiscoveryView` reads the URL with `useSearchParams`, the rail applies on change, the search
 * box holds a draft between keystrokes. None of them can call `getTranslations`, so the route
 * resolves this once and hands it down — the arrangement `lib/i18n/shell-copy.ts` measured and
 * `lib/i18n/checkout-copy.ts` repeats.
 *
 * <h2>Six counted sentences, and why none of them is ICU</h2>
 *
 * The feed's count changes with every page appended in the browser, and the announcement that
 * follows it is read by a screen reader at the same moment. Both go through
 * `lib/i18n/plurals.ts` — CLDR's own data, none of `use-intl`'s runtime.
 */

/** A message lookup, narrowed to what these builders need. */
export interface FeedTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** The closed vocabularies, keyed by the service's own value. */
export interface FilterVocabularyCopy {
  readonly status: Readonly<Record<string, string>>;
  readonly sort: Readonly<Record<string, string>>;
  readonly completion: Readonly<Record<string, string>>;
  readonly amount: Readonly<Record<string, string>>;
  /** What each dimension is called, for a chip's accessible name and a fieldset's legend. */
  readonly groups: {
    readonly status: string;
    readonly category: string;
    readonly subcategory: string;
    readonly completion: string;
    readonly goal: string;
    readonly raised: string;
    readonly tag: string;
    readonly tags: string;
  };
  /** A custom money range, which has no value in the vocabulary. Each carries placeholders. */
  readonly range: {
    readonly between: string;
    readonly from: string;
    readonly upTo: string;
  };
}

export interface SuggestCopy {
  readonly formLabel: string;
  readonly inputLabel: string;
  readonly placeholder: string;
  readonly listboxLabel: string;
  readonly submit: string;
  readonly looking: string;
  readonly lookingAnnounce: string;
  readonly unavailableAnnounce: string;
  readonly failedFallback: string;
  /** Carries `{detail}` — the service's own sentence, which only it knows. */
  readonly failedDetail: string;
  /** Carries `{query}`. */
  readonly none: string;
  /** Keyed by `SuggestionKind`. Text beside the row, never an icon (§9.2). */
  readonly kinds: Readonly<Record<string, string>>;
}

export interface FeedCopy {
  readonly title: string;
  readonly standfirst: string;
  readonly filtersLabel: string;
  readonly railLabel: string;
  readonly resultsHeading: string;
  readonly none: string;
  readonly sortLabel: string;
  readonly customRange: string;
  /** Carries `{dimension}`. */
  readonly lowest: string;
  /** Carries `{dimension}`. */
  readonly highest: string;
  readonly applyRange: string;
  /** Carries `{dimension}`. */
  readonly applyRangeLabel: string;
  readonly rangeInvalid: string;
  readonly rangeUnordered: string;
  /** Carries `{category}`. */
  readonly subcategoriesOf: string;
  readonly loading: string;
  readonly loadingMore: string;
  readonly showMore: string;
  readonly appliedFilters: string;
  readonly clearAll: string;
  /** Carries `{group}` and `{label}`. */
  readonly removeChip: string;
  readonly tryAgain: string;
  readonly errorTitle: string;
  readonly unreachable: string;
  readonly refused: string;
  /** Carries `{query}`. */
  readonly emptyQueryTitle: string;
  readonly emptyFilteredTitle: string;
  readonly emptyTitle: string;
  readonly emptyQueryBody: string;
  readonly emptyQueryBodyFiltered: string;
  readonly emptyBody: string;
  /** Carries `{filter}`, which is emphasised — `fillNodes` fills it. */
  readonly blamedOne: string;
  /** Carries `{filters}`, likewise. */
  readonly blamedMany: string;
  /** Carries `{label}`. */
  readonly removeFilter: string;
  readonly clearSearch: string;
  readonly endAll: string;
  readonly endFeed: string;
  readonly announceNone: string;
  readonly shown: PluralForms;
  readonly shownMore: PluralForms;
  readonly announceShown: PluralForms;
  readonly announceMore: PluralForms;
  readonly filters: FilterVocabularyCopy;
  readonly suggest: SuggestCopy;
}

export function filterVocabularyCopyFrom(t: FeedTranslator): FilterVocabularyCopy {
  const record = (key: string) => t.raw(key) as Readonly<Record<string, string>>;

  return {
    status: record('status'),
    sort: record('sort'),
    completion: record('completion'),
    amount: record('amount'),
    groups: record('groups') as FilterVocabularyCopy['groups'],
    range: record('range') as unknown as FilterVocabularyCopy['range'],
  };
}

export function suggestCopyFrom(t: FeedTranslator): SuggestCopy {
  return {
    formLabel: t('formLabel'),
    inputLabel: t('inputLabel'),
    placeholder: t('placeholder'),
    listboxLabel: t('listboxLabel'),
    submit: t('submit'),
    looking: t('looking'),
    lookingAnnounce: t('lookingAnnounce'),
    unavailableAnnounce: t('unavailableAnnounce'),
    failedFallback: t('failedFallback'),
    failedDetail: String(t.raw('failedDetail')),
    none: String(t.raw('none')),
    kinds: t.raw('kinds') as Readonly<Record<string, string>>,
  };
}

/**
 * The whole feed's vocabulary.
 *
 * Three namespaces because the three are read separately elsewhere: the vocabularies are what
 * `activeFilters` needs and nothing else, and the suggestion words belong to a control that a
 * surface could render without the rail.
 */
export function feedCopyFrom(
  t: FeedTranslator,
  filters: FeedTranslator,
  suggest: FeedTranslator,
): FeedCopy {
  return {
    title: t('title'),
    standfirst: t('standfirst'),
    filtersLabel: t('filtersLabel'),
    railLabel: t('railLabel'),
    resultsHeading: t('resultsHeading'),
    none: t('none'),
    sortLabel: t('sortLabel'),
    customRange: t('customRange'),
    lowest: String(t.raw('lowest')),
    highest: String(t.raw('highest')),
    applyRange: t('applyRange'),
    applyRangeLabel: String(t.raw('applyRangeLabel')),
    rangeInvalid: t('rangeInvalid'),
    rangeUnordered: t('rangeUnordered'),
    subcategoriesOf: String(t.raw('subcategoriesOf')),
    loading: t('loading'),
    loadingMore: t('loadingMore'),
    showMore: t('showMore'),
    appliedFilters: t('appliedFilters'),
    clearAll: t('clearAll'),
    removeChip: String(t.raw('removeChip')),
    tryAgain: t('tryAgain'),
    errorTitle: t('errorTitle'),
    unreachable: t('unreachable'),
    refused: t('refused'),
    emptyQueryTitle: String(t.raw('emptyQueryTitle')),
    emptyFilteredTitle: t('emptyFilteredTitle'),
    emptyTitle: t('emptyTitle'),
    emptyQueryBody: t('emptyQueryBody'),
    emptyQueryBodyFiltered: t('emptyQueryBodyFiltered'),
    emptyBody: t('emptyBody'),
    blamedOne: String(t.raw('blamedOne')),
    blamedMany: String(t.raw('blamedMany')),
    removeFilter: String(t.raw('removeFilter')),
    clearSearch: t('clearSearch'),
    endAll: t('endAll'),
    endFeed: t('endFeed'),
    announceNone: t('announceNone'),
    shown: t.raw('shown') as PluralForms,
    shownMore: t.raw('shownMore') as PluralForms,
    announceShown: t.raw('announceShown') as PluralForms,
    announceMore: t.raw('announceMore') as PluralForms,
    filters: filterVocabularyCopyFrom(filters),
    suggest: suggestCopyFrom(suggest),
  };
}
