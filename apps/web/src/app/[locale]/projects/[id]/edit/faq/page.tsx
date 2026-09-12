import type { Metadata } from 'next';
import { FaqPanel } from '../../../../../../components/campaign-editor/FaqPanel';
import { editorChromeCopy, editorMetaCopy } from '../../../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../../../lib/seo/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const [copy, meta] = await Promise.all([editorChromeCopy(), editorMetaCopy()]);
  return privatePageMetadata({
    title: copy.tabs.faq,
    description: meta.descriptions.faq,
  });
}

/**
 * The project is loaded with the account's bearer token from the browser, so
 * this page is a shell and `FaqPanel` is the client boundary — the same shape as
 * `/projects/[id]/edit/basics`, `/story` and `/rewards`.
 *
 * The write endpoints behind the panel are authorised by the `MANAGE_FAQ`
 * project capability rather than by `EDIT_BASICS` (docs/architecture.md §4.4).
 * Nothing here checks it: the service is the thing that decides, and a client
 * that hid the tab on its own reading of a capability list would be a second,
 * weaker copy of an authorisation rule. A collaborator without the grant sees
 * the tab and is refused with a sentence, which is the honest failure.
 */
export default async function FaqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const copy = await editorChromeCopy();

  /*
   * No `<main>` since #347. `app/projects/[id]/edit/layout.tsx` puts the editor inside
   * `SiteShell`, which owns the only `<main>` on the document and is the skip link's target.
   * `EditorShell` draws this page's own column and heading, so the element that was here
   * carried a landmark and nothing else.
   */
  return <FaqPanel projectId={id} copy={copy} />;
}
