import MESSAGES from '../messages/en.json';
import {
  basicsPanelCopyFrom,
  editorChromeCopyFrom,
  type BasicsPanelCopy,
  type EditorChromeCopy,
} from './lib/i18n/campaign-editor-copy';

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
function at(key: string): unknown {
  let node: unknown = MESSAGES.campaignEditor;
  for (const segment of key.split('.')) node = (node as Record<string, unknown>)[segment];
  return node;
}

/*
 * `raw` alongside `t`, because the builders read every placeholder-carrying template through
 * it. A fixture with only `t` would be MORE PERMISSIVE THAN THE APPLICATION: next-intl throws
 * a FORMATTING_ERROR on `t('…{max}…')` and this walk does not, so the suite would pass on
 * exactly the hints that render a key path in the browser. It happened; this is the fix.
 */
const read = Object.assign(
  (key: string): string => {
    const node = at(key);
    if (typeof node !== 'string') throw new Error(`no message at campaignEditor.${key}`);
    if (/\{\w+\}/u.test(node)) {
      throw new Error(`campaignEditor.${key} carries a placeholder — read it with raw()`);
    }
    return node;
  },
  { raw: at },
);

export const EDITOR_COPY: EditorChromeCopy = editorChromeCopyFrom(read);

/** The basics tab's own words, and the vocabulary `validateBasics` refuses in. */
export const BASICS_COPY: BasicsPanelCopy = basicsPanelCopyFrom(read);
