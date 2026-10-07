import { useMemo } from 'react';
import { createTranslator } from 'use-intl';
import {
  editorChromeCopyFrom,
  type CampaignEditorTranslator,
  type EditorChromeCopy,
} from '@ideanest/campaign-editor/copy';
import type { Locale } from '@ideanest/messages';
import { catalogue } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';

/**
 * The shared editor copy builders, fed from the app's catalogue — issue #162.
 *
 * `@ideanest/campaign-editor/copy` builds every word the editor draws out of a
 * {@link CampaignEditorTranslator}: a lookup rooted at `campaignEditor`, with `raw` for the
 * templates that carry a placeholder. The web hands it next-intl's `t`; this hands it
 * `use-intl`'s, which is the same formatter at the same version, over the same catalogue
 * (`@ideanest/messages`). So a screen here calls `basicsPanelCopyFrom(t)` and draws exactly the
 * words the web draws, in the reader's language.
 *
 * <p>The counter translator is rooted at `common.characterCount`, a different branch, because
 * that is where `editorChromeCopyFrom` reads the plural forms from.
 *
 * <p>Built once per language and kept: the translators are pure functions of the catalogue.
 */
export interface EditorTranslators {
  /** Rooted at `campaignEditor`. */
  readonly t: CampaignEditorTranslator;
  /** Rooted at `common.characterCount`. */
  readonly counter: CampaignEditorTranslator;
  readonly locale: Locale;
}

/** A missing key renders its own path rather than taking a screen down, as `lib/i18n.tsx` does. */
function fallback({ key, namespace }: { key: string; namespace?: string }): string {
  return namespace === undefined ? key : `${namespace}.${key}`;
}

/** The two halves of a `use-intl` translator the builders use, with the key loosened to a string. */
interface LooseTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

function translatorAt(locale: Locale, namespace: 'campaignEditor' | 'common.characterCount'): CampaignEditorTranslator {
  const translator = createTranslator({
    locale,
    messages: catalogue(locale),
    namespace,
    getMessageFallback: fallback,
    onError: () => {},
  }) as unknown as LooseTranslator;
  return Object.assign((key: string): string => translator(key), {
    raw: (key: string): unknown => translator.raw(key),
  });
}

const BUILT = new Map<Locale, EditorTranslators>();

/** The translators for one language. Pure, and cached per language. */
export function editorTranslators(locale: Locale): EditorTranslators {
  let built = BUILT.get(locale);
  if (built === undefined) {
    built = {
      t: translatorAt(locale, 'campaignEditor'),
      counter: translatorAt(locale, 'common.characterCount'),
      locale,
    };
    BUILT.set(locale, built);
  }
  return built;
}

/** The translators for the language in use; re-renders when it changes. */
export function useEditorTranslators(): EditorTranslators {
  const locale = useLocale();
  return useMemo(() => editorTranslators(locale), [locale]);
}

/** The frame's words — the tab names, the states, the save indicator, the drawer buttons. */
export function useEditorChromeCopy(): EditorChromeCopy {
  const { t, counter, locale } = useEditorTranslators();
  return useMemo(() => editorChromeCopyFrom(t, counter, locale), [t, counter, locale]);
}
