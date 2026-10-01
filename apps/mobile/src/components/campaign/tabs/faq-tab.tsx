import { useT } from '../../../lib/i18n';
import { FaqEntry } from './faq/faq-entry';
import { useProjectFaqs } from './faq/use-project-faqs';
import { TabHeading, TabNote } from './shared/tab-section';
import {
  INACTIVE_TAB,
  type CampaignTabBody,
  type CampaignTabContext,
  type CampaignTabRow,
} from './contract';

/**
 * The FAQ tab (#155) — `useFaqTab`, consumed by `campaign-screen.tsx` as the body of the page's
 * list when `?tab=faq`. The contract is `./contract.ts`. The web's `CampaignFaqs`.
 *
 * <p>The heading `campaign.faqs.heading`, then one row per question (`./faq/faq-entry.tsx`): a
 * surface-2 card, an H3 question and its answer with line breaks kept, **all open** — no
 * accordion. `GET /v1/projects/{projectId}/faqs` (`./faq/use-project-faqs.ts`), read only while
 * the tab is open and persisted with the page under `project`.
 *
 * <p>Unpaged, so there is no `onEndReached` and no footer. A refused read is
 * `campaign.faqs.failed` with "Try again" — never the empty sentence, which is a claim about the
 * creator and must only be made when it is true — and a campaign with no questions is
 * `campaign.faqs.empty`. While the first answer is on its way the body is empty and `loading`,
 * and the screen draws its placeholder. A cached list whose refresh failed stays on screen.
 */
export function useFaqTab(context: CampaignTabContext): CampaignTabBody {
  const t = useT('campaign.faqs');
  const faqs = useProjectFaqs(context.campaign.id, context.active);
  if (!context.active) return INACTIVE_TAB;

  const refresh = () => faqs.refetch();
  if (faqs.data === undefined && faqs.isPending) {
    return { rows: [], footer: null, onEndReached: null, refresh, loading: true };
  }

  const rows: CampaignTabRow[] = [
    { key: 'heading', render: () => <TabHeading testID="faq-heading">{t('heading')}</TabHeading> },
  ];

  const list = faqs.data;
  if (list === undefined) {
    rows.push({
      key: 'failed',
      render: () => (
        <TabNote
          text={t('failed')}
          onRetry={() => void faqs.refetch()}
          retrying={faqs.isFetching}
          testID="faq-failed"
        />
      ),
    });
  } else if (list.length === 0) {
    rows.push({ key: 'empty', render: () => <TabNote text={t('empty')} testID="faq-empty" /> });
  } else {
    list.forEach((faq, position) => {
      rows.push({
        key: `faq-${faq.id}`,
        render: () => <FaqEntry faq={faq} index={position + 1} count={list.length} />,
      });
    });
  }

  return { rows, footer: null, onEndReached: null, refresh, loading: false };
}
