import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocumentEditor } from '../../../../components/admin/LegalDocumentEditor';
import { legalDocumentEditorCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * §22.2's eight documents, drafted and published — issue #425.
 *
 * <p>Filed under §4.11's AD-11, which is the module about what the platform charges and
 * what it obliges: a fee, a plan and the creator agreement are three subjects of one
 * authority. Publishing a legal document needs its own capability, `PUBLISH_LEGAL_DOCUMENT`,
 * narrower than the `CONFIGURE_PLATFORM` a fee or a plan needs, because a published version
 * cannot be undone. `lib/admin/navigation.ts` carries the argument for why this is truthful
 * rather than a seventeenth module, and why the rail nevertheless files this under Platform.
 *
 * <p><strong>There is no edit and no delete.</strong> A published version is immutable —
 * V65 puts a trigger on the table — because an acceptance names a version, and an
 * acceptance of a text that can be edited afterwards is evidence of nothing. The screen is
 * built to make that obvious rather than to warn about it; `LegalDocumentEditor` explains
 * how.
 *
 * <p><strong>No text ships with this.</strong> The eight kinds exist and none of them has
 * words yet: they are #423's adviser's, and #439 publishes them. A page that seeded its own
 * terms of use would be this repository writing a legal position.
 *
 * <p>`privatePageMetadata` for the reason every console route gives: these pages are
 * per-person, they are not for a crawler, and several of them name people.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.legal');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function LegalDocumentsPage() {
  const t = await getTranslations('admin.pages.legal');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <LegalDocumentEditor copy={await legalDocumentEditorCopy()} />
      </div>
    </div>
  );
}
