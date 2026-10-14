import { useMemo } from 'react';
import { storyPanelCopyFrom, type StoryPanelCopy } from '@ideanest/campaign-editor/copy';
import type { Locale } from '@ideanest/messages';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { pluralForm } from '@ideanest/messages/plurals';
import { formatCount, useT } from '../../../lib/i18n';
import { useEditorChromeCopy, useEditorTranslators } from '../translator';

/**
 * The story tab's words (#162): the shared builder's `StoryPanelCopy` — the very object the web's
 * `StoryPanel` is handed — plus the few sentences that are the phone's own ("this phone", "update
 * the app"), which the app reads from `mobile.editor.story.*`. A sentence the web says too is read
 * from `story`, never copied into `mobile` (#463).
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
  return fillPlaceholders(pluralForm(copy.locale, copy.story.history.characters, count), {
    count: formatCount(count, copy.locale),
  });
}
