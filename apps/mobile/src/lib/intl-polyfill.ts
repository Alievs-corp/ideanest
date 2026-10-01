/**
 * `Intl.PluralRules` on Hermes — loaded before anything in the application translates.
 *
 * <h2>What was broken</h2>
 *
 * <p>A release APK on a real Android phone drew the raw key `campaign.daysLeft` on a campaign
 * card. Hermes implements `Intl.Collator`, `DateTimeFormat`, `NumberFormat` and
 * `getCanonicalLocales`, and <strong>not</strong> `Intl.PluralRules` — on Android or on iOS. Every
 * ICU `{count, plural, …}` message in the catalogues goes through `intl-messageformat`, which asks
 * for `new Intl.PluralRules(...)`, fails, and `use-intl` falls back to the key. `@ideanest/messages`'
 * own `pluralForm` asks the same constructor, so every count the app declines by hand failed too.
 * Neither failure shows in jest or in a browser, where the constructor exists.
 *
 * <h2>The fix, at the root</h2>
 *
 * <p>`@formatjs/intl-pluralrules/polyfill.js` installs the constructor only when the engine lacks
 * one (or has one that is broken), so an engine that grows its own keeps it. The four languages
 * the catalogues hold are registered with it — CLDR's rules for exactly `en`, `az`, `ru` and `tr`,
 * and nothing else, which keeps the bundle to what the app can say. On an engine that already has
 * the constructor the data files see no `__addLocaleData` and do nothing.
 *
 * <h2>Why here and not in the root layout</h2>
 *
 * <p>This module is imported by `index.ts`, the application's entry, ahead of
 * `expo-router/entry`. Expo Router evaluates the root layout and every route module after its
 * entry has run, and a module anywhere in that graph may translate at import time (a constant
 * built with `translate()`, a table of copy); an import at the top of `_layout.tsx` would only
 * be first among the layout's own imports. The entry is the one place that is first for all of
 * them.
 *
 * <p>`Intl.Locale` is missing on Hermes too, and the polyfill's default "best fit" matcher reaches
 * for it when a region tag such as `en-GB` has no exact data. `pluralForm` therefore asks with
 * `localeMatcher: 'lookup'`, which resolves `en-GB` to `en` by truncation and needs nothing else;
 * the ICU path asks with the bare `en`, `az`, `ru` or `tr`, which match exactly.
 */
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/az.js';
import '@formatjs/intl-pluralrules/locale-data/ru.js';
import '@formatjs/intl-pluralrules/locale-data/tr.js';
