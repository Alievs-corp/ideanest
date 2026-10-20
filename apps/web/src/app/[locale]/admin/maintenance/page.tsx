import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MaintenanceConsole } from '../../../../components/admin/MaintenanceConsole';
import { maintenanceConsoleCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * Maintenance windows — §19.6, issue #214. Filed under AD-16 with the health board.
 *
 * <p>Scheduling, starting, ending, extending and cancelling a window, each audited by the
 * service. `CONFIGURE_PLATFORM` opens it; the rail hides it from everybody else and the
 * service refuses them anyway.
 *
 * <p>`privatePageMetadata` for the reason every console route gives.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.maintenance');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function MaintenancePage() {
  const t = await getTranslations('admin.pages.maintenance');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>
      {/* The exact list is a reference, not a preamble: folded, so the screen's controls are
          what a reader meets first. A native disclosure, so it costs the route no script. */}
      <details className="mt-3 max-w-[62ch] text-sm">
        <summary className="cursor-pointer rounded text-white/64 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]">
          {t('detailsSummary')}
        </summary>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-white/64">
          <li>{t('detailsPasses')}</li>
          <li>{t('detailsPaused')}</li>
          <li>{t('detailsRunning')}</li>
        </ul>
      </details>

      <div className="mt-8">
        <MaintenanceConsole copy={await maintenanceConsoleCopy()} />
      </div>
    </div>
  );
}
