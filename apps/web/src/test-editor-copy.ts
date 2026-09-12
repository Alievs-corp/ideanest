import MESSAGES from '../messages/en.json';
import { editorChromeCopyFrom, type EditorChromeCopy } from './lib/i18n/campaign-editor-copy';

/**
 * The editor frame's copy, as the server would have resolved it — issue #324.
 *
 * <h2>Why it is built rather than typed out</h2>
 *
 * Every editor test renders a panel, and every panel now takes the frame's words as a prop.
 * A literal written here would be a second copy of the catalogue: the suite would keep
 * passing after somebody changed `campaignEditor.tabs.story` in `messages/en.json`, which is
 * the opposite of what these assertions are for. `CheckoutView.test.tsx` states the same
 * reasoning for the same reason and does it inline; there are eight call sites here, so it
 * is a module.
 *
 * <h2>English only, and that is not a gap</h2>
 *
 * A panel does not choose its language — it renders the object it is handed. What is worth
 * asserting per language is that the catalogue HAS the key in all four, and
 * `catalogue.test.ts` already asserts that for every key in the file. Rendering each panel
 * four times would be four times the suite to learn nothing the parity test does not
 * already know.
 */
export const EDITOR_COPY: EditorChromeCopy = editorChromeCopyFrom((key: string) => {
  let node: unknown = MESSAGES.campaignEditor;
  for (const segment of key.split('.')) node = (node as Record<string, unknown>)[segment];
  if (typeof node !== 'string') throw new Error(`no message at campaignEditor.${key}`);
  return node;
});
