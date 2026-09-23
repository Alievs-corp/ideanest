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
     *
     * <h2>The four below are #102's, and they are a decision rather than a typo</h2>
     *
     * Every non-English language carried TWO words for "creator" and Russian carried two for
     * "backer", split roughly along the administration console against everything else: the
     * console was translated first (#324) and set one vocabulary, #79 to #86 translated the
     * surfaces a reader meets and set another, and nothing could compare them because the
     * catalogues are checked by key and never by word. `account.pledges.states` and
     * `admin.screens.accountDetail.pledgeState` named the same cancellation `Отменён вами` and
     * `Отменён спонсором`; one Russian sentence used both words for two different people.
     *
     * <p>#102 settled it as one word per concept, because these are the same people in the
     * same rows read from two sides, and a support conversation is those two screens read
     * aloud to each other. The words it settled on, and why the other one loses:
     *
     * <ul>
     *   <li><strong>tr `üretici`</strong> is a MANUFACTURER. English never says manufacturer
     *       or producer anywhere in this catalogue, and the word would be wrong for a
     *       documentary or a novel. `yaratıcı` is what `fees.disclosure` and the creator
     *       agreement already said.</li>
     *   <li><strong>ru `создатель`</strong> is a literal calque; `автор` is what Russian
     *       crowdfunding calls the person and what 124 strings here already said.</li>
     *   <li><strong>ru `спонсор`</strong> is a SPONSOR, which is a different relationship
     *       from a backer and precisely the one §22.1 is careful not to imply.</li>
     *   <li><strong>az `yaradıcı`</strong> reads as the adjective "creative" as often as the
     *       noun; `müəllif` is unambiguously a person, and "layihə müəllifi" is what a project
     *       owner is called. The exception is the creator agreement: `müəllif müqaviləsi` is a
     *       COPYRIGHT LICENCE in Azerbaijani law, a different instrument from the one signed
     *       here, so that document keeps its own name the way `PAYRIFF` keeps its spelling.
     *       The lookahead below is that exception and nothing else.</li>
     * </ul>
     */
    const CONFUSIONS: ReadonlyArray<readonly [Locale, RegExp, string]> = [
      ['az', /təhsil/iu, 'means education — for money use tutulur, çıxılır or alınır'],
      ['az', /yaradıcı(?! müqavilə)/iu, 'the creator is müəllif — yaradıcı only names the agreement'],
      ['ru', /создател/iu, 'the creator is автор on every surface, console included'],
      ['ru', /спонсор/iu, 'a backer is a бэкер — a спонсор is a different relationship (§22.1)'],
      ['tr', /üretici/iu, 'üretici is a manufacturer — the creator is yaratıcı'],
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

  it('declines "бэкер" the same way everywhere it is counted', () => {
    /*
     * ISSUE #94. `dashboard.overview.outcomeBackers` read `{count} бэкера` for `one` and
     * `{count} бэкеров` for `few`: the whole table shifted by one category, so a campaign that
     * closed with one backer reported "1 бэкера" and one that closed with two reported
     * "2 бэкеров". Neither is Russian, and it is the sentence a creator reads about how their
     * campaign finished.
     *
     * <h2>Why this pins one noun rather than stating a rule about plural groups</h2>
     *
     * Because there is no rule about plural groups to state, and a check that looked like one
     * would be worse than none. The obvious candidates both fail: `one` differed from `few`
     * in the shifted table, and `few` equalling `many` is CORRECT in four groups here —
     * `у {count} проводок` and `Отправлено {count} бэкерам` take the same case from two
     * numeral forms, which is a fact about the preposition rather than about the noun. A test
     * that passed on the defect it cites would be the skipped test CLAUDE.md calls a bug
     * report nobody filed.
     *
     * <p>What is checkable is the one noun this platform counts. "бэкер" is declined in five
     * plural groups on five surfaces — the two campaign cards, the funding block, the campaign
     * outcome and the backer report — and the nominative table is the same in all five or one
     * of them is wrong. The dative groups (`бэкеру` / `бэкерам`) are a different table and are
     * left alone.
     */
    const NOMINATIVE = /бэкеров$/u;
    let checked = 0;

    const walk = (value: unknown, path: string) => {
      if (typeof value !== 'object' || value === null) return;
      const node = value as Record<string, unknown>;
      const forms = ['one', 'few', 'many'].map((key) => node[key]);

      if (forms.every((form) => typeof form === 'string')) {
        /* The noun is the last word, so the sentence's own full stop is not part of it. */
        const bare = (form: string) => form.trimEnd().replace(/[.!?…]+$/u, '');
        const [rawOne, rawFew, rawMany] = forms as [string, string, string];
        const one = bare(rawOne);
        const few = bare(rawFew);
        const many = bare(rawMany);

        if (NOMINATIVE.test(many)) {
          expect(one, `ru ${path}: one is not the nominative singular`).toMatch(/бэкер$/u);
          expect(few, `ru ${path}: few is not the genitive singular`).toMatch(/бэкера$/u);
          checked += 1;
        }

        return;
      }

      for (const [key, child] of Object.entries(node)) walk(child, path === '' ? key : `${path}.${key}`);
    };

    walk(CATALOGUES['ru'], '');

    expect(checked, 'no group counting бэкеры was found, so this test is checking nothing')
      .toBeGreaterThan(3);
  });

  it('keeps Turkish "denetlemek" for auditing, which is the only thing it means', () => {
    /*
     * ISSUE #94, and the shape `CONFUSIONS` above exists for: a word that reads as fluent and
     * means something else. `denetlemek` is to AUDIT or to INSPECT OFFICIALLY. Twenty-nine
     * strings used it for English's "check" — `Bağlantınızı denetleyip yeniden deneyin` tells
     * somebody to audit their internet connection, and `E-postanızı denetleyin` to audit their
     * inbox. `kontrol etmek` is the verb, and every one of those now uses it.
     *
     * <h2>Why the rule is a namespace rather than a word list</h2>
     *
     * Because the word is right where the meaning is right, and that is one place: the
     * administration console genuinely audits. `admin.moderation.decision.dismiss.body` says
     * dismissals are audited, `admin.screens.audit.footnote` is about an audit surface, and
     * `admin.index.footnote` describes authorisation — `yetki denetimi` is what that is called
     * in Turkish. Outside `admin.`, nothing on this platform audits anything.
     */
    for (const [key, message] of entries(CATALOGUES['tr'])) {
      if (key.startsWith('admin.')) continue;

      expect(/denetl/iu.test(message), `tr ${key}: use kontrol etmek — denetlemek is to audit`)
        .toBe(false);
    }
  });

  it('never attaches an Azerbaijani suffix to a value it has not seen', () => {
    /*
     * ISSUES #104 AND #109. Azerbaijani chooses a suffix's vowel from the sound of the word
     * it attaches to, and a number is read as the word it is spelled: the ordinal is 1-ci,
     * 2-ci, 3-cü, 4-cü, 5-ci, 6-cı, 7-ci, 8-ci, 9-cu, 10-cu, and the cases harmonise the same
     * way — {count}-i is right for 1 and wrong for 3, which takes -ü. A catalogue cannot pick
     * either, because the number arrives in the browser long after the sentence was written.
     *
     * Twelve `campaignEditor` strings wrote a fixed `-ci` after a placeholder (#104) and two
     * more wrote a fixed case (#109), each right for five digits out of ten. One of the two
     * was worse than it looked: `story.panel.charactersNeeded` counts characters, so the
     * number reaches the sentence already grouped for the reader — the suffix would have had
     * to harmonise with "1.200" as it is READ, which is a fact about the rendered string.
     *
     * <h2>Why a suffix table is not the fix</h2>
     *
     * It would have to live in a client component, and the ordinal rule is not only about the
     * last digit — 100 is `100-cü` while 1000 is `1000-ci`. The fourteen were rephrased
     * instead: `{total} bloqdan {index}` is cardinal and needs no suffix, "moved to position
     * N" is `{position} nömrəli mövqeyə` — #105's phrasing — and a count reads
     * `{min} simvoldan {count} yazılıb`, where the suffix sits on the noun it has always sat
     * on. Rephrasing removes the problem instead of encoding it.
     *
     * <h2>Why the rule is Azerbaijani alone, and why it is every suffix rather than ordinals</h2>
     *
     * The other three do not have this defect to have. Russian's ordinal is `-й` whatever the
     * digit, Turkish marks one with a full stop, and English has four endings it never
     * attaches to a placeholder here. Azerbaijani is the language where the ending depends on
     * a value the catalogue has not got — and that is as true of a case as of an ordinal, and
     * as true after a name as after a number, so the rule is the whole shape: nothing in the
     * Azerbaijani catalogue may hyphenate letters onto a placeholder. Nothing did after #109,
     * which is the only reason it can be stated this widely.
     *
     * <h2>Why it is worth a test rather than a reading</h2>
     *
     * TWELVE OF THE FOURTEEN ARE NAMES OR LIVE REGIONS ONLY A SCREEN READER HEARS. Six are
     * `aria-label`s on the reorder buttons and six are the announcements made after a reward,
     * a block or a question moves — a creator reordering ten story blocks with the keyboard
     * heard four wrong endings out of nine moves, in the only channel that told them the move
     * had worked, and nobody reviewing the editor on screen would ever have seen one.
     */
    const SUFFIX_ON_A_PLACEHOLDER = /\}\s*-\s*\p{L}/u;

    for (const [key, message] of entries(CATALOGUES['az'])) {
      expect(
        SUFFIX_ON_A_PLACEHOLDER.test(message),
        `az ${key}: the suffix's vowel depends on the value — rephrase (${message})`,
      ).toBe(false);
    }
  });
});
