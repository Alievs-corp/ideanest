import { useEffect, useState, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * One sentence per plural category, each carrying `{count}`.
 *
 * ALL FOUR ARE REQUIRED, and a language that does not decline repeats one
 * sentence across them. That is the web application's own encoding — see
 * `lib/i18n/plurals.ts`, whose docblock gives the reason: its catalogue test
 * requires the four languages to hold identical keys, so a form declared in
 * Russian and omitted in Turkish would be a key set that differs by language.
 * The repetition is the honest encoding of a language that does not decline.
 *
 * CLDR also defines `zero` and `two`; none of this platform's languages uses
 * either, and `select` below falls back rather than assuming the set is closed.
 */
export type PluralForms = Readonly<Record<'one' | 'few' | 'many' | 'other', string>>;

export interface CharacterCountCopy {
  /** Under the limit. Carries `{count}`. */
  remaining: PluralForms;
  /** Over it. Carries `{count}`, which is how many too many. */
  tooMany: PluralForms;
}

/** English, so the component works with no catalogue behind it. */
export const CHARACTER_COUNT_COPY_EN: CharacterCountCopy = {
  remaining: {
    one: '{count} character remaining',
    few: '{count} characters remaining',
    many: '{count} characters remaining',
    other: '{count} characters remaining',
  },
  tooMany: {
    one: '{count} character too many',
    few: '{count} characters too many',
    many: '{count} characters too many',
    other: '{count} characters too many',
  },
};

export interface CharacterCountProps extends Omit<ComponentPropsWithoutRef<'p'>, 'children'> {
  /** Characters used, already counted the way the storage counts them. */
  count: number;
  limit: number;
  /** The two sentences, in the reader's language. */
  copy?: CharacterCountCopy;
  /** Which language's plural rule to select with. */
  locale?: string;
  /** Start announcing once this many characters or fewer remain. */
  announceWithin?: number;
  /** How long the count must be still before it is announced. */
  announceDelayMs?: number;
}

/**
 * How much of a length limit is left. See docs/ui-kit.md §7.13.
 *
 * COLOUR IS NOT THE MESSAGE. Passing the limit changes the wording — "3
 * characters too many" — and only then the colour (§9.2). A counter that merely
 * turns red has told a colour-blind creator nothing, and a screen reader
 * nothing at all.
 *
 * THE VISIBLE COUNT IS `aria-hidden`, AND THE ANNOUNCEMENT IS SEPARATE. Two
 * different things are needed from one number: a sighted creator wants it
 * present at all times, and a screen-reader user wants to hear it only when it
 * starts to matter. Announcing every keystroke would talk over the typing echo
 * — the field becomes unusable long before the limit is reached — so the live
 * region stays empty until the remainder is inside `announceWithin`, and then
 * settles for `announceDelayMs` before it says anything. It is the pattern the
 * GOV.UK character count arrived at after user testing, for the same reason.
 *
 * `role="status"` is polite by definition: it waits for a pause rather than
 * interrupting. An `alert` here would interrupt, which is precisely the
 * behaviour being avoided.
 *
 * Counting is the caller's job, through `count`. Characters are not code units:
 * `'🙂'.length` is 2, and a counter that says 61 while the database is happy
 * with 60 is a counter that lies. The web application counts code points, which
 * is how Postgres counts `varchar(60)`.
 *
 * <h2>The sentence is the caller's too, and it has to be</h2>
 *
 * This used to build "3 characters too many" from an English plural rule in
 * code — `value === 1 ? 'character' : 'characters'`. That rule is English's
 * and no other language's: Russian selects between three forms by the last
 * digit, Azerbaijani and Turkish take no plural agreement after a numeral at
 * all, and a counter that is a sentence rather than a fraction (§7.13) cannot
 * be assembled from a number and a noun handed over separately.
 *
 * So the caller supplies the forms, keyed by the categories `Intl.PluralRules`
 * reports, and this picks between them for `locale`. `Intl.PluralRules` is in
 * every browser this platform supports and costs nothing in the bundle — it is
 * the platform internationalisation API §21.1 already asks for elsewhere.
 *
 * The library carries no catalogue, so the English forms stay as defaults: the
 * component works standing alone in Storybook, and an application that has a
 * catalogue passes its own.
 */
export function CharacterCount({
  count,
  limit,
  copy = CHARACTER_COUNT_COPY_EN,
  locale = 'en',
  announceWithin = 20,
  announceDelayMs = 1000,
  className,
  ...props
}: CharacterCountProps) {
  const remaining = limit - count;
  const over = remaining < 0;

  const value = over ? -remaining : remaining;
  const visible = sentence(over ? copy.tooMany : copy.remaining, value, locale);

  const [announced, setAnnounced] = useState('');

  useEffect(() => {
    if (remaining > announceWithin) {
      // Clearing rather than leaving the last message behind: a stale "2
      // characters remaining" is read again by anything that re-announces the
      // region, and it is no longer true.
      setAnnounced('');
      return;
    }

    const timer = setTimeout(() => setAnnounced(visible), announceDelayMs);
    return () => clearTimeout(timer);
  }, [visible, remaining, announceWithin, announceDelayMs]);

  return (
    <p
      {...props}
      className={cn(
        'text-[13px] tabular-nums transition-colors duration-150 ease-in-out',
        over ? 'text-danger' : 'text-white/40',
        className,
      )}
    >
      <span aria-hidden="true">{visible}</span>

      {/*
        Rendered on every pass so the region exists in the accessibility tree
        before anything is put in it. A live region created and filled in the
        same commit is not reliably announced.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {announced}
      </span>
    </p>
  );
}

/**
 * The form `locale` selects for `value`, with `{count}` filled in.
 *
 * `other` is the fallback at every step — for a category the caller did not
 * supply, and for a `locale` tag `Intl` cannot parse. A counter that throws
 * would take the field down over a language tag; one that falls back reads
 * slightly wrong in a language nobody configured, which is the cheaper failure.
 */
function sentence(forms: PluralForms, value: number, locale: string): string {
  let category = 'other';
  try {
    category = new Intl.PluralRules(locale).select(value);
  } catch {
    /* An unparseable tag is not worth an exception in a character counter. */
  }

  const form = (forms as Readonly<Record<string, string | undefined>>)[category] ?? forms.other;
  return form.replace('{count}', String(value));
}
