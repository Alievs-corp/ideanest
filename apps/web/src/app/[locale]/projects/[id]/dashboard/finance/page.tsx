import { FinancialSummary } from '../../../../../../components/dashboard/FinancialSummary';
import { financeCopy } from '../../../../../../lib/i18n/shell-copy.server';

/**
 * The dashboard's financial summary — §4.7's CD-16, issue 99.
 *
 * <p>A Server Component that renders a client one and fetches nothing, for the reason the
 * overview and charts pages give: the read is behind a bearer token, `lib/api/server.ts` sends
 * none by design, and the service answers `private, no-store` — this is one creator's view of
 * their own money, and there is nothing about it a shared render could produce.
 *
 * <p>The route is `finance` rather than `payouts`. A payout is one event in the answer; what a
 * creator came here for is where their money went, and the URL is the one thing on this screen
 * they might type.
 */
export default async function FinancialSummaryPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  // Words, not data: the panel is a client island, so the route resolves its sentences and
  // hands them down — `lib/i18n/dashboard-copy.ts` carries the reasoning.
  const [{ id }, copy] = await Promise.all([params, financeCopy()]);

  return <FinancialSummary projectId={id} copy={copy} />;
}
