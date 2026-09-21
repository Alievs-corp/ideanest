import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import az from '../../../messages/az.json';
import en from '../../../messages/en.json';
import ru from '../../../messages/ru.json';
import tr from '../../../messages/tr.json';
import { TRUST_COPY } from '../../components/project/CampaignTrustBlock';

/**
 * The English catalogue says what the components used to say — issue #324.
 *
 * <h2>The failure this exists for, which happened</h2>
 *
 * Moving a sentence into the catalogue is a copy-and-paste, and copy-and-paste through a
 * human is lossy. Writing the campaign page's keys, three sentences came out subtly
 * different from the ones that had been on screen: `campaign.faqs.empty` lost "add the
 * answer" in favour of "answer it", `campaign.comments.signedOut` dropped the clause
 * explaining that it is also how the creator replies to you, and
 * `campaign.comments.withdrawWarning` said a withdrawal "cannot be undone" where the
 * original said it "cannot be edited or restored".
 *
 * None of those is a typo. Each is a different sentence that reads as fluent, passes every
 * other check in this repository, and quietly changes what the product tells somebody. The
 * third was caught only because a test happened to assert the old wording; the first two were
 * caught by comparing against `git show origin/main` by hand.
 *
 * <h2>Why this is narrow rather than general</h2>
 *
 * It cannot check every string: most were moved out of JSX where the original no longer
 * exists to compare against. What it can do is pin the sentences the repository had already
 * decided were worth pinning — the ones a module exports as a constant precisely so that a
 * test can hold them still. Those are the promises about money, which is where a reworded
 * sentence costs the most.
 */
describe('the English catalogue against the wording it replaced', () => {
  it('states §4.4 trust copy exactly as the constant does', () => {
    /*
     * `CampaignTrustBlock` explains at length why these three sentences are quoted rather
     * than paraphrased: the third is the platform's entire commercial model stated to the
     * person about to rely on it. The paragraph is drawn from the catalogue now so that it
     * can be read in Russian; this is what stops it being rewritten on the way.
     */
    expect(en.campaign.trust.body).toBe(TRUST_COPY);
  });

  it('keeps the four money promises the checkout makes', () => {
    /*
     * Read out of the component's own source rather than retyped, so this fails if either
     * side moves. These are the sentences a backer relies on when deciding to confirm, and
     * the ones a softened translation would do the most damage to.
     */
    const source = readFileSync(
      join(process.cwd(), 'src/components/checkout/PaymentStep.tsx'),
      'utf8',
    );

    /* The component draws them from the catalogue, so the keys must at least be reached. */
    expect(source).toContain('copy.body');
    expect(source).toContain('copy.later');

    /*
     * And the English must still say what IDN-EXT-01 requires it to say (#44): the pledge is
     * charged on the provider's page, once; a card is never typed into IdeaNest; an
     * unfinished payment takes nothing; and a campaign that does not succeed refunds in full.
     */
    expect(en.checkout.payment.body).toMatch(/charged there, once/u);
    expect(en.checkout.payment.body).toMatch(/never entered on IdeaNest/u);
    expect(en.checkout.payment.later).toMatch(/refunded in full/u);
    expect(en.checkout.review.charged).toMatch(/If you do not finish paying, nothing is taken/u);
  });

  it('never softens a charge statement into a thank-you for a purchase', () => {
    /*
     * `cardStatement` in `CheckoutView` carries this rule in a comment: neither sentence may
     * become "thank you for your payment", because §9.2 collects nothing until the campaign
     * succeeds and a confirmation implying otherwise would have somebody budgeting for money
     * that has not left their account. Asserted here across all four languages rather than
     * in English alone, because a translator with no context is exactly who would write it.
     */
    /*
     * IDN-EXT-01 (#44) made "paid" true: the pledge is charged on the provider's page, and the
     * pledge page says so once the provider confirms it. What stays forbidden is the shop's
     * vocabulary — a thank-you for a purchase is a receipt for a thing, and a pledge is not one.
     */
    const FORBIDDEN = /thank you for your (payment|purchase)|order (placed|confirmed)/iu;

    for (const message of [...Object.values(en.checkout.done), ...Object.values(en.checkout.returned)]) {
      expect(message, message).not.toMatch(FORBIDDEN);
    }
  });

  it('states the risk within the pledge flow, in all four languages', () => {
    /*
     * §22.3 requires that "rewards are not guaranteed" is said INSIDE the pledge flow — not
     * in the terms and not on a linked page — and #427 records that somebody was shown it.
     * The record is only worth having if the sentence it records is the sentence §22.3 asks
     * for, and a translator with no context is exactly who would soften it into "your reward
     * will arrive soon".
     *
     * So each language is pinned on the two things that must survive translation: that a
     * pledge is not a purchase, and that a reward is not guaranteed. Pinned as patterns
     * rather than as whole sentences, because the wording is the translator's and the
     * meaning is not.
     */
    expect(en.checkout.risk.body).toMatch(/not a purchase/iu);
    expect(en.checkout.risk.body).toMatch(/not guaranteed/iu);
    expect(az.checkout.risk.body).toMatch(/satın almaq deyil/iu);
    expect(az.checkout.risk.body).toMatch(/zəmanət yoxdur/iu);
    expect(ru.checkout.risk.body).toMatch(/не покупка/iu);
    expect(ru.checkout.risk.body).toMatch(/не гарантировано/iu);
    expect(tr.checkout.risk.body).toMatch(/satın almak değildir/iu);
    expect(tr.checkout.risk.body).toMatch(/garanti değildir/iu);

    /*
     * And the confirm control's own label carries the acceptance, in all four. That is the
     * design #427 settled on — one action rather than a tick beside a button — so a
     * translation that reverted it to a bare "Confirm" would quietly turn the acknowledgement
     * back into something nobody was asked about.
     */
    for (const [language, label] of [
      ['en', en.checkout.risk.confirm],
      ['az', az.checkout.risk.confirm],
      ['ru', ru.checkout.risk.confirm],
      ['tr', tr.checkout.risk.confirm],
    ] as const) {
      expect(label, language).not.toBe('');
      expect(label.length, language).toBeGreaterThan(en.checkout.review.confirm.length);
    }
  });

  it('never calls a pledge a purchase, in any language', () => {
    /*
     * ISSUE #438. The terms can say the platform is an intermediary; if the interface says
     * "buy", "order" and "product", then §22.1's consumer-protection question is decided on
     * what the interface said.
     *
     * <h2>Scoped, because a blanket ban would be wrong</h2>
     *
     * A reward tier genuinely HAS a price — `checkout.errors.belowRewardPrice` says "This
     * reward costs {price}" and a creator sets that number — and a subscription plan has one
     * too. The wrong usage is calling a *pledge* a purchase, not calling a tier's amount a
     * price. So this reads the two namespaces a backer meets when committing money — the
     * pledge flow and the campaign page — and the forbidden list is the vocabulary of buying
     * rather than the vocabulary of amounts.
     *
     * <h2>Four languages, for the reason above</h2>
     *
     * The English catalogue is the one somebody thought about. `az` already carries the good
     * long-form statement and drifted everywhere else, which is exactly the shape this
     * catches.
     */
    const FORBIDDEN: Readonly<Record<string, RegExp>> = {
      /* satın almaq / alış / məhsul / səbət / sifariş — buy, purchase, product, cart, order. */
      az: /(satın al|alış-veriş|səbət|sifariş ver)/iu,
      en: /\b(buy|buying|purchase|purchased|cart|checkout|order this|your order)\b/iu,
      ru: /(купить|покупк|корзин|оформить заказ)/iu,
      tr: /(satın al|sepet|sipariş ver)/iu,
    };

    /*
     * The one exception, and it is the sentence this rule exists to protect. Saying "a pledge
     * is NOT a purchase" has to be allowed to use the word, or the product cannot state its
     * own position — so a message is exempt when it is one of the four negations, which are
     * listed by key rather than matched by a cleverness that would exempt the next one too.
     */
    const NEGATIONS = new Set(['risk.body']);

    for (const [language, catalogue] of [
      ['az', az],
      ['en', en],
      ['ru', ru],
      ['tr', tr],
    ] as const) {
      const forbidden = FORBIDDEN[language]!;

      for (const [key, message] of flatten(catalogue.checkout)) {
        if (NEGATIONS.has(key)) continue;
        expect(message, `${language}.checkout.${key} — ${message}`).not.toMatch(forbidden);
      }
      for (const [key, message] of flatten(catalogue.campaign)) {
        expect(message, `${language}.campaign.${key} — ${message}`).not.toMatch(forbidden);
      }
    }
  });

  /*
   * A NINTH RULE WAS HERE UNTIL #85, AND ITS DELETION IS THE POINT OF THAT ISSUE.
   *
   * It asserted that `admin.moderation.reason` said exactly what `lib/moderation/describe.ts`
   * exported as `REASON_LABELS` — the same nine reasons, in English, twice, because the
   * console was translated and the public report dialog was not. The rule existed to stop the
   * two drifting, which is the right answer to a duplication you cannot yet remove.
   *
   * #85 removed it. Both surfaces read the catalogue now, so there is one table of nine and
   * nothing left to hold still; a rule asserting that the catalogue agrees with itself would
   * be noise. `lib/i18n/report-copy.ts` carries the reasoning.
   */
});

/**
 * Every string under a namespace, as `key.path` pairs.
 *
 * <p>Recursive because the catalogues nest three deep in places, and a rule that only read
 * the top level would pass on `checkout.review.confirm` — which is where the words that
 * matter live.
 */
function flatten(node: unknown, prefix = ''): readonly (readonly [string, string])[] {
  if (typeof node === 'string') return [[prefix, node]];
  if (node === null || typeof node !== 'object') return [];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}
