import type { EditorTabKey } from '@ideanest/campaign-editor/tabs';
import { WebFallback } from '../../components/web-fallback';
import { useEditor } from './editor-context';

/**
 * A tab whose native screen is not built yet (#162 ships Basics first): the website's same tab,
 * inside the editor's frame — which keeps the header, the save indicator and the tab row. Each
 * later pull request replaces one route's `<EditorWebTab tab="…" />` with its panel.
 */
export function EditorWebTab({ tab }: { readonly tab: Exclude<EditorTabKey, 'basics'> }) {
  const { projectId } = useEditor();
  return (
    <WebFallback
      titleKey="mobile.fallback.editCampaign"
      webPath={`/projects/${encodeURIComponent(projectId)}/edit/${tab}`}
      ownHeader={false}
    />
  );
}
