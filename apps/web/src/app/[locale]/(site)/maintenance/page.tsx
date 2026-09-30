import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { FailureAction, FailureState } from '../../../../components/shell/FailureState';
import { MaintenanceTime } from '../../../../components/shell/MaintenanceNotice';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { failureCopy } from '../../../../lib/i18n/shell-copy.server';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { DISMISSED_KEY, maintenanceScriptSource } from '../../../../lib/maintenance/script';
import { interpolate, monthTemplates, readStatusForRender } from '../../../../lib/maintenance/server';
import { STATUS_PATH } from '../../../../lib/maintenance/status';

/**
 * `/maintenance` — §4.13 WS-09's third failure state (#263), and since #214 the page a
 * maintenance window actually answers with.
 *
 * <h2>How a reader arrives, and why it is a 503 now</h2>
 *
 * This page used to say that nothing routed to it and that a Next route cannot honestly claim
 * a 503. Both are answered by #214, and not here: the proxy (`lib/maintenance/gate.ts`) asks
 * the status endpoint before rendering and, during a window, rewrites every page but the
 * console and sign-in to this one, with `503`, `Retry-After` and `no-store` — so a crawler
 * treats the page as away rather than gone. The reader's address is kept. A client-side call
 * that meets the maintenance problem sends the reader here too, with `?from=` the page they
 * were on (`lib/maintenance/follow.ts`).
 *
 * <h2>What it says</h2>
 *
 * The window's announced end, "back around 02:30", in the reader's own zone; "no end time
 * announced" when there is none; and when the edge answered — the service is not running at
 * all, and the edge cannot tell a planned stop from a crash — the neutral wording instead of
 * "planned maintenance", because claiming a plan nobody announced would hide an incident.
 *
 * <h2>It takes the reader back</h2>
 *
 * An inline script polls `GET /v1/status` every thirty seconds, or after the edge's
 * `Retry-After`, and when the platform is operational returns the reader to the page they
 * asked for. Inline rather than a client component, for the budget reason
 * `lib/maintenance/script.ts` gives — this route is a tenth of a KiB from its ceiling.
 *
 * <h2>No navigation links</h2>
 *
 * The only failure state that hides them. Offering "Browse campaigns" from a page that exists
 * because browsing campaigns is unavailable is an invitation into the outage.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shell.failure.pages.maintenance');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/** Between checks, and before the first one unless the edge said otherwise. */
const CHECK_INTERVAL_MS = 30_000;

export default async function MaintenancePage() {
  const [failure, status, locale] = await Promise.all([
    failureCopy(),
    readStatusForRender(true),
    getLocale().then(localeOrDefault),
  ]);
  const t = await getTranslations('shell.failure.pages.maintenance');
  const m = await getTranslations('shell.maintenance');
  const months = monthTemplates(locale);

  const maintenance = status?.state === 'maintenance' ? status.maintenance : null;
  const edge = maintenance?.source === 'edge';

  let until = null;
  if (maintenance !== null && !edge) {
    until =
      maintenance.endsAt === null ? (
        <p className="mt-3">{m('untilUnknown')}</p>
      ) : (
        <p className="mt-3">
          {interpolate(String(m.raw('until')), {
            time: <MaintenanceTime part="moment" instant={maintenance.endsAt} months={months} />,
          })}
        </p>
      );
  }

  const firstCheckMs =
    edge && maintenance !== null
      ? Math.min(Math.max(maintenance.retryAfterSeconds, 30), 300) * 1000
      : CHECK_INTERVAL_MS;

  return (
    <>
      <FailureState
        copy={failure}
        showLinks={false}
        title={edge ? m('edge.title') : t('title')}
        description={
          <>
            <p>{edge ? m('edge.description') : t('description')}</p>
            {until}
          </>
        }
        action={<FailureAction href="/">{t('action')}</FailureAction>}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: maintenanceScriptSource({
            months,
            dismissedKey: DISMISSED_KEY,
            watch: {
              statusUrl: STATUS_PATH,
              page: `/${locale}/maintenance`,
              home: `/${locale}`,
              firstCheckMs,
              intervalMs: CHECK_INTERVAL_MS,
            },
          }),
        }}
      />
    </>
  );
}
