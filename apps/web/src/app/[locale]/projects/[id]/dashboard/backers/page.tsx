import { BackerReport } from '../../../../../../components/dashboard/BackerReport';
import { backerReportCopy } from '../../../../../../lib/i18n/shell-copy.server';

/**
 * The dashboard's backer panel — §4.7's CD-10 and CD-11, issues 97 and 79.
 *
 * <h2>A Server Component that renders a client one, and fetches nothing</h2>
 *
 * The overview page next door explains why, and the reason is sharper here: this screen is
 * a list of names and email addresses behind a bearer token, and `lib/api/server.ts` is
 * deliberately anonymous. There is nothing to render on the server, and a server render
 * that varied by session would be a page nothing can cache — which is the whole of #119's
 * argument, applied in the direction that says not to.
 *
 * <p>The route is not an authorisation boundary. The service refuses a caller who holds no
 * `VIEW_FINANCES` on the campaign and the panel renders that refusal; a check here would be
 * a second, weaker copy of one the service already makes correctly.
 */
export default async function BackerReportPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  // Words, not data: the report is a client island, so the route resolves its sentences — the
  // chips, the table's headings and the five pledge states — and hands them down.
  const [{ id }, copy] = await Promise.all([params, backerReportCopy()]);

  return <BackerReport projectId={id} copy={copy} />;
}
