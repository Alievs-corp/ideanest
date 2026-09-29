import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../test-copy';
import { SUPPORTED_LOCALES, type Locale } from './locale';
import { pledgeManagerCopyFrom } from './pledges-copy';
import { checkoutCopyFrom } from './checkout-copy';

/**
 * #171: what the screens say a backer can do with a pledge, held to what the API allows.
 *
 * The owner's decision is recorded in docs/architecture.md §4.5: a paid pledge may be raised —
 * never lowered, never withdrawn — while its campaign takes pledges, and only the difference is
 * charged, at once, on the provider's page (`POST /v1/pledges/{id}/raise`). Before #171 the copy
 * promised that and no endpoint allowed it; these assertions are the half that keeps the words from
 * drifting away from the endpoint again.
 *
 * English carries the meaning and is asserted word for word, through the catalogue. The other three
 * are held to what English cannot show: that each sentence exists, that its placeholders survived
 * translation, and that it is not English left in place.
 */
describe('what the pledge screens promise, in English', () => {
  const pages = translatorFor('account.pages');
  const manager = pledgeManagerCopyFrom(translatorFor('account.pledges'));

  it('says a pledge can be raised while the campaign takes pledges, and only the difference is charged', () => {
    const intro = pages('pledges.intro');
    expect(intro).toMatch(/While a campaign is taking pledges you can raise yours/u);
    expect(intro).toMatch(/only the difference is charged/u);
    expect(intro).toMatch(/cannot lower or withdraw it/u);

    expect(pages('pledgeDetail.intro')).toMatch(/Raising a paid pledge charges only the difference, straight away/u);
  });

  it('explains a locked pledge by what the API allows: paid pledges are raised while the campaign runs', () => {
    expect(manager.lockedBody).toMatch(/Once it is paid for it can be raised — never lowered or withdrawn — while its campaign takes pledges/u);
    expect(manager.lockedBody).toMatch(/only the difference is charged/u);
    // The pre-#171 wording tied raising to a confirmation that no longer happens.
    expect(manager.lockedBody).not.toMatch(/after it is confirmed/u);
    expect(manager.lockedBody).toContain('{state}');
  });

  it('tells the backer raising a paid pledge that it is charged, unlike an edit', () => {
    expect(manager.editor.raiseIntro).toMatch(/Only the difference is charged, on the payment provider’s page/u);
    expect(manager.editor.raiseIntro).toMatch(/not lower it/u);
    expect(manager.editor.raiseIntro).not.toMatch(/does not charge/u);
    // An edit of a draft or a legacy confirmed pledge still charges nothing, and still says so.
    expect(manager.editor.intro).toMatch(/does not charge your card/u);
  });

  it('promises a way back to a pending raise’s payment only where the page offers one', () => {
    // Drawn when the service sends no page to go back to: the page the backer left is all there is.
    expect(manager.editor.raisePending).toMatch(/If its payment page is still open, finish it there; otherwise you can start again after \{time\}/u);
    // Drawn beside the link to the service's page for the raise.
    expect(manager.editor.raisePendingResumable).toMatch(/continue it on the payment provider’s page/u);
    // A refusal cannot link anywhere, so it sends the backer to the page that can.
    const inProgress = checkoutCopyFrom(translatorFor('checkout')).failures.codes.PLEDGE_RAISE_IN_PROGRESS.detail;
    expect(inProgress).toMatch(/Reload this page/u);
    expect(inProgress).not.toMatch(/Finish the payment you started/u);
  });

  it('describes backing on the how-it-works page the same way', () => {
    const backing = translatorFor('static.howItWorks.backing').raw('first') as string;
    expect(backing).toMatch(/A pledge cannot be cancelled or lowered/u);
    expect(backing).toMatch(/raise it with a higher tier, an add-on or a larger amount, and only the difference is charged/u);
  });

  it('words every refusal the raise endpoint can give', () => {
    const codes = checkoutCopyFrom(translatorFor('checkout')).failures.codes;
    for (const code of [
      'PLEDGE_RAISE_IN_PROGRESS',
      'RAISE_AMOUNT_CHANGED',
      'RAISE_NOT_AN_INCREASE',
      'PLEDGE_NOT_RAISABLE',
      'PAYMENT_UNAVAILABLE',
    ] as const) {
      expect(codes[code].title.length).toBeGreaterThan(0);
      expect(codes[code].detail).toMatch(/Nothing (was charged|has changed)/u);
    }
  });
});

describe.each(SUPPORTED_LOCALES.filter((locale): locale is Exclude<Locale, 'en'> => locale !== 'en'))('the same promises in %s', (locale) => {
  const english = pledgeManagerCopyFrom(translatorFor('account.pledges'));
  const copy = pledgeManagerCopyFrom(translatorFor('account.pledges', locale));
  const pages = translatorFor('account.pages', locale);

  it('are translated, not English left in place', () => {
    expect(copy.lockedBody).not.toBe(english.lockedBody);
    expect(copy.editor.raiseIntro).not.toBe(english.editor.raiseIntro);
    expect(copy.raiseReturned.raisedBody).not.toBe(english.raiseReturned.raisedBody);
    expect(pages('pledges.intro')).not.toBe(translatorFor('account.pages')('pledges.intro'));
  });

  it('keep their placeholders', () => {
    expect(copy.lockedBody).toContain('{state}');
    expect(copy.editor.raiseDue).toContain('{amount}');
    expect(copy.editor.raisePay).toContain('{amount}');
    expect(copy.editor.raisePending).toContain('{time}');
    expect(copy.editor.raisePendingResumable).toContain('{time}');
    expect(copy.raiseReturned.heldBody).toContain('{time}');
  });
});
