import type { Metadata } from 'next';
import { ReviewPanel } from '../../../../../../components/campaign-editor/ReviewPanel';
import { editorChromeCopy, editorMetaCopy } from '../../../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../../../lib/seo/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const [copy, meta] = await Promise.all([editorChromeCopy(), editorMetaCopy()]);
  return privatePageMetadata({
    title: copy.tabs.review,
    description: meta.descriptions.review,
  });
}

/**
 * The checklist is read with the account's bearer token from the browser, so this
 * page is a shell and `ReviewPanel` is the client boundary — the same shape as
 * `/projects/[id]/edit/basics` and `/projects/[id]/edit/story`.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const copy = await editorChromeCopy();

  /*
   * No `<main>` since #347. `app/projects/[id]/edit/layout.tsx` puts the editor inside
   * `SiteShell`, which owns the only `<main>` on the document and is the skip link's target.
   * `EditorShell` draws this page's own column and heading, so the element that was here
   * carried a landmark and nothing else.
   */
  return <ReviewPanel projectId={id} copy={copy} />;
}
