import az from '../messages/az.json';
import en from '../messages/en.json';
import ru from '../messages/ru.json';
import tr from '../messages/tr.json';
import type { Locale } from './lib/i18n/locale';

const CATALOGUES: Readonly<Record<Locale, unknown>> = { az, en, ru, tr };

/**
 * The English catalogue, as the lookup a `*-copy.ts` builder takes — issue #324.
 *
 * <h2>Why a test builds the copy instead of typing the words</h2>
 *
 * Every client component that draws words is handed them as a prop, resolved on the server
 * (`lib/i18n/shell-copy.ts` carries the measurement that decided it). A test therefore has to
 * supply that object, and there are two ways to do it: retype the sentences, or build them
 * from the catalogue with the same function the page calls.
 *
 * Retyping gives a test that passes whatever the catalogue says. It would still be green with
 * the message file empty, which is precisely the defect `catalogue.test.ts` and
 * `account-area.pages.test.ts` exist to catch. So the builders are run over `messages/en.json`
 * here, and an assertion is made against the words the application will actually draw.
 *
 * <h2>English, deliberately, and only English</h2>
 *
 * A test that asserted in four languages would be asserting that a translation exists, which
 * `catalogue.test.ts` already does for every key at once. What a component test is for is the
 * wiring — that the button asks for `submit` rather than carrying a literal — and one language
 * shows that as well as four while keeping the assertions readable to everybody reviewing them.
 *
 * <p>The one exception is a defect English cannot show — a label that used to be an English
 * literal is still English in English. Such a test passes the locale it renders in, and asserts
 * through the same lookup rather than a retyped list of that language's words, which would pass
 * whatever the catalogue said.
 *
 * <p>`raw` is next-intl's own escape hatch for a message that is not a string, and a couple of
 * builders use it. It is here so a test's lookup has the same surface as the real one.
 */
export function translatorFor(
  namespace: string,
  locale: Locale = 'en',
): {
  (key: string): string;
  raw(key: string): unknown;
} {
  function at(key: string): unknown {
    let node: unknown = CATALOGUES[locale];
    for (const segment of `${namespace}.${key}`.split('.')) {
      node = (node as Record<string, unknown>)[segment];
    }
    return node;
  }

  return Object.assign(
    (key: string): string => {
      const message = at(key);
      /* Throwing names the missing key. Returning `undefined` would fail three frames away. */
      if (typeof message !== 'string') throw new Error(`no message at ${namespace}.${key}`);

      /*
       * IT REFUSES A TEMPLATE, THE WAY next-intl DOES.
       *
       * `t('x')` on a message carrying `{name}` is a formatting error in next-intl — it has no
       * value for the argument, so it calls `onError` and renders the key's own path. A builder
       * that reads such a message must use `t.raw`, and `fillPlaceholders` puts the value in
       * where it is known.
       *
       * A plain lookup here would return the template happily and every test would pass while
       * the application drew `profile.about.heading` under somebody's name. So this refuses
       * exactly what next-intl refuses, and names the fix.
       */
      if (/\{\w+\}/u.test(message)) {
        throw new Error(
          `${namespace}.${key} carries a placeholder — read it with t.raw and fill it with fillPlaceholders`,
        );
      }

      return message;
    },
    { raw: at },
  );
}
