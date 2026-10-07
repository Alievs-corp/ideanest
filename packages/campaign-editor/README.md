# `@ideanest/campaign-editor`

The campaign editor's rules with one right answer — the contract it reads and writes, the
basics limits and single-field patches, the story block document's operations and problems,
the item, reward and FAQ drafts, the review checklist, the cover guidance, the tab order, the
autosave state machine and the editor's copy builders — one implementation, for `apps/web`
and `apps/mobile` (#162).

```ts
import { patchForField, validateBasics } from '@ideanest/campaign-editor/basics';
import { autosaveReducer, initialAutosave } from '@ideanest/campaign-editor/autosave';
import { toggleMark } from '@ideanest/campaign-editor/story';

patchForField('durationDays', draft);        // { durationDays: 30 }, or null when not worth sending
toggleMark('a word', 2, 6, 'strong').text;   // 'a **word**'
autosaveReducer(initialAutosave(), { type: 'queue', patch: { title: 'One' } }).status; // 'saving'
```

## Why this is a package

It used to be `apps/web/src/lib/projects/{basics,story,rewards,faqs,checklist,coverImage}.ts`,
`apps/web/src/components/campaign-editor/{tabs,rewardFailure}.ts`, the state half of
`useAutosave.ts`, the editor's types in `lib/projects/api.ts`, and
`lib/i18n/campaign-editor-copy.ts`. It moved when the app gained the creator path (#162): a
title has to be refused at the same sixty characters, a goal parsed to the same string, a
heading folded to the same anchor the server's `StoryDocuments` accepts, and a failed save kept
for the same lossless retry, on a phone as in a browser. A second implementation of the story
schema would disagree with the server on some block sooner or later. CLAUDE.md §3: shared
logic is never duplicated.

The web imports these modules directly; there are no re-export shims, except that
`lib/projects/api.ts` still re-exports the contract's types beside the requests that carry
them, as it already did for `ProjectState` and the story types.

**What is not here**, and why:

- **Requests.** The web goes through `authorizedFetch`; the app through its own `api()`. How a
  call is authorised and retried is the part the two clients do differently, so every fetch
  stays in its client and only the shapes it carries are here.
- **Timers and React state.** `./autosave` is the machine; the debounce, the flush on blur or
  unmount (and, in the app, on going to the background) are each client's wiring around it.
- **Measuring an image.** The web loads it into an `HTMLImageElement`, the app asks
  `Image.getSize`. Both ask `./cover-image` what the size means.
- **Turning an error into a `SaveFailure`.** The web's `describeFailure` reads its own
  `ApiError`; the app reads its own. Both produce the shape declared here.

## Modules

| Import | Holds |
|---|---|
| `./contract` | `ProjectEdit`, `ProjectPatch`, `CoverImage`, `isLocked`, `ProjectChecklist`, `ChecklistItem`, `ModerationOutcome`, `Category`, `Subcategory`, `RawTaxon`, `categoriesFrom`, `StoryVersionSummary`/`Detail`, `PrelaunchPage`, `RemindResult`, `Item`/`NewItem`/`ItemPatch`, `ShippingType`, `RewardItemLine`, `ShippingRate`, `Reward`/`NewReward`/`RewardPatch`, `ProjectFaq`/`NewProjectFaq`/`ProjectFaqPatch`; re-exports `Money`, `ProjectState` and the story types |
| `./basics` | `TITLE_MAX_CHARACTERS` (60), `BLURB_MAX_CHARACTERS` (135), `DURATION_MIN_DAYS`/`MAX_DAYS`/`RECOMMENDED_DAYS` (1/60/30), `characterCount`, `BasicsDraft`, `BasicsField`, `BASICS_FIELDS`, `isBasicsField`, `draftFromProject`, `toDateTimeLocal`, `fromDateTimeLocal`, `validateBasics`, `patchForField` |
| `./story` | `STORY_MIN_CHARACTERS` (500), `RISKS_MIN_CHARACTERS` (200), `emptyStory`, `slugifyHeading`, `uniqueHeadingId`, `headingAnchors`, `storyCharacterCount`, `parseSpans`, `spansToText`, `isMarkActive`, `toggleMark`, `newBlock`, `insertBlock`, `replaceBlock`, `removeBlock`, `moveBlock`, `blockProblem`, `storyProblems`, `isSaveable`, `isWebUrl`, `rejectedBlockIndex`, `renameHeading`, `describeBlock`; re-exports the reader's types, `readStoryDocument` and `STORY_SCHEMA_VERSION` from `@ideanest/campaign/story` |
| `./rewards` | `MAX_REWARD_TIERS` (100), the title, name and SKU limits, `SHIPPING_SCOPES`, `isShippingType`, `isShippedScope`, item and reward drafts with `validateItem`/`validateReward`, `newItemFrom`/`itemPatchFrom`, `newRewardFrom`/`rewardPatchFrom`, `shippingRatesFrom`/`shippingRatesChanged`, hiding (`isHiddenReward`, `hidePatch`, `showPatch`, `showBlockedReason`), `movedTo`, `describeStock`, `describeRewardContents`, `describeItemInUse`, `fieldErrorsFrom` |
| `./faqs` | `FAQ_QUESTION_MAX_CHARACTERS` (200), `FAQ_ANSWER_MAX_CHARACTERS` (4000), `MAX_PROJECT_FAQS` (50), `FaqDraft`, `validateFaq`, `newFaqFrom`, `faqPatchFrom`, `isEmptyFaqPatch`, `describeOrderRefusal` |
| `./checklist` | `CHECKLIST_SECTIONS`, `isChecklistSection`, `sectionHref`, `progressOf`, `describeProgress`, `unmetOf`, `unmetFromRefusal` |
| `./cover-image` | `COVER_MIN_WIDTH`/`HEIGHT` (1024×576, advice), `ImageSize`, `meetsCoverMinimum`, `describeSize` |
| `./tabs` | `EditorTabKey`, `EDITOR_TABS` (Basics · Rewards · Story · FAQ · Pre-launch · Review), `editorTabHref` |
| `./autosave` | `SaveState`, `SaveFailure`, `AutosaveMachine`, `AutosaveEvent`, `initialAutosave`, `autosaveReducer`, `isPending`, `canStart`, `unsavedPatch` |
| `./copy` | `CampaignEditorTranslator`, `CharacterCountCopy`, every panel's copy type and its `…CopyFrom` builder |

Import by subpath only. There is no root entry, so a web bundle pulls in exactly the module it
names, and the package is `sideEffects: false`: the web's first-load JS budgets have almost no
headroom.

`sectionHref` and `editorTabHref` answer web addresses (`/projects/{id}/edit/{segment}`). The
app maps the same segment onto its own `campaigns/{id}/edit/{segment}` route.

## The words

Nothing here reads a catalogue. Every rule that refuses in words takes its vocabulary as a
required argument — `validateBasics(draft, copy.validation)`, `blockProblem(block,
copy.vocabulary)` — and the `./copy` builders turn a `CampaignEditorTranslator` (a
`(key) => string` plus `raw(key) => unknown`, rooted at `campaignEditor`) into those objects.
The web hands them next-intl's `t`; the app builds one over `@ideanest/messages`. Templates
carrying a `{placeholder}` and plural forms are read through `raw`, because next-intl formats
`t()` as ICU and would render the key's path instead.

`validateFaq(draft, copy.entry.validation)` follows the same rule since #162: its refusals are
`campaignEditor.faq.validation.*`, with plural forms for the over-length count, so the app shows
them in the reader's language. The sentences the reward and FAQ lists draw from a refusal or a
composition — `describeRewardContents`, `describeItemInUse`, `describeOrderRefusal` — take the
panel's copy the same way, and both clients import them rather than keeping their own.

## Autosave

`autosaveReducer` is pure: `queue` merges a change over anything still waiting and shows
"saving" at once; `start` moves the queue into flight only when nothing is already in the air;
`succeeded` clears the failure and reports "saved" unless something was queued meanwhile;
`failed` puts the body back on the queue under anything newer, so a `retry` sends what was
typed. An event that does not apply returns the same object. `unsavedPatch` is everything not
yet acknowledged, which is what a client persists when it may be killed before the answer
arrives.

## Runtime

Plain TypeScript over `decimal.js`, `@ideanest/money`, `@ideanest/messages` and
`@ideanest/campaign`. No React, no Next, no DOM, so it runs the same in a browser, in a Server
Component and on Hermes. `describeBlock` and `validateReward` decline through `pluralise`,
which needs `Intl.PluralRules`; `apps/mobile` loads the polyfill before anything translates.

## Tests

`pnpm --filter @ideanest/campaign-editor test` (vitest). The tests moved here with the code;
`src/test-copy.ts` builds their copy from the English catalogue through the same builders the
clients call. The web's `useAutosave.test.tsx` still drives the hook over this machine.
