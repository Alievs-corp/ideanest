import type { Metadata } from 'next';
import { CheckoutView } from '../../../../../components/checkout/CheckoutView';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';
import { checkoutCopy, failureCopy } from '../../../../../lib/i18n/shell-copy.server';
import { fetchLegalDocument } from '../../../../../lib/api/server';
import { FeeDisclosure } from '../../../../../components/fees/FeeDisclosure';
import { FailureAction, FailureState } from '../../../../../components/shell/FailureState';
import { fetchFeeDisclosure } from '../../../../../lib/fees/server';
import { localeOrDefault } from '../../../../../lib/i18n/locale';
import { getLocale, getTranslations } from 'next-intl/server';

/**
 * `/projects/{id}/back` — the pledge flow, docs/architecture.md §4.5.
 *
 * <h2>Why this segment</h2>
 *
 * **`back`, because that is what the person is doing.** The product's verb for
 * this is "Back this project" — it is the label on the call to action in
 * docs/motion-system.md §4.3 — and a route reads best when it names the reader's
 * intent rather than the system's process. `checkout` is our word for the
 * machinery and it borrows a shopping cart's mental model, which is wrong here in
 * a way that matters: nothing is bought, nothing is charged today, and the thing
 * at the end is a commitment that may never be collected (§9.2).
 *
 * It sits beside `edit/` and `prelaunch/` under `projects/[id]`, which keeps the
 * three audiences of one campaign in one place: `edit` is the creator's, and
 * `prelaunch` and `back` are the public's.
 *
 * <h2>One route, three steps</h2>
 *
 * There is deliberately no `back/review` or `back/confirm`. The selection is not
 * linkable state — a link would carry one person's half-made pledge to somebody
 * who cannot pay for it — and a reservation lives for five minutes, so a back
 * button that could re-enter the review step would routinely land on a hold that
 * has expired. `CheckoutView` explains the same decision from the other side.
 *
 * `?reward=` is not a counter-example, and `rewardId` below says why: a tier
 * identifier is public catalogue data that reserves nothing, and it seeds step
 * one rather than skipping it.
 *
 * <h2>Not indexed, and not followed either</h2>
 *
 * A checkout is not a landing page. A search result pointing here is a dead end
 * for anybody arriving without a session, and the campaign's own page — which
 * this route is reached from — is the thing worth ranking.
 *
 * `follow` used to be true here, on the reasoning that the campaign links on the
 * page were worth crawling. There are none: everything below is rendered by
 * `CheckoutView` in the browser from data fetched with a token a crawler does not
 * have, so the markup a crawler receives has no links in it. `follow: true` was a
 * promise of crawl budget spent finding nothing, and every private surface in this
 * application now says the same two words — `privatePageMetadata` holds both.
 *
 * The rewards are loaded in the browser, so this is a shell and `CheckoutView` is
 * the client boundary — the same shape `/projects/[id]/edit/rewards` takes, and
 * for the same reason: nothing from `@ideanest/ui` may be imported by a Server
 * Component, because it is a barrel and several of its members reach for
 * `createContext`.
 */
export const metadata: Metadata = privatePageMetadata({
  title: 'Back this campaign',
  description: 'Choose a reward, add extras, and confirm your pledge.',
});

/**
 * PL-15's private link: `?token=abc&token=def`.
 *
 * Repeatable, because a campaign may have handed out more than one and a backer
 * may hold two. Next hands a repeated parameter over as an array and a single one
 * as a string, so both readings are normalised here rather than at the four
 * places downstream that would otherwise each have to.
 */
function secretTokens(value: string | string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((token) => token !== '');
}

/**
 * `?reward=` — the tier the reader pressed on the campaign page, or null.
 *
 * <h2>Why a tier identifier may be in the URL when a pledge may not</h2>
 *
 * `useCheckout` states the rule this looks like an exception to: the selection is React
 * state and the route has no query string, because a half-made pledge is not shareable and
 * a back button must not re-enter a reservation that has expired.
 *
 * Neither argument reaches this parameter. It is not a pledge — it reserves nothing, prices
 * nothing and belongs to nobody; it is an identifier this campaign's public page already
 * printed, and the worst a shared link can do is open somebody else's checkout with a tier
 * highlighted that they are free to change. The `?token=` parameter beside it has been
 * carrying more sensitive data than this since PL-15.
 *
 * <p><strong>Repeated or empty is treated as absent.</strong> Next hands a repeated parameter
 * over as an array, and there is no sensible reading of two tiers: the reader pressed one
 * control. Guessing at the first would preselect a tier nobody chose on a screen whose next
 * step commits money.
 */
function rewardId(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

/**
 * This page's own address with the query it was opened with, for the failure state's retry.
 *
 * The tokens are carried over because a private campaign's checkout is unreachable without
 * them, and a retry that dropped them would turn a transient failure into a refusal.
 */
function retryHref(id: string, query: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const token of secretTokens(query['token'])) search.append('token', token);
  const reward = rewardId(query['reward']);
  if (reward !== null) search.set('reward', reward);

  const suffix = search.toString();
  return `/projects/${encodeURIComponent(id)}/back${suffix === '' ? '' : `?${suffix}`}`;
}

export default async function BackProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;

  /*
   * The checkout's words, resolved here because every component below this line is a client
   * component and none of them can reach the catalogue. `lib/i18n/checkout-copy.ts` explains
   * why the whole object travels as one prop rather than through a provider, and why on this
   * screen in particular a missing string is a money question rather than a cosmetic one.
   */
  const copy = await checkoutCopy();

  /*
   * §22.3's backer agreement, resolved here — #427.
   *
   * The VERSION only. The words are in the catalogue above, where `wording.test.ts` pins
   * them in four languages; what the service needs back from the confirmation is which text
   * this page showed, and that is a number.
   *
   * Read on the server rather than by `useCheckout`, and behind an hour of shared cache:
   * this is the same document for every reader in a language, and §22.3 wants the statement
   * rendered *with* the page — a risk sentence that appeared a moment after the confirm
   * button did would be one somebody had already scrolled past.
   *
   * `unpublished` when nothing is published, which is where this platform stands until #439
   * seeds the words. The statement is then not drawn and the confirmation acknowledges
   * nothing, which is exactly what the service asks for.
   *
   * `unavailable` is not that — #147. A failed read says nothing about whether an agreement is
   * in force, and treating it as "none" drew a checkout without the risk statement §22.3
   * requires, whose confirmation the service refuses once an agreement is in force. So the page
   * renders the failure state rather than a checkout: nothing is reserved yet (that happens in
   * `CheckoutView`, which is not mounted), and the retry is this address again.
   */
  const backerAgreement = await fetchLegalDocument('BACKER_AGREEMENT');

  if (backerAgreement.state === 'unavailable') {
    const [t, failure] = await Promise.all([
      getTranslations('checkout.agreementUnavailable'),
      failureCopy(),
    ]);

    return (
      <main>
        <FailureState
          copy={failure}
          title={t('title')}
          description={<p>{t('body')}</p>}
          action={<FailureAction href={retryHref(id, query)}>{t('action')}</FailureAction>}
        />
      </main>
    );
  }

  /*
   * §22.3's sixth requirement, on the screen it is actually about — #439.
   *
   * **This campaign's terms and not the platform's**, resolved most-specific-wins exactly as the
   * collection will be: a campaign may carry its own schedule, and quoting the platform rate to
   * somebody backing a campaign on different terms would be the disclosure §22.3 exists to
   * prevent.
   *
   * Read on the server and rendered with the page, for the reason the backer agreement above is:
   * a fee that appeared a moment after the confirm control did would be one somebody had already
   * scrolled past.
   */
  const [fees, locale] = await Promise.all([fetchFeeDisclosure(id), getLocale()]);

  return (
    <main>
      <CheckoutView
        projectId={id}
        secretTokens={secretTokens(query['token'])}
        initialRewardId={rewardId(query['reward'])}
        copy={copy}
        backerAgreementVersion={
          backerAgreement.state === 'published' ? backerAgreement.document.version : null
        }
      />

      {/*
        A Server Component beneath the client island rather than a prop through it. Two reasons,
        and the second is the one that decides it: the disclosure needs `Intl` and `decimal.js`
        for its arithmetic, and passing it as rendered markup keeps both out of the checkout
        bundle — docs/motion-system.md §5 and #119's budget argument apply to every kilobyte on
        this route. The first is that `CheckoutView` owns the pledge, and the fee is a statement
        about the platform rather than about this pledge's total.
      */}
      <div className="mx-auto w-full max-w-[720px] px-5 pb-12 sm:px-6">
        <FeeDisclosure disclosure={fees} audience="backer" locale={localeOrDefault(locale)} />
      </div>
    </main>
  );
}
