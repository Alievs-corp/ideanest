import { SurveyBuilder } from '../../../../../../components/dashboard/SurveyBuilder';
import { surveyBuilderCopy } from '../../../../../../lib/i18n/shell-copy.server';

/**
 * The dashboard's survey panel — §4.8's PM-01 to PM-04, issue 73.
 *
 * <h2>A Server Component that renders a client one, and fetches nothing</h2>
 *
 * The backer panel next door explains why and the reason is the same: `lib/api/server.ts`
 * is deliberately anonymous, every read here is behind a bearer token the service answers
 * `no-store`, and a server render that varied by session would be a page nothing can
 * cache.
 *
 * <p>The route is not an authorisation boundary. The service refuses a caller who holds no
 * `PUBLISH_UPDATES` on the campaign and the panel renders that refusal; a check here would
 * be a second, weaker copy of one the service already makes correctly.
 */
export default async function SurveysPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  // Words, not data: the builder is a client island, so the route resolves its sentences and
  // the five answer types §4.8's PM-03 offers, and hands them down.
  const [{ id }, copy] = await Promise.all([params, surveyBuilderCopy()]);

  return <SurveyBuilder projectId={id} copy={copy} />;
}
