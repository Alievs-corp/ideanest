/**
 * The words a filter chip and a filter group are drawn with, as the feed's logic needs them.
 *
 * The labels are `discovery.filters.{status,sort,completion,amount,groups,range}` in the shared
 * catalogue (#324), keyed by the service's own value. Both applications resolve the same keys
 * through their own translator — next-intl on the web, use-intl on the phone — and hand the
 * result to `activeFilters`, so a chip says the same thing on both.
 */

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

/**
 * The part of a translator this needs: the raw catalogue value under a key.
 *
 * Raw rather than formatted, because these are whole tables — a record of value to word — and
 * the range templates keep their `{min}` and `{max}` for `activeFilters` to fill.
 */
export interface RawTranslator {
  raw(key: string): unknown;
}

/** The vocabularies, read from a translator scoped to `discovery.filters`. */
export function filterVocabularyCopyFrom(t: RawTranslator): FilterVocabularyCopy {
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
