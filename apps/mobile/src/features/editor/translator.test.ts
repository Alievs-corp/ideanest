import {
  basicsPanelCopyFrom,
  coverImageCopyFrom,
  newProjectCopyFrom,
  rewardsPanelCopyFrom,
  storyPanelCopyFrom,
} from '@ideanest/campaign-editor/copy';
import type { Locale } from '@ideanest/messages';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import { memoryStore } from '../../lib/storage';
import { forgetUnsentEdits, unsentKeyFor } from '../../lib/unsent-edits';
import { editorTranslators } from './translator';
import { editorChromeCopyFrom } from '@ideanest/campaign-editor/copy';

const LOCALES: readonly Locale[] = ['az', 'en', 'ru', 'tr'];

/** Every string in a copy object, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the editor translator over the app catalogue', () => {
  it('reads the same words the web reads', () => {
    const { t, counter } = editorTranslators('en');
    const chrome = editorChromeCopyFrom(t, counter, 'en');
    expect(chrome.eyebrow).toBe(en.campaignEditor.eyebrow);
    expect(chrome.tabs.prelaunch).toBe(en.campaignEditor.tabs.prelaunch);
    expect(chrome.characterCount.remaining.other).toBe(en.common.characterCount.remaining.other);
    // Templates come back raw, for `fillPlaceholders` where the number is known.
    expect(basicsPanelCopyFrom(t).titleHint).toBe(en.campaignEditor.basics.titleHint);
  });

  it.each(LOCALES)('builds every panel’s copy in %s with no key left unresolved', (locale) => {
    const { t, counter } = editorTranslators(locale);
    const chrome = editorChromeCopyFrom(t, counter, locale);
    const all = [
      chrome,
      basicsPanelCopyFrom(t),
      coverImageCopyFrom(t),
      newProjectCopyFrom(t),
      rewardsPanelCopyFrom(t, locale, chrome.characterCount),
      storyPanelCopyFrom(t, locale, chrome.characterCount),
    ].flatMap(strings);
    expect(all.filter((value) => value.startsWith('campaignEditor.') || value.startsWith('common.'))).toEqual([]);
  });

  it('reads Azerbaijani in Azerbaijani', () => {
    expect(newProjectCopyFrom(editorTranslators('az').t).start).toBe(az.campaignEditor.newProject.start);
  });

  it('never glues an Azerbaijani suffix to a number placeholder with a hyphen', () => {
    const glued = strings(az.mobile.editor).filter((value) => /\}-/u.test(value));
    expect(glued).toEqual([]);
  });
});

describe('forgetUnsentEdits', () => {
  it('removes every project’s unsent change and nothing else', () => {
    const store = memoryStore();
    store.set(unsentKeyFor('p1'), '{}');
    store.set(unsentKeyFor('p2'), '{}');
    store.set('ideanest.query-cache.v1', 'kept');
    forgetUnsentEdits(store);
    expect(store.getAllKeys()).toEqual(['ideanest.query-cache.v1']);
  });
});
