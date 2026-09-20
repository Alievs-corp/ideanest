import { FundingCharts } from '../../../../../../components/dashboard/FundingCharts';
import { fundingChartsCopy } from '../../../../../../lib/i18n/shell-copy.server';

/**
 * The dashboard's charts panel — §4.7's CD-02, CD-07 and CD-08, issue 96.
 *
 * <p>A Server Component that renders a client one and fetches nothing, for the reason the
 * overview page gives: both reads are behind a bearer token and the service answers both
 * `no-store`.
 *
 * <p>The route is `charts` rather than `analytics`, which is what the service calls one of
 * the two endpoints behind it. A creator does not have an analytics; they have a chart of
 * what their campaign raised, and the URL is the one thing on this screen they might type.
 */
export default async function FundingChartsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  // Words, not data: both charts are drawn by a client island, so the route resolves their
  // sentences and hands them down — `lib/i18n/dashboard-copy.ts` carries the reasoning.
  const [{ id }, copy] = await Promise.all([params, fundingChartsCopy()]);

  return <FundingCharts projectId={id} copy={copy} />;
}
