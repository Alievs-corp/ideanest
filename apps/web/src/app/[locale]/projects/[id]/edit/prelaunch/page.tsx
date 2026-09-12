import type { Metadata } from 'next';
import { PrelaunchPanel } from '../../../../../../components/campaign-editor/PrelaunchPanel';
import {
  basicsPanelCopy,
  editorChromeCopy,
  editorMetaCopy,
  prelaunchPanelCopy,
} from '../../../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../../../lib/seo/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const [copy, meta] = await Promise.all([editorChromeCopy(), editorMetaCopy()]);
  return privatePageMetadata({
    title: copy.tabs.prelaunch,
    description: meta.descriptions.prelaunch,
  });
}

/**
 * The project is loaded with the account's bearer token from the browser, so this
 * page is a shell and `PrelaunchPanel` is the client boundary — the same shape as
 * `/projects/[id]/edit/basics`.
 *
 * The PUBLIC pre-launch page is a different route, `/projects/[id]/prelaunch`,
 * and deliberately not under `edit`: it is the address a creator shares, and a
 * link with "edit" in it is a link people ask questions about.
 */
export default async function PrelaunchEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [copy, basics, prelaunch] = await Promise.all([
    editorChromeCopy(),
    basicsPanelCopy(),
    prelaunchPanelCopy(),
  ]);

  /*
   * No `<main>` since #347. `app/projects/[id]/edit/layout.tsx` puts the editor inside
   * `SiteShell`, which owns the only `<main>` on the document and is the skip link's target.
   * `EditorShell` draws this page's own column and heading, so the element that was here
   * carried a landmark and nothing else.
   */
  return <PrelaunchPanel
      projectId={id}
      copy={copy}
      validation={basics.validation}
      cover={basics.cover}
      prelaunch={prelaunch}
    />;
}
