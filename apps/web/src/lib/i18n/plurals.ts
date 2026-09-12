import { INTL_LOCALE } from './formats';
import type { Locale } from './locale';
import { fillPlaceholders } from './placeholders';

/**
 * A count in a sentence, where the count is only known in the browser — issue #324.
 *
 * <h2>Why this exists beside the catalogue's ICU plurals</h2>
 *
 * Most counted sentences in this application are resolved on the server, and they are written
 * as ICU: `discovery.search.count` is
 * `{count, plural, =0 {No campaigns matched} one {# campaign} other {# campaigns}}`, and
 * next-intl formats it with the real CLDR rules. That is the right shape and stays the default.
 *
 * It cannot reach a list that grows after the page has loaded. `ProfileCampaignGrid` appends a
 * page of cards on a click, and each card states how many people backed it — a number that did
 * not exist when the server rendered. Formatting ICU in the browser means the `use-intl`
 * runtime in the bundle, which is the cost `lib/i18n/shell-copy.ts` measured and refused.
 *
 * <h2>Why not a ternary</h2>
 *
 * Because "backer" against "backers" is the whole of English and none of Russian, which picks
 * between three forms by the last digit — 1 бэкер, 2 бэкера, 5 бэкеров. A singular/plural
 * split is wrong for most numbers in one of the four languages, and there is nothing on screen
 * to say so. `Intl.PluralRules` is in every browser this application supports and carries the
 * same CLDR data ICU would.
 *
 * <h2>All four categories exist in all four languages, and that is deliberate</h2>
 *
 * `catalogue.test.ts` requires the four catalogues to hold identical keys, so a message that
 * declined in Russian and not in Turkish would be a key set that differs by language and a
 * test that fails on the wrong file. Azerbaijani, English and Turkish repeat one form across
 * the categories they do not distinguish; that repetition is the honest encoding of a language
 * that does not decline, and it is what lets `select` be trusted without a per-language branch.
 *
 * <p>CLDR also defines `zero` and `two`, and none of §21.1's four languages uses either — Arabic
 * and Welsh do. They are left out rather than carried as two more copies of `other`, and the
 * lookup below falls back rather than assuming the set is closed.
 */
export type PluralForms = Readonly<Record<'one' | 'few' | 'many' | 'other', string>>;

/**
 * The form `locale` selects for `count`, WITH `{count}` STILL IN IT.
 *
 * For a sentence whose number is a node rather than a string — a bold count inside the
 * sentence, say. `fillNodes` needs the placeholder to still be there, and {@link pluralise}
 * has already replaced it, so a caller that reached for `pluralise` and then `fillNodes`
 * silently got the plain text and no node. That happened; this is the half to reach for.
 *
 * The rules object is constructed per call rather than cached. It is built from a four-value
 * table, `Intl` implementations memoise their own, and a module-level cache keyed by locale
 * would be state in a module that is imported by both a server render and a client bundle.
 */
export function pluralForm(locale: Locale, forms: PluralForms, count: number): string {
  const category = new Intl.PluralRules(INTL_LOCALE[locale]).select(count);

  /*
   * `other` is the fallback rather than a throw. Every CLDR locale defines it, so the only way
   * to reach it is a category a future language adds — and a slightly ungrammatical count is a
   * better answer than a component that does not render.
   */
  return (forms as Readonly<Record<string, string | undefined>>)[category] ?? forms.other;
}

/** The form for `count`, with `{count}` filled in. The common case. */
export function pluralise(locale: Locale, forms: PluralForms, count: number): string {
  return fillPlaceholders(pluralForm(locale, forms, count), { count: String(count) });
}
