import type { Metadata } from 'next';
import { StoryPanel } from '../../../../../../components/campaign-editor/StoryPanel';
import {
  editorChromeCopy,
  storyPanelCopy,
} from '../../../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../../../lib/seo/metadata';

export const metadata: Metadata = privatePageMetadata({
  title: 'Story',
  description:
    'The long-form story of your campaign, its risks and challenges, and its earlier versions.',
});

/**
 * The project is loaded with the account's bearer token from the browser, so this
 * page is a shell and `StoryPanel` is the client boundary — the same shape as
 * `/projects/[id]/edit/basics`.
 */
export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [copy, story] = await Promise.all([editorChromeCopy(), storyPanelCopy()]);

  /*
   * No `<main>` since #347. `app/projects/[id]/edit/layout.tsx` puts the editor inside
   * `SiteShell`, which owns the only `<main>` on the document and is the skip link's target.
   * `EditorShell` draws this page's own column and heading, so the element that was here
   * carried a landmark and nothing else.
   */
  return <StoryPanel projectId={id} copy={copy} story={story} />;
}
