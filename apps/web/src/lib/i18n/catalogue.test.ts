import { describe, expect, it } from 'vitest';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { SUPPORTED_LOCALES, type Locale } from './locale';

/**
 * Properties every catalogue must have, whatever is in it — issue #324.
 *
 * These are not about any one screen. They are the defects that survive review because the
 * reviewer does not read all four languages, and that a per-component test would only catch
 * for the component it covers.
 */
const CATALOGUES: Record<Locale, unknown> = { az, en, ru, tr };

/** The scripts each language is actually written in. */
const CYRILLIC = /[Ѐ-ӿ]/u;
const LATIN_SCRIPT: readonly Locale[] = ['az', 'en', 'tr'];

/**
 * Greek, which none of the four languages uses at all.
 *
 * A separate check from the Cyrillic one because it catches a different accident. Cyrillic
 * lands in Azerbaijani from a keyboard left in the wrong layout; Greek lands in **Russian**
 * from a text editor's own substitution — ά, έ and ή are drawn almost identically to а, е
 * and н at body size, and one of them replaced the ё in `вс ё` while this catalogue was
 * being written. Neither block belongs anywhere here.
 */
const GREEK = /[Ͱ-Ͽἀ-῿]/u;

function entries(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value !== 'object' || value === null) return [];

  return Object.entries(value).flatMap(([key, child]) =>
    entries(child, path === '' ? key : `${path}.${key}`),
  );
}

const KEYS_OF = (locale: Locale) => entries(CATALOGUES[locale]).map(([key]) => key);

describe('the message catalogues', () => {
  it('hold exactly the same keys, so no language can ship a screen half-translated', () => {
    /*
     * A missing key does not throw in production — `getMessageFallback` renders the key's own
     * name — so the failure is a Turkish reader shown `settings.pages.security.intro` where a
     * sentence belongs, on a page nobody on the team reads in Turkish.
     */
    const english = [...KEYS_OF('en')].sort();

    for (const locale of SUPPORTED_LOCALES) {
      expect([...KEYS_OF(locale)].sort(), `${locale} against en`).toEqual(english);
    }
  });

  it.each(SUPPORTED_LOCALES)('has no empty or whitespace-only message in %s', (locale) => {
    for (const [key, message] of entries(CATALOGUES[locale])) {
      expect(message.trim(), `${locale} ${key}`).not.toBe('');
    }
  });

  it.each(LATIN_SCRIPT)('writes %s in the Latin script, with no Cyrillic homoglyphs', (locale) => {
    /*
     * THE DEFECT THIS EXISTS FOR IS INVISIBLE. Cyrillic а, е, о, р, с, х and у are drawn
     * identically to their Latin counterparts in almost every typeface, so a single one that
     * slips into an Azerbaijani or Turkish string — pasted from a Russian draft, or typed on a
     * keyboard left in the wrong layout — reads as correct to every human reviewer.
     *
     * It is not harmless. The word stops matching a search, a screen reader switches voice
     * mid-word, and until the `cyrillic` cut was added to Inter it also rendered in a
     * different typeface than the letters beside it. One was found in
     * `account.pages.surveys.intro` — "buraxılış" written with a Cyrillic х — by the sweep
     * this test is the permanent form of.
     */
    for (const [key, message] of entries(CATALOGUES[locale])) {
      expect(CYRILLIC.test(message), `${locale} ${key}: ${message}`).toBe(false);
    }
  });

  it.each(SUPPORTED_LOCALES)('writes %s without a Greek character anywhere', (locale) => {
    for (const [key, message] of entries(CATALOGUES[locale])) {
      expect(GREEK.test(message), `${locale} ${key}: ${message}`).toBe(false);
    }
  });

  it('keeps every rich-text tag balanced and matched across languages', () => {
    /*
     * `t.rich` throws when a string uses a tag the call site does not supply, and renders a
     * sentence with a link silently missing when a translation drops one. Comparing each
     * language's tags against English catches both from the catalogue side, for every
     * namespace at once, rather than one screen at a time.
     */
    const tagsIn = (message: string) =>
      [...message.matchAll(/<(\w+)>/gu)].map((match) => match[1] as string).sort();

    for (const [key, english] of entries(CATALOGUES['en'])) {
      const expected = tagsIn(english);
      if (expected.length === 0) continue;

      for (const locale of SUPPORTED_LOCALES) {
        const message = entries(CATALOGUES[locale]).find(([other]) => other === key)?.[1] ?? '';

        expect(tagsIn(message), `${locale} ${key}`).toEqual(expected);

        for (const tag of new Set(expected)) {
          expect(message, `${locale} ${key} closes <${tag}>`).toContain(`</${tag}>`);
        }
      }
    }
  });

  it('uses one dash convention, so a sentence does not change shape between languages', () => {
    /*
     * The English copy uses an em dash with spaces around it, which is the house style visible
     * throughout `docs/`. A translation that used a hyphen instead is not wrong enough to
     * report and is exactly the kind of drift that accumulates until the interface reads as
     * having been written by four people, which it was.
     */
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, message] of entries(CATALOGUES[locale])) {
        expect(message, `${locale} ${key} uses a spaced hyphen where an em dash belongs`).not.toMatch(
          / - /u,
        );
      }
    }
  });

  it('never uses a word that is right in one sense and wrong in this one', () => {
    /*
     * A short list of confusions that read as fluent and mean something else. Each earned its
     * place by being written, shipped past a first reading, and caught later.
     *
     * `təhsil` is Azerbaijani for *education*. It is a near-homograph of the Turkish
     * `tahsil`, which does mean collecting a payment, and the borrowing is a natural mistake
     * for anybody drafting the two languages side by side. Twice in this catalogue's history a
     * pledge was described as being "educated" when a campaign closed — a sentence that
     * parses, sounds official, and tells a backer nothing about their money.
     *
     * This is not a spell-checker and is not trying to be. It is a note-to-self with teeth,
     * for the specific errors that have actually happened here.
     */
    const CONFUSIONS: ReadonlyArray<readonly [Locale, RegExp, string]> = [
      ['az', /təhsil/iu, 'means education — for money use tutulur, çıxılır or alınır'],
    ];

    for (const [locale, pattern, why] of CONFUSIONS) {
      for (const [key, message] of entries(CATALOGUES[locale])) {
        expect(pattern.test(message), `${locale} ${key}: ${why}`).toBe(false);
      }
    }
  });

  it('quotes a phrase the way each language quotes one', () => {
    /*
     * ISSUE #94. English uses “…” and the other three use «…», and that was already the
     * majority spelling in all four when the convention was written down. It was only the
     * majority: Azerbaijani and Turkish carried thirteen curly-quoted strings each, mostly in
     * the search results and the moderation forms, where a reader meets the two conventions
     * one screen apart.
     *
     * It is not only typography. A quotation mark is where somebody else's words start, and a
     * catalogue that marks that boundary two ways has a reader deciding which mark means it.
     * Pinned here because it is the kind of drift no reviewer reports and every reviewer sees.
     */
    const CURLY = /[“”]/u;
    const GUILLEMET = /[«»]/u;

    for (const [key, message] of entries(CATALOGUES['en'])) {
      expect(GUILLEMET.test(message), `en ${key} quotes with «» where “” is the convention`).toBe(
        false,
      );
    }

    for (const locale of SUPPORTED_LOCALES.filter((other) => other !== 'en')) {
      for (const [key, message] of entries(CATALOGUES[locale])) {
        expect(CURLY.test(message), `${locale} ${key} quotes with “” where «» is the convention`)
          .toBe(false);
      }
    }
  });

  it('gives one ledger account one name, in each language', () => {
    /*
     * ISSUE #94, which predicted this one: "`fees.disclosure` already spells the same two fees
     * in four languages — these must agree with it, and I matched them by eye rather than by
     * test." They did not agree. Turkish called the same deduction `Platform komisyonu` on the
     * creator's financial summary and `Platform ücreti` in the administration console's ledger
     * and on the payout it produces.
     *
     * <h2>Why identity rather than a vocabulary check</h2>
     *
     * These are not two labels that happen to mean the same thing: `dashboard.finance` and
     * `admin.money.account` name the SAME §7.2 account, read by the creator whose money it
     * came out of and by the administrator answering them about it. If those two screens print
     * different words, the support conversation is about which one is the real fee. A test can
     * check that far and no further — whether the word is the right word is what a native
     * speaker reads for, and a string equal to another string is at least one word rather
     * than two.
     */
    const SAME: ReadonlyArray<readonly [string, string]> = [
      ['dashboard.finance.platformFee', 'admin.money.account.platform_fee'],
      ['dashboard.finance.platformFee', 'admin.screens.payouts.platformFee'],
      ['dashboard.finance.processingFee', 'admin.money.account.psp_fee'],
    ];

    for (const locale of SUPPORTED_LOCALES) {
      const messages = new Map(entries(CATALOGUES[locale]));

      for (const [left, right] of SAME) {
        expect(messages.get(left), `${locale}: ${left} against ${right}`).toBe(messages.get(right));
      }
    }
  });
});
