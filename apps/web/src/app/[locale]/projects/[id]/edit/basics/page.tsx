import type { Metadata } from 'next';
import { BasicsPanel } from '../../../../../../components/campaign-editor/BasicsPanel';
import {
  basicsPanelCopy,
  editorChromeCopy,
} from '../../../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../../../lib/seo/metadata';

export const metadata: Metadata = privatePageMetadata({
  title: 'Basics',
  description: 'The title, summary, category, goal, duration, and cover image of your campaign.',
});

/**
 * The project is loaded with the account's bearer token from the browser, so
 * this page is a shell and `BasicsPanel` is the client boundary — the same shape
 * as `/settings/sessions`.
 */
export default async function BasicsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [copy, basics] = await Promise.all([editorChromeCopy(), basicsPanelCopy()]);

  /*
   * No `<main>` since #347. `app/projects/[id]/edit/layout.tsx` puts the editor inside
   * `SiteShell`, which owns the only `<main>` on the document and is the skip link's target.
   * `EditorShell` draws this page's own column and heading, so the element that was here
   * carried a landmark and nothing else.
   */
  return <BasicsPanel projectId={id} copy={copy} basics={basics} />;
}
