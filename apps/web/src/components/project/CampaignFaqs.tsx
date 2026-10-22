import type { CampaignFaq } from '../../lib/community/faqs';
import { getTranslations } from 'next-intl/server';

/**
 * §4.4's FAQ tab — issue #283, over the public read the service now publishes.
 *
 * <h2>An open list, not an accordion, and that is the decision this file makes</h2>
 *
 * docs/motion-system.md §4.9 describes how to build a disclosure properly — the icon rotates
 * 180° rather than swapping glyphs, and the panel animates `grid-template-rows: 0fr → 1fr`
 * rather than `height`, because a height animation causes layout shift. The right way is
 * known. It is not taken here, for four reasons, in the order they matter:
 *
 * <ol>
 *   <li><strong>Collapsed text is text a reader cannot find.</strong> A backer looking for
 *       "does this ship to Germany" reaches for the browser's own find-in-page. Behind a
 *       closed `<details>` that search matches nothing in several browsers, and the reader
 *       concludes the campaign never said. The whole point of putting the FAQ on the server
 *       rather than behind JavaScript is that the words are in the document; hiding them
 *       again by default gives most of that back.
 *   <li><strong>§8 forbids animation in long content, and an answer is long content.</strong>
 *       The project page's budget is Moderate — section headings, counters, the sticky call
 *       to action — and an entry animation on the campaign's own answers would be spending it
 *       on the one surface where somebody is reading rather than exploring.
 *   <li><strong>The list is bounded.</strong> §4.4 caps a campaign at fifty entries and this
 *       component receives all of them at once; there is no page to collapse away, and the
 *       real ones run to a handful. An accordion is a scanning aid for a list too long to
 *       read down, which this is not.
 *   <li><strong>It costs nothing.</strong> No state, no client boundary, no runtime. The
 *       whole tab is a heading and an ordered list.
 * </ol>
 *
 * The day a campaign's FAQ genuinely is too long to read down, the answer is §4.9's
 * disclosure built with `grid-template-rows` — <em>not</em> a `height` transition, and not
 * one that leaves the answers out of find-in-page without `hidden="until-found"`.
 *
 * <h2>Nothing here is a client boundary</h2>
 *
 * No state, no handler, no hook — the same shape as `CampaignUpdates`. The tab is a server
 * render of a `permitAll` read on the route #119 exists to keep in the initial HTML.
 *
 * <h2>The order is the creator's</h2>
 *
 * `sort_order` is what `PATCH /v1/projects/{id}/faqs/reorder` writes and what the editor's
 * move controls change. This component renders the array in the order it was handed and
 * never sorts it: a creator who put the shipping question first meant it to be first.
 *
 * An `<ol>` rather than a `<div>` of cards, because the order is content. A screen reader
 * saying "list, 6 items, item 3 of 6" is telling the reader something true about the
 * campaign; a stack of unrelated boxes is not.
 *
 * <h2>Answers are text, never markup</h2>
 *
 * The same rule `CampaignUpdates` applies to an update body, and it applies here with less
 * ceremony because there is no schema at all behind this field: an answer is a string a
 * creator typed, reaching this component from a public endpoint. `whitespace-pre-line` keeps
 * the paragraph breaks — the only structure plain text has — and
 * `dangerouslySetInnerHTML` would make the campaign page a cross-site scripting vector on
 * the origin that holds the session.
 *
 * <h2>Motion</h2>
 *
 * None. See the second reason above.
 */

export interface CampaignFaqsProps {
  /**
   * `null` when the service refused — a different thing from a campaign that has answered
   * nothing, and the distinction the tab waited for an endpoint in order to be able to make.
   */
  readonly faqs: readonly CampaignFaq[] | null;
}

export async function CampaignFaqs({ faqs }: CampaignFaqsProps) {
  const t = await getTranslations('campaign.faqs');

  return (
    <section aria-labelledby="campaign-faq" className="flex flex-col gap-6">
      <h2 id="campaign-faq" className="text-xl font-medium tracking-[-0.02em] text-fg">
        {t('heading')}
      </h2>

      {faqs === null ? (
        /*
         * THE SERVICE, NOT THE CAMPAIGN. `fetchProjectFaqs` answers `null` only when the read
         * was refused or could not be made. Printing "this campaign has not answered anything
         * yet" here would put a claim about the creator over a restarting service — and that
         * sentence is exactly the one `lib/projects/tabs.ts` refused to print on every
         * campaign on the platform before this endpoint existed. Having finally earned the
         * right to say it, this component must only say it when it is true.
         */
        <p className="text-sm text-fg-64">
          {t('failed')}
        </p>
      ) : faqs.length === 0 ? (
        <p className="text-sm text-fg-64">
          {t('empty')}
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {faqs.map((faq) => (
            <li key={faq.id}>
              <FaqEntry faq={faq} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function FaqEntry({ faq }: { readonly faq: CampaignFaq }) {
  return (
    <article
      aria-labelledby={`faq-${faq.id}`}
      className="flex flex-col gap-2 rounded-lg border border-fg/8 bg-surface-2 p-5 sm:p-6"
    >
      {/*
        A heading rather than a bold paragraph, so the questions are a list a screen-reader
        user can jump between (docs/ui-kit.md §9.1). Level 3 puts them under the tab's own
        `<h2>`, which is under the campaign title — the same ladder `CampaignUpdates` uses.
      */}
      <h3 id={`faq-${faq.id}`} className="text-base font-medium text-fg">
        {faq.question}
      </h3>

      {/*
        `whitespace-pre-line`, never `dangerouslySetInnerHTML`. See the header comment: an
        answer is plain text a creator typed, and the paragraph breaks in it are the only
        structure it has.
      */}
      <p className="max-w-[68ch] text-[1.0625rem] leading-[1.75] whitespace-pre-line text-reading">
        {faq.answer}
      </p>
    </article>
  );
}
