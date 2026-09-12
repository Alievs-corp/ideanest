import type { ProjectState } from '../projects/api';
import type { EditorTabKey } from '../../components/campaign-editor/tabs';

/**
 * The words the campaign editor's frame draws — issue #324, docs/architecture.md §21.1.
 *
 * <h2>Why the copy arrives as a prop, like the checkout's</h2>
 *
 * Every panel under `components/campaign-editor` is a client component and has to be: the
 * form autosaves as it is typed, the story editor holds a document in state, the reward
 * editor opens a drawer. None of them can call `getTranslations`.
 *
 * `useTranslations` would need a `NextIntlClientProvider` above them, and `lib/i18n/shell-copy.ts`
 * carries what this repository measured that to cost — up to **27.4 KiB on every route in a
 * group**, paid by routes that draw none of the words. So each page under
 * `app/[locale]/projects/[id]/edit` resolves this on the server and hands it down, the same
 * move `checkout-copy.ts` makes for the same reason.
 *
 * <h2>This is the frame only, not the panels</h2>
 *
 * `EditorShell` and `SaveStatus` are drawn by every tab, so their words are resolved once and
 * threaded through each panel rather than repeated per tab. The panels' own copy — the field
 * labels, the hints, the refusals — belongs to the panel and follows in its own change.
 * Keeping them apart is what lets a tab be translated without touching the other five.
 *
 * <h2>The state vocabulary is the editor's own, and that is not an oversight</h2>
 *
 * `admin.screens.campaignDirectory.state` already names all sixteen states of §6.1, and this
 * deliberately does not reuse it. The two audiences are different: a moderator reading a queue
 * sees `SUBMITTED` as "awaiting review", and the creator whose campaign it is sees "in review".
 * The English the editor already drew is preserved key for key.
 *
 * **The two vocabularies have already drifted in English**, and this change does not silence
 * that: the console spells `CANCELED` "Cancelled" and the editor "Canceled". Which of the two
 * the product says is a copy decision rather than a translation one, so it is reported rather
 * than quietly resolved here.
 */

/** Whether the work is safe — the three words `SaveStatus` can show. */
export interface SaveStatusCopy {
  readonly saving: string;
  readonly saved: string;
  readonly notSaved: string;
}

/**
 * The frame: the heading, the section links, the state tag and the save indicator.
 *
 * `tabs` and `states` are exhaustive records rather than index signatures, for the reason
 * `checkout-copy.ts` gives: a missing key should be a compile error and not a
 * `campaignEditor.tabs.story` printed where a section name belongs.
 */
export interface EditorChromeCopy {
  /** Sits above the title. Names the surface, not the campaign. */
  readonly eyebrow: string;
  /** Stands in for the title until the project has loaded. */
  readonly loadingTitle: string;
  /** Names the section links for assistive technology. */
  readonly sectionsLabel: string;
  readonly tabs: Readonly<Record<EditorTabKey, string>>;
  /** The visible cue on a section that has no route yet. */
  readonly soon: string;
  /**
   * The spoken half of that cue, appended to the tab's own name.
   *
   * IT CARRIES ITS OWN LEADING COMMA, and the comma is load-bearing. An accessible name is
   * the concatenation of its parts with each trimmed and no separator inserted, so a name
   * built from "Rewards" and "not available yet" reads "Rewardsnot available yet".
   */
  readonly notAvailable: string;
  readonly states: Readonly<Record<ProjectState, string>>;
  readonly save: SaveStatusCopy;
}

/**
 * A message lookup rooted at `campaignEditor`, narrowed to what these builders need.
 *
 * The same shape `AuthTranslator` takes, and for the same reason: the builders are pure
 * functions of a lookup, so a component test can build the identical object out of
 * `messages/*.json` and assert against the words the application will actually draw.
 */
export interface CampaignEditorTranslator {
  (key: string): string;
}

/** Every state in §6.1. Listed rather than derived, so a new one fails to compile. */
const PROJECT_STATES = [
  'DRAFT',
  'PRELAUNCH',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'LIVE',
  'SUSPENDED',
  'CANCELED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
] as const satisfies readonly ProjectState[];

/** The editor's sections, in the order `tabs.ts` declares them. */
const EDITOR_TAB_KEYS = [
  'basics',
  'rewards',
  'story',
  'faq',
  'prelaunch',
  'review',
] as const satisfies readonly EditorTabKey[];

function record<K extends string>(
  keys: readonly K[],
  read: (key: K) => string,
): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const key of keys) out[key] = read(key);
  return out;
}

export function editorChromeCopyFrom(t: CampaignEditorTranslator): EditorChromeCopy {
  return {
    eyebrow: t('eyebrow'),
    loadingTitle: t('loadingTitle'),
    sectionsLabel: t('sectionsLabel'),
    tabs: record(EDITOR_TAB_KEYS, (key) => t(`tabs.${key}`)),
    soon: t('soon'),
    notAvailable: t('notAvailable'),
    states: record(PROJECT_STATES, (state) => t(`state.${state}`)),
    save: {
      saving: t('save.saving'),
      saved: t('save.saved'),
      notSaved: t('save.notSaved'),
    },
  };
}
