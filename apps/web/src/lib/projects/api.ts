import { authorizedFetch, publicFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Locale } from '../i18n/locale';
import {
  categoriesFrom,
  type Category,
  type Item,
  type ItemPatch,
  type NewItem,
  type NewProjectFaq,
  type NewReward,
  type PrelaunchPage,
  type ProjectChecklist,
  type ProjectEdit,
  type ProjectFaq,
  type ProjectFaqPatch,
  type ProjectPatch,
  type RawTaxon,
  type RemindResult,
  type Reward,
  type RewardPatch,
  type ShippingRate,
  type StoryVersionDetail,
  type StoryVersionSummary,
} from '@ideanest/campaign-editor/contract';

/**
 * The typed client for the creator's project endpoints.
 *
 * ONE MODULE, ONE PLACE. Every `/v1/projects` call the web application makes
 * belongs here, and the later editor tabs add functions to it rather than
 * starting a second client: two clients drift, and the second one is always the
 * one that forgets that money is a string. The sections below are laid out in
 * the order the epic builds them, so a new endpoint has an obvious home.
 *
 * Shapes come from the epic contract §5 and docs/architecture.md §10.2. Nothing
 * here invents a field.
 *
 * Nullable fields are typed `?: T | null` throughout. The service serialises
 * with `default-property-inclusion: non_null`, so a null `subcategoryId` is
 * ABSENT from the JSON rather than present and null — but the contract's own
 * example prints it as `null`, and a client that treats the two differently
 * breaks the first time that setting changes. Both readings mean "not set".
 */

/*
 * THE SHAPES LIVE IN `@ideanest/campaign-editor/contract` since #162, so the app's editor
 * sends and reads the same bodies. Re-exported here under the same names, as `ProjectState`
 * and the story types already were (#155), so a caller that imports a request and its body
 * from this module still finds both. Only the requests stay: how a call is authorised and
 * retried is the part the two clients do differently.
 */
export type {
  CampaignVideo,
  Category,
  ChecklistItem,
  ChecklistSection,
  CoverImage,
  Item,
  ItemPatch,
  ModerationOutcome,
  Money,
  NewItem,
  NewProjectFaq,
  NewReward,
  PrelaunchPage,
  ProjectChecklist,
  ProjectEdit,
  ProjectFaq,
  ProjectFaqPatch,
  ProjectPatch,
  ProjectState,
  RemindResult,
  Reward,
  RewardItemLine,
  RewardPatch,
  ShippingRate,
  ShippingType,
  StoryBlock,
  StoryDocument,
  StorySpan,
  StorySpans,
  StoryVersionDetail,
  StoryVersionSummary,
  Subcategory,
} from '@ideanest/campaign-editor/contract';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function readProject(response: Response): Promise<ProjectEdit> {
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as ProjectEdit;
}

/**
 * Starts a draft. The title is the only thing creation needs; everything else
 * is edited afterwards, which is what makes the editor autosave-shaped rather
 * than a long form with a submit button at the bottom.
 */
export async function createProject(
  input: { title: string },
  signal?: AbortSignal,
): Promise<ProjectEdit> {
  return readProject(
    await authorizedFetch('/v1/projects', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
      signal,
    }),
  );
}

/** The creator's projection of one project, for the editor. */
export async function getProjectEdit(id: string, signal?: AbortSignal): Promise<ProjectEdit> {
  const path = `/v1/projects/${encodeURIComponent(id)}/edit`;
  return readProject(await authorizedFetch(path, { signal }));
}

/**
 * Applies a partial update and returns the project as it now stands.
 *
 * The body has JSON Merge Patch semantics but is sent as `application/json`,
 * not `application/merge-patch+json`. The semantics are the server's contract;
 * the media type would be a second contract, and a Spring controller that
 * consumes the default type answers 415 to the specialised one. Declaring a
 * type the service has not agreed to would turn every autosave into a
 * negotiation failure.
 */
export async function patchProject(
  id: string,
  patch: ProjectPatch,
  signal?: AbortSignal,
): Promise<ProjectEdit> {
  return readProject(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
      signal,
    }),
  );
}

/* -------------------------------------------------------------------------
 * Submission — the completeness checklist and the state change (#37)
 *
 * The checklist is ADVICE. `POST /submit` re-checks the same rules with the same
 * server-side class, so a client that skipped this read, cached its answer, or is
 * an older build gets the same verdict — as a 409 rather than as a list. The panel
 * therefore treats a refusal as the authority and this read as a convenience,
 * never the other way round.
 *
 * Both answers carry prose — each row's `label` and `detail`, and the refusal's
 * list of what is missing — and the service writes it in the language the request's
 * `Accept-Language` asks for. So both take the language of the page they are drawn
 * on. Left to `authorizedFetch`, the header would come from the language cookie,
 * which is this browser's last choice rather than the route being read: a link to
 * `/az/projects/…/edit/review` opened in a browser whose cookie says `en` would draw
 * an Azerbaijani screen around an English checklist.
 * ---------------------------------------------------------------------- */

function inLanguage(locale: Locale | undefined): HeadersInit | undefined {
  return locale === undefined ? undefined : { 'Accept-Language': locale };
}

export async function getProjectChecklist(
  id: string,
  signal?: AbortSignal,
  locale?: Locale,
): Promise<ProjectChecklist> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}/checklist`, {
    signal,
    headers: inLanguage(locale),
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as ProjectChecklist;
}

/**
 * Sends the campaign to moderation, and answers the campaign as it now stands.
 *
 * Refused with `PROJECT_NOT_SUBMITTABLE` (409) when §5.3 is not satisfied, and
 * with `PROJECT_TRANSITION_NOT_ALLOWED` (409) when §6.1 does not allow the move
 * from the state the campaign is in — a campaign somebody else already submitted,
 * or one that was rejected. Both are conflicts because the request is well formed
 * and it is the campaign that refuses it.
 */
export async function submitProject(
  id: string,
  signal?: AbortSignal,
  locale?: Locale,
): Promise<ProjectEdit> {
  return readProject(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      signal,
      headers: inLanguage(locale),
    }),
  );
}

/**
 * Takes a cleared campaign live: `APPROVED` or `SCHEDULED` → `LIVE`.
 *
 * The one transition on this screen that moves money rather than paperwork. The
 * campaign enters every public listing, starts taking pledges, and its goal and
 * deadline freeze on the edge into `LIVE` — §6.1 has no way back to a draft. So
 * the interface asks first, the way `openPrelaunch` does for a much smaller
 * consequence.
 *
 * Refused with `PROJECT_TRANSITION_NOT_ALLOWED` (409) from any other state, and
 * with `PROJECT_NOT_LAUNCHABLE` (409) naming the fields a campaign cannot launch
 * without. Neither is a state a creator can reach from this panel while it draws
 * the control only for the two states that can launch, which is exactly why both
 * are rendered rather than assumed away.
 */
export async function launchProject(id: string, signal?: AbortSignal): Promise<ProjectEdit> {
  return readProject(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}/launch`, {
      method: 'POST',
      signal,
    }),
  );
}

/**
 * Extends a campaign's deadline, once — IDN-EXT-01 §5.1 (#34, #44).
 *
 * `until` is an instant no later than sixty days after the first deadline. The service decides
 * everything else — the window, the 50% floor, that there has been no extension before — and
 * refuses with `EXTENSION_NOT_AVAILABLE` and a `meta.reason`, which the dashboard words.
 */
export async function extendProject(id: string, until: string, signal?: AbortSignal): Promise<ProjectEdit> {
  return readProject(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}/extension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ until }),
      signal,
    }),
  );
}

/**
 * Withdraws the funds and closes the campaign — IDN-EXT-01 §5.1 (#41, #44).
 *
 * No body: the payout is priced by the service from what the campaign collected. A campaign below
 * 80%, or in a state with nothing to withdraw from, is refused with `WITHDRAWAL_NOT_AVAILABLE`.
 */
export async function withdrawProject(id: string, signal?: AbortSignal): Promise<ProjectEdit> {
  return readProject(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}/withdrawal`, {
      method: 'POST',
      signal,
    }),
  );
}

/* -------------------------------------------------------------------------
 * Taxonomy
 *
 * `GET /v1/categories` is in docs/architecture.md §10.2 under discovery and is
 * served by the project module until the discovery epic takes it over. The
 * basics form still treats a failure as "the list is unavailable" and keeps
 * saving everything else, because a read it does not strictly need in order to
 * save a title should not be able to block the editor.
 *
 * The endpoint localises. Each taxon carries a `name` already resolved against
 * the request's `Accept-Language` — which the browser sends on every fetch — and
 * falls back to Azerbaijani, the platform's primary language (§21.1), when the
 * requested one has no translation. It also carries `names`, every translation
 * the taxonomy holds; this client does not read it, because the language of the
 * page and the language of the request are the same thing here and asking for a
 * name the server has already chosen would be a second answer to one question.
 * ---------------------------------------------------------------------- */

export async function listCategories(signal?: AbortSignal): Promise<readonly Category[]> {
  const response = await authorizedFetch('/v1/categories', { signal });
  if (!response.ok) throw await errorFrom(response);

  return categoriesFrom((await response.json()) as readonly RawTaxon[]);
}

/* -------------------------------------------------------------------------
 * Story versions — contract §5 (#35)
 *
 * There is no function here that WRITES a version, and that is the contract
 * rather than an omission: the story is saved through `patchProject` with
 * everything else, and a version is a consequence of that save. The server
 * decides when one is due — the document changed and the newest version is older
 * than five minutes — so a client that could ask for one would be a second,
 * disagreeing answer to the same question.
 * ---------------------------------------------------------------------- */

/**
 * The kept versions of a story, newest first.
 *
 * Unpaged, because retention caps the list at fifty rows server-side. A `Pagination`
 * control for a second page that cannot exist would be an interface built for a
 * case the service has ruled out.
 */
export async function listStoryVersions(
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly StoryVersionSummary[]> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/story/versions`;
  const response = await authorizedFetch(path, { signal });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as readonly StoryVersionSummary[];
}

/** One version and its document, so it can be read before anything is replaced. */
export async function getStoryVersion(
  projectId: string,
  number: number,
  signal?: AbortSignal,
): Promise<StoryVersionDetail> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/story/versions/${number}`;
  const response = await authorizedFetch(path, { signal });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as StoryVersionDetail;
}

/**
 * Makes an older version the current story, and answers the whole project.
 *
 * A write, and a destructive one — it replaces whatever is in the editor. The
 * server preserves the replaced document as a version first, which is what makes
 * offering the action defensible; the interface still asks before doing it, because
 * "the story you have been writing for an hour is gone" is not a thing to discover
 * from a page that has already changed.
 */
export async function restoreStoryVersion(
  projectId: string,
  number: number,
  signal?: AbortSignal,
): Promise<ProjectEdit> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/story/versions/${number}/restore`;
  return readProject(await authorizedFetch(path, { method: 'POST', signal }));
}

/* -------------------------------------------------------------------------
 * Pre-launch and launch reminders — #39
 *
 * THREE OF THESE FOUR NEED NO SESSION, which is the whole point of the feature:
 * a pre-launch page collects followers from people who have not registered, and
 * asking them to sign in first is how the list stays empty. They go through
 * `publicFetch` rather than `authorizedFetch` for that reason — see the comment
 * on it for what changes when the visitor happens to be signed in anyway.
 *
 * `openPrelaunch` is the exception and is the creator's: it publishes the
 * campaign, and there is no way back (docs/architecture.md §6.1 has no
 * PRELAUNCH -> DRAFT edge).
 * ---------------------------------------------------------------------- */

/**
 * Opens the pre-launch page: `DRAFT` → `PRELAUNCH`.
 *
 * An action with consequences and no undo, so the interface asks first. It is a
 * transition like `submit` and `launch`, so it answers with the whole
 * `ProjectEdit` and the caller takes that as the new truth.
 */
export async function openPrelaunch(id: string, signal?: AbortSignal): Promise<ProjectEdit> {
  return readProject(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}/prelaunch`, {
      method: 'POST',
      signal,
    }),
  );
}

/** The public pre-launch page. 404 for a campaign that has not opened one. */
export async function getPrelaunchPage(id: string, signal?: AbortSignal): Promise<PrelaunchPage> {
  const response = await publicFetch(`/v1/projects/${encodeURIComponent(id)}/prelaunch`, { signal });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as PrelaunchPage;
}

/**
 * Asks to be told when the campaign opens.
 *
 * The address is omitted when the visitor is signed in: the service uses their
 * account's verified address, and sending one from here would be sending an
 * address the client chose over one registration proved.
 */
export async function remindMe(
  id: string,
  input: { email?: string } = {},
  signal?: AbortSignal,
): Promise<RemindResult> {
  const response = await publicFetch(`/v1/projects/${encodeURIComponent(id)}/remind`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as RemindResult;
}

/**
 * Takes the caller off the list.
 *
 * `token` is the credential from an unsubscribe link, for somebody with no
 * account; a signed-in visitor needs neither it nor anything else. Answers 204
 * whether or not there was anything to remove — a response that said would let
 * anybody ask whether a given person follows a given campaign.
 */
export async function forgetMe(id: string, token?: string, signal?: AbortSignal): Promise<void> {
  const query = token === undefined ? '' : `?token=${encodeURIComponent(token)}`;
  const response = await publicFetch(`/v1/projects/${encodeURIComponent(id)}/remind${query}`, {
    method: 'DELETE',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
}

/* -------------------------------------------------------------------------
 * Saving a campaign — §4.9's C-09, from the campaign page (#281)
 *
 * THE DELETE IS NOT HERE, AND THAT IS THE POINT. `unsaveCampaign` already exists in
 * `lib/community/signals.ts`, written for the saved-list screen, and the campaign page's
 * save control imports that one rather than growing a second copy. Two implementations of
 * one path is how a screen ends up calling an endpoint that moved.
 *
 * The POST had no caller until this page, because the only surface that could save a
 * campaign was the list of campaigns already saved.
 * ---------------------------------------------------------------------- */

/** Whether the caller has this campaign saved, after the call they just made. */
export interface SaveState {
  saved: boolean;
}

/**
 * Saves a campaign — `POST /v1/projects/{projectId}/save`.
 *
 * <strong>Idempotent, and the response is what the control renders from.</strong> The
 * service's own note says "saved" and "already saved" are the same success and that a
 * response distinguishing them would answer a question nobody asked; so a second press
 * changes nothing and the returned `saved` flag is the truth the button shows afterwards
 * rather than a value this side guessed.
 *
 * <strong>There is no read of "have I saved this one".</strong> §10.2 publishes
 * `GET /v1/me/saved` — a paginated list — and no per-campaign check, so a page cannot know
 * the initial state without walking every page of somebody's saved campaigns. The control
 * therefore offers the action rather than reflecting the state until it is pressed, and
 * `CampaignActions` says what that looks like and why it is harmless.
 */
export async function saveCampaign(projectId: string, signal?: AbortSignal): Promise<SaveState> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/save`, {
    method: 'POST',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as SaveState;
}

/* -------------------------------------------------------------------------
 * Items — docs/architecture.md §10.2 (#32, #34)
 *
 * The atomic things a campaign produces. Items come BEFORE tiers, which is the
 * order §4.6 puts them in: a tier is a selection of items with quantities, so
 * there is nothing to compose until these exist.
 * ---------------------------------------------------------------------- */

async function readItem(response: Response): Promise<Item> {
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as Item;
}

/** Every item of the campaign, oldest first. */
export async function listItems(projectId: string, signal?: AbortSignal): Promise<readonly Item[]> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/items`;
  const response = await authorizedFetch(path, { signal });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as readonly Item[];
}

export async function createItem(
  projectId: string,
  input: NewItem,
  signal?: AbortSignal,
): Promise<Item> {
  return readItem(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/items`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
      signal,
    }),
  );
}

export async function patchItem(id: string, patch: ItemPatch, signal?: AbortSignal): Promise<Item> {
  return readItem(
    await authorizedFetch(`/v1/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
      signal,
    }),
  );
}

/**
 * Removes an item.
 *
 * `409 ITEM_IN_USE` when a reward tier contains it, carrying the tiers in
 * `meta.rewardTierIds` so the editor can name them. Deleting it would change
 * what a backer was promised, so the refusal is the correct answer and the
 * creator takes it out of each tier first.
 */
export async function deleteItem(id: string, signal?: AbortSignal): Promise<void> {
  const response = await authorizedFetch(`/v1/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  });
  // 204, so there is nothing to read. Parsing it would fail on an empty body.
  if (!response.ok) throw await errorFrom(response);
}

/* -------------------------------------------------------------------------
 * Reward tiers — docs/architecture.md §10.2 (#32, #34)
 * ---------------------------------------------------------------------- */

async function readReward(response: Response): Promise<Reward> {
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as Reward;
}

async function readRewards(response: Response): Promise<readonly Reward[]> {
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as readonly Reward[];
}

/**
 * The campaign's reward list, in display order, INCLUDING secret tiers.
 *
 * A creator who cannot see a secret tier in their own editor cannot edit or
 * withdraw it. What makes it secret is that the public list leaves it out, and
 * that list is a different endpoint owned by the campaign page.
 */
export async function listRewards(
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly Reward[]> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/rewards`;
  return readRewards(await authorizedFetch(path, { signal }));
}

export async function createReward(
  projectId: string,
  input: NewReward,
  signal?: AbortSignal,
): Promise<Reward> {
  return readReward(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(projectId)}/rewards`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
      signal,
    }),
  );
}

export async function patchReward(
  id: string,
  patch: RewardPatch,
  signal?: AbortSignal,
): Promise<Reward> {
  return readReward(
    await authorizedFetch(`/v1/rewards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
      signal,
    }),
  );
}

/**
 * Removes a tier nobody has claimed.
 *
 * `409 REWARD_HAS_BACKERS` once somebody has, with the count in `meta`. §5.3
 * permits no exception and gives the alternative: the tier is withdrawn from
 * sale rather than deleted, so the people who chose it still have a description
 * of what they are owed.
 */
export async function deleteReward(id: string, signal?: AbortSignal): Promise<void> {
  const response = await authorizedFetch(`/v1/rewards/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
}

/** Copies a tier — wording, price, composition, rates — to the end of the list. */
export async function duplicateReward(id: string, signal?: AbortSignal): Promise<Reward> {
  const path = `/v1/rewards/${encodeURIComponent(id)}/duplicate`;
  return readReward(await authorizedFetch(path, { method: 'POST', signal }));
}

/**
 * Puts the tiers in the order given, and answers the list in that order.
 *
 * EVERY TIER, EXACTLY ONCE, or the service answers `400
 * REWARD_ORDER_INCOMPLETE` naming what was missing and what was unexpected. A
 * partial list would leave the tiers it omits where they were, interleaved with
 * the ones that moved — so the caller sends the whole list, which is the whole
 * list it is already holding.
 */
export async function reorderRewards(
  projectId: string,
  rewardIds: readonly string[],
  signal?: AbortSignal,
): Promise<readonly Reward[]> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/rewards/reorder`;
  return readRewards(
    await authorizedFetch(path, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ rewardIds }),
      signal,
    }),
  );
}

/**
 * Replaces a tier's whole shipping rate table, and answers the whole tier.
 *
 * `PUT` because it is a replacement: a country the body leaves out is a country
 * the creator has removed, and an empty list clears the table. Merging would
 * leave a creator shipping somewhere they believe they no longer do, which is
 * discovered by a backer selecting it.
 *
 * Refused with `REWARD_FIELD_INVALID` on `shippingType` when the tier is not
 * shipped, because rates on a tier nothing quotes from are rates a creator
 * believes are in force.
 */
export async function replaceShippingRules(
  id: string,
  rules: readonly ShippingRate[],
  signal?: AbortSignal,
): Promise<Reward> {
  return readReward(
    await authorizedFetch(`/v1/rewards/${encodeURIComponent(id)}/shipping-rules`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ rules }),
      signal,
    }),
  );
}

/* -------------------------------------------------------------------------
 * FAQ — docs/architecture.md §4.4 and §10.2 (#283)
 * ---------------------------------------------------------------------- */

async function readFaq(response: Response): Promise<ProjectFaq> {
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as ProjectFaq;
}

/**
 * The list, unwrapped from its envelope.
 *
 * `ProjectFaqListResponse` is `{ faqs: [...] }` rather than a bare array — the
 * envelope is what lets the service add a cursor later without breaking every
 * client, which §4.4 says is the answer if fifty entries stops being enough.
 * `??` rather than a cast, because springdoc marks the property optional.
 */
async function readFaqs(response: Response): Promise<readonly ProjectFaq[]> {
  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json()) as { faqs?: readonly ProjectFaq[] };
  return body.faqs ?? [];
}

/**
 * The campaign's FAQ list, in the creator's order.
 *
 * <h3>THE SAME ENDPOINT THE PUBLIC TAB READS, WITH A TOKEN</h3>
 *
 * `GET /v1/projects/{projectId}/faqs` is `permitAll`, and the campaign page
 * reads it anonymously from the server (`lib/community/faqs.ts`). The editor
 * reads it with the account's bearer token, and the difference is not cosmetic:
 * a campaign that is not in a public state answers 404 to a stranger, and the
 * team can read its own unlaunched campaign's list. A creator writing the FAQ
 * of a draft is exactly that case, so the anonymous reader would answer 404 for
 * every campaign this editor is used on before launch.
 */
export async function listFaqs(
  projectId: string,
  signal?: AbortSignal,
): Promise<readonly ProjectFaq[]> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/faqs`;
  return readFaqs(await authorizedFetch(path, { signal }));
}

/** Adds an entry to the end of the list. Refused past `MAX_PROJECT_FAQS` (`@ideanest/campaign-editor/faqs`). */
export async function createFaq(
  projectId: string,
  input: NewProjectFaq,
  signal?: AbortSignal,
): Promise<ProjectFaq> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/faqs`;
  return readFaq(
    await authorizedFetch(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
      signal,
    }),
  );
}

/**
 * Edits one entry and answers it as it now stands.
 *
 * Merge-patch semantics sent as `application/json`, for the reason
 * `patchProject` gives at length: the semantics are the service's contract, and
 * declaring `application/merge-patch+json` to a controller that consumes the
 * default type turns every save into a 415.
 */
export async function patchFaq(
  id: string,
  patch: ProjectFaqPatch,
  signal?: AbortSignal,
): Promise<ProjectFaq> {
  return readFaq(
    await authorizedFetch(`/v1/faqs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
      signal,
    }),
  );
}

/**
 * Removes one entry.
 *
 * Nothing is owed against an FAQ entry — unlike a reward tier, which is why
 * `deleteReward` has a `REWARD_HAS_BACKERS` branch and this does not — so the
 * deletion is unconditional and the confirmation is the interface's business.
 */
export async function deleteFaq(id: string, signal?: AbortSignal): Promise<void> {
  const response = await authorizedFetch(`/v1/faqs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  });
  if (!response.ok) throw await errorFrom(response);
}

/**
 * Puts the entries in the order given, and answers the list in that order.
 *
 * EVERY ENTRY, EXACTLY ONCE, or the service answers `400 FAQ_ORDER_INCOMPLETE`
 * with `meta.missing` and `meta.unexpected` naming what was wrong. The rule and
 * the reason are `reorderRewards`'s: a partial list would leave the entries it
 * omits where they were, interleaved with the ones that moved, and a reorder
 * that rewrites the whole list from zero means two concurrent reorders produce
 * one of the two orders rather than a blend of both.
 */
export async function reorderFaqs(
  projectId: string,
  faqIds: readonly string[],
  signal?: AbortSignal,
): Promise<readonly ProjectFaq[]> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/faqs/reorder`;
  return readFaqs(
    await authorizedFetch(path, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ faqIds }),
      signal,
    }),
  );
}

/* -------------------------------------------------------------------------
 * Still to come. Each of these is a function in THIS module, not a new client.
 *
 *   #31 launch and cancel        POST /v1/projects/{id}/launch | cancel
 *
 * The story, risks, and cover fields of `ProjectPatch` are already here because
 * they are written through the same autosave path; the tabs that own them add
 * their own endpoints, not their own patch type.
 * ---------------------------------------------------------------------- */
