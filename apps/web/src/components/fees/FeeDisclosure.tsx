import Decimal from 'decimal.js';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '../../i18n/navigation';
import { numberFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { legalPath } from '../../lib/legal/api';
import { formatMoney } from '../../lib/money';
import type { FeeDisclosure as Disclosure } from '../../lib/fees/server';

/**
 * §22.3's "clear fee disclosure" — issue #439.
 *
 * <h2>What this fixes</h2>
 *
 * Until this component the platform's fee copy was a sentence in a message catalogue saying that
 * every payment is priced at zero commission. It was *true*, because no schedule is seeded — and
 * it would have become **false the day one was**, silently, because nothing checks a catalogue
 * against a table. Everything here is derived from `fee_schedules`, so the page cannot say a
 * number the platform is not charging.
 *
 * <h2>The two fees stay two numbers</h2>
 *
 * §5.2's platform fee and the payment provider's processing fee are drawn separately and are
 * never summed for the reader. #439 says exactly why: "a creator reading '5%' and receiving 94.2%
 * will ask, and the answer needs to already be on the page." A single combined rate is the
 * version of this component that produces that question.
 *
 * <h2>Two audiences, one source</h2>
 *
 * {@link FeeDisclosureProps.audience} decides the sentences and nothing else. A backer is told
 * what their pledge is subject to; a creator is told what they will actually receive. Both read
 * the same schedule, so the two pages cannot come to different answers about the same terms —
 * which is the failure two separately-written fee sections eventually produce.
 *
 * <h2>Arithmetic through `decimal.js`, never through a number</h2>
 *
 * CLAUDE.md, and it is not ceremony here: turning `"0.05000"` into a percentage means
 * multiplying by a hundred, and `0.05 * 100` is `5.000000000000001` in IEEE 754. The rate
 * arrives as a string, is multiplied as a decimal, and reaches `Intl.NumberFormat` as a value
 * that has already been rounded to the two places the screen shows.
 *
 * <h2>Nothing configured is said out loud</h2>
 *
 * Not zeros, and not silence. `configured: false` means the platform has not set a schedule, and
 * the page says so — a reader who is told "no fee is currently charged" has been told something
 * true and revocable, where "0%" reads as a commitment. Silence would be worse than either: a
 * pledge screen with no fee section at all is one where the reader has to assume.
 *
 * <h2>A failed read is not "nothing configured" — issue #145</h2>
 *
 * The two used to share one branch and one sentence, "nothing is being deducted from pledges
 * today". That sentence is true only when the service answered `configured: false`. When the
 * read failed — the API slow or down, as on 2026-09-28 during the DNS move — the platform may
 * well be charging, and a creator deciding about their campaign's money was told it was not.
 * A failed read now has its own sentence, which names no figure, says in as many words that it
 * is not a statement that nothing is charged, and links to the creator agreement where the rate
 * is stated. A body that claims `configured: true` without its rates is drawn the same way: it
 * is a disclosure the page cannot read, not a platform that has decided to charge nothing.
 *
 * <h2>Motion: none, and this is where the rule bites hardest</h2>
 *
 * docs/motion-system.md §5: motion decreases as money gets closer, and checkout must not
 * animate. This component appears on the checkout screen. Every animation there reads as
 * hesitation, and hesitation about the fee is the worst place on the platform to put it.
 */

export type FeeAudience = 'backer' | 'creator';

export interface FeeDisclosureProps {
  /** `null` for a failed read, which has its own sentence — never the unconfigured one (#145). */
  readonly disclosure: Disclosure | null;
  readonly audience: FeeAudience;
  readonly locale: Locale;
}

/**
 * A fraction as a percentage, to two places, in the reader's language.
 *
 * Two places rather than none: a processing rate of 2.9% is the ordinary shape of one, and a
 * component that rounded it to 3% would be printing a number the platform does not charge on the
 * page whose entire purpose is to print the number the platform charges.
 */
function percent(fraction: string, locale: Locale): string {
  const value = new Decimal(fraction).times(100);

  return numberFormat(
    locale,
    { minimumFractionDigits: 0, maximumFractionDigits: 2 },
    'fee-percent',
  ).format(Number(value.toFixed(2)));
}

export async function FeeDisclosure({ disclosure, audience, locale }: FeeDisclosureProps) {
  const t = await getTranslations('fees.disclosure');

  const heading = audience === 'backer' ? t('backerHeading') : t('creatorHeading');

  const statement = (body: ReactNode) => (
    <section
      aria-labelledby="fee-disclosure"
      className="mt-6 flex flex-col gap-2 rounded-lg border border-white/8 bg-surface-2 p-5 sm:p-6"
    >
      <h2 id="fee-disclosure" className="text-base font-medium text-white">
        {heading}
      </h2>
      <p className="max-w-[68ch] text-sm leading-relaxed text-reading">{body}</p>
    </section>
  );

  /*
   * The service's own answer that no schedule is set. The only case in which "nothing is being
   * deducted" is true, so the only case that may say it.
   */
  if (disclosure !== null && !disclosure.configured) {
    return statement(t('unconfigured'));
  }

  if (
    disclosure === null ||
    disclosure.platformRate === null ||
    disclosure.processingRate === null ||
    disclosure.creatorReceivesRate === null
  ) {
    /*
     * The read failed, or answered something this page cannot state a rate from — #145. No
     * figure and no claim about what is charged: the sentence says the rate could not be
     * loaded and points at the document where it is stated. The creator agreement for both
     * audiences: it is the document the unconfigured sentence already names as the place the
     * terms are stated, and the rate is a term between the platform and the creator.
     */
    return statement(
      t.rich('unavailable', {
        agreement: (chunks) => (
          <Link href={legalPath('creator-agreement')} className="text-white underline underline-offset-4">
            {chunks}
          </Link>
        ),
      }),
    );
  }

  const platform = percent(disclosure.platformRate, locale);
  const processing = percent(disclosure.processingRate, locale);
  const keeps = percent(disclosure.creatorReceivesRate, locale);

  /*
   * The fixed amount is money and is formatted as money — through `@ideanest/money`, from its
   * digits, never through a number. It is omitted when it is zero rather than printed as
   * "+ 0,00 ₼", which is a line that makes a reader look for a charge that is not there.
   */
  const fixed =
    disclosure.processingFixed !== null &&
    disclosure.currency !== null &&
    !new Decimal(disclosure.processingFixed).isZero()
      ? formatMoney({ amount: disclosure.processingFixed, currency: disclosure.currency })
      : null;

  return (
    <section
      aria-labelledby="fee-disclosure"
      className="mt-6 flex flex-col gap-2 rounded-lg border border-white/8 bg-surface-2 p-5 sm:p-6"
    >
      <h2 id="fee-disclosure" className="text-base font-medium text-white">
        {heading}
      </h2>

      <p className="max-w-[68ch] text-sm leading-relaxed text-reading">
        {audience === 'backer'
          ? t('backerBody', { platform, processing })
          : t('creatorBody', { platform, processing, keeps })}
      </p>

      {fixed !== null && (
        <p className="max-w-[68ch] text-sm leading-relaxed text-reading">
          {t('fixedFee', { amount: fixed })}
        </p>
      )}

      {/*
        The sentence that keeps the two numbers apart in the reader's head. Without it, a
        creator who sees a platform rate of 5% and receives 92.1% has an unanswered question, and
        #439 asks for the answer to already be on the page rather than in a support ticket.
      */}
      <p className="max-w-[68ch] text-sm leading-relaxed text-white/64">{t('twoFees')}</p>
    </section>
  );
}
