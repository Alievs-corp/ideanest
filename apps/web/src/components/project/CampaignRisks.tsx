import { getTranslations } from 'next-intl/server';

/**
 * §5.5's risks section on the Campaign tab — moved out of `page.tsx` by #142.
 *
 * §5.5 makes the risks section a creator obligation and §5.3 requires two hundred characters of
 * it before a campaign may be submitted. It is plain text rather than a document — there is one
 * column behind it — and it is on the Campaign tab beside the story rather than behind a tab of
 * its own because a backer deciding whether to commit money is exactly who it was written for.
 *
 * <h2>Why a component of its own</h2>
 *
 * The heading was an English literal in the route, on every campaign in every language (#142).
 * The route reads six endpoints and is not rendered by any test, so the heading moved here,
 * where the catalogue's word can be asserted without mocking the whole page. A server
 * component, like the story beside it: nothing here needs the browser.
 */
export interface CampaignRisksProps {
  /** The creator's own text. Printed as text, never as markup. */
  readonly risks: string;
}

export async function CampaignRisks({ risks }: CampaignRisksProps) {
  const t = await getTranslations('campaign.risks');

  return (
    <section aria-labelledby="campaign-risks" className="flex flex-col gap-3">
      <h2 id="campaign-risks" className="text-xl font-medium tracking-[-0.02em] text-white">
        {t('heading')}
      </h2>
      <p className="max-w-[68ch] wrap-anywhere text-[1.0625rem] leading-[1.75] whitespace-pre-line text-reading">
        {risks}
      </p>
    </section>
  );
}
