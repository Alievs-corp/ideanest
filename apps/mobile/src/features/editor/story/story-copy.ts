import { useMemo } from 'react';
import { storyPanelCopyFrom, type StoryPanelCopy } from '@ideanest/campaign-editor/copy';
import type { Locale } from '@ideanest/messages';
import { formatCount, pluralCategory, useT } from '../../../lib/i18n';
import { useEditorChromeCopy, useEditorTranslators } from '../translator';

/**
 * The story tab's words (#162): the shared builder's `StoryPanelCopy` — the very object the web's
 * `StoryPanel` is handed — plus the few sentences the web still writes inline, which the app reads
 * from `mobile.editor.story.*` because no screen here speaks English of its own.
 */
export interface StoryCopy {
  readonly story: StoryPanelCopy;
  readonly mobile: ReturnType<typeof useT<'mobile.editor.story'>>;
  readonly locale: Locale;
}

export function useStoryCopy(): StoryCopy {
  const { t, locale } = useEditorTranslators();
  const chrome = useEditorChromeCopy();
  const mobile = useT('mobile.editor.story');
  const story = useMemo(
    () => storyPanelCopyFrom(t, locale, chrome.characterCount),
    [t, locale, chrome.characterCount],
  );
  return useMemo(() => ({ story, mobile, locale }), [story, mobile, locale]);
}

/** "1,240 characters", in the reader's plural form and digit grouping. */
export function charactersPhrase(copy: StoryCopy, count: number): string {
  return copy.mobile(`history.characters.${pluralCategory(copy.locale, count)}`, {
    count: formatCount(count, copy.locale),
  });
}
