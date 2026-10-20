import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CollectionEditor } from '../../../../../components/admin/CollectionEditor';
import { collectionEditorCopy } from '../../../../../lib/i18n/admin/console.server';
import { noteDialogCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * One collection, and the campaigns in it — §4.11's AD-03, issues #301 and #303.
 *
 * <p><strong>The heading does not name the collection.</strong> Resolving its title would mean
 * reading the admin endpoint on the server, and the console has no server-side session to read
 * it with — the access token lives in the browser (`lib/api/client.ts`). So the page is titled
 * by what it is and the panel says which collection it is.
 *
 * <p>The route is `[slug]` beside three static siblings — `badges`, `open-calls`,
 * `placements`. Next resolves a static segment before a dynamic one, so those three reach
 * their own pages; a collection whose handle happened to be one of those three words would be
 * unreachable here. That is a trade worth naming rather than one worth a longer prefix on
 * every other collection's URL.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.curationSlug');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function CollectionPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;

  const t = await getTranslations('admin.pages.curationSlug');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <CollectionEditor slug={slug} copy={await collectionEditorCopy()} note={await noteDialogCopy()} />
      </div>
    </div>
  );
}
