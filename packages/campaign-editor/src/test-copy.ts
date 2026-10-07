import MESSAGES from '@ideanest/messages/en.json';
import {
  basicsPanelCopyFrom,
  editorChromeCopyFrom,
  reviewPanelCopyFrom,
  rewardsPanelCopyFrom,
  storyPanelCopyFrom,
  type BasicsPanelCopy,
  type CampaignEditorTranslator,
  type EditorChromeCopy,
  type ReviewPanelCopy,
  type RewardsPanelCopy,
  type StoryPanelCopy,
} from './copy';

/**
 * The editor's copy as the catalogue resolves it, for this package's own tests.
 *
 * Built through the same builders the clients call rather than typed out: a literal here would
 * be a second copy of the catalogue, and the suite would keep passing after somebody changed a
 * message in `@ideanest/messages/en.json`. Not exported from the package — it is a fixture.
 *
 * English only, as `apps/web/src/test-editor-copy.ts` explains: the rules do not choose their
 * language, and `catalogue.test.ts` in `@ideanest/messages` already asserts every key exists in
 * all four.
 */
function at(key: string): unknown {
  let node: unknown = MESSAGES.campaignEditor;
  for (const segment of key.split('.')) node = (node as Record<string, unknown>)[segment];
  return node;
}

/*
 * `raw` alongside `t`, and `t` refuses a template. next-intl throws a FORMATTING_ERROR on
 * `t('…{max}…')`, so a fixture that did not would be more permissive than the application.
 */
const read: CampaignEditorTranslator = Object.assign(
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

/* The counter's forms live under `common.characterCount`, a different root. */
const counter: CampaignEditorTranslator = Object.assign(
  (key: string): string => {
    throw new Error(`common.characterCount.${key} is a set of plural forms — read it with raw()`);
  },
  {
    raw(key: string): unknown {
      let node: unknown = MESSAGES.common.characterCount;
      for (const segment of key.split('.')) node = (node as Record<string, unknown>)[segment];
      return node;
    },
  },
);

export const EDITOR_COPY: EditorChromeCopy = editorChromeCopyFrom(read, counter, 'en');

export const BASICS_COPY: BasicsPanelCopy = basicsPanelCopyFrom(read);

export const REWARDS_COPY: RewardsPanelCopy = rewardsPanelCopyFrom(read, 'en', EDITOR_COPY.characterCount);

export const STORY_COPY: StoryPanelCopy = storyPanelCopyFrom(read, 'en', EDITOR_COPY.characterCount);

export const REVIEW_COPY: ReviewPanelCopy = reviewPanelCopyFrom(read, 'en');
