import { authorizedFetch, publicFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Money } from '../money';
import type { StoryDocument } from './story';

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

export type { Money } from '../money';

/* -------------------------------------------------------------------------
 * Lifecycle — contract §5 (#31)
 * ---------------------------------------------------------------------- */

/**
 * Exactly the nineteen states of docs/architecture.md §6.1, no more. IDN-EXT-01 added
 * `CLOSING_WINDOW`, `EXTENDED` and `WITHDRAWN` (#32); `COLLECTING` and `LATE_PLEDGE` stay
 * until stage 4 removes them (#45).
 *
 * The editor only ever renders these; the transitions themselves are the
 * server's business and there is deliberately no client-side copy of the
 * transition table to fall out of step with it.
 */
export type ProjectState =
  | 'DRAFT'
  | 'PRELAUNCH'
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'LIVE'
  | 'CLOSING_WINDOW'
  | 'EXTENDED'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'SUCCESSFUL'
  | 'UNSUCCESSFUL'
  | 'WITHDRAWN'
  | 'COLLECTING'
  | 'LATE_PLEDGE'
  | 'FULFILLING'
  | 'COMPLETED';

/**
 * The cover image, as three plain fields.
 *
 * INTERIM, and known to be. There is no media table and no uploader yet, so
 * the columns behind this are `cover_image_url`, `cover_image_width`, and
 * `cover_image_height` rather than a reference into a media pipeline
 * (contract §3). The width and height are here because §5.3 makes a cover of at
 * least 1024×576 a submission requirement, and the checklist (#37) cannot check
 * what nothing records. The media epic replaces the three with `main_image_id`
 * under expand-then-contract, at which point this type changes shape once, in
 * one file.
 */
export interface CoverImage {
  url: string;
  width: number;
  height: number;
  /**
   * The uploaded file behind the other three, when there is one.
   *
   * Send this alone to set a cover from an upload: the server fills in the location and the
   * dimensions from what it measured, and ignores the other three fields. They are still
   * populated on the way out, and `mediaId` is null for every cover that predates the
   * uploader and for one supplied as a typed address.
   */
  mediaId?: string | null;
}

/**
 * The story document, as `PATCH /v1/projects/{id}` carries it.
 *
 * The block union lives in `./story` alongside the operations the editor performs
 * on it, and is re-exported here so that a client reading a `ProjectEdit` does not
 * have to know there are two modules. #35 owns it; the server validates the same
 * schema (`StoryDocuments`).
 *
 * A response is narrowed with `readStoryDocument` rather than cast. The story may
 * have been written by a newer deployment of the editor, and casting would put a
 * block this build does not recognise into the editor's state — where the next
 * autosave would send it back mangled.
 */
export type { StoryBlock, StoryDocument, StorySpan, StorySpans } from './story';

/**
 * A project as the editor sees it — the creator's projection, contract §5.
 *
 * This is the response of every mutation in this file, so one request both
 * changes the project and returns the truth about it. The editor therefore
 * never has to guess what the server did with what it sent.
 */
export interface ProjectEdit {
  id: string;
  slug: string;
  state: ProjectState;
  title: string;
  blurb?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  goal?: Money | null;
  durationDays?: number | null;
  /** ISO 8601, UTC. */
  scheduledLaunchAt?: string | null;
  launchedAt?: string | null;
  deadline?: string | null;
  story?: StoryDocument | null;
  risks?: string | null;
  coverImage?: CoverImage | null;
  latePledgeEnabled: boolean;
  /**
   * Field names the server will refuse to change, by name — `"goal"`,
   * `"durationDays"`.
   *
   * Empty until the campaign launches; from `LIVE` onwards it lists `goal`,
   * `durationDays`, and `scheduledLaunchAt`, which §5.3 freezes. A client-side
   * guess at the same rule is not the plan: immutability after launch is a
   * business rule and it is enforced where the money is, so this list is read
   * rather than derived and an editor that ignores it is answered
   * `409 PROJECT_FIELD_LOCKED`.
   */
  lockedFields: readonly string[];
  createdAt: string;
  updatedAt: string;
}

/** True when the server has said this field may no longer be edited. */
export function isLocked(project: ProjectEdit | null | undefined, field: string): boolean {
  return project?.lockedFields.includes(field) ?? false;
}

/**
 * A partial update, with JSON Merge Patch semantics (contract §5).
 *
 * An absent key leaves the field alone; an explicit `null` clears it. That
 * distinction is why every optional field here is `T | null` rather than just
 * `T`, and why the autosave path builds patches by field rather than sending
 * the whole form: sending the whole form would overwrite the story with
 * whatever the basics tab happened to be holding.
 */
export interface ProjectPatch {
  title?: string;
  blurb?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  goal?: Money | null;
  durationDays?: number | null;
  scheduledLaunchAt?: string | null;
  story?: StoryDocument | null;
  risks?: string | null;
  coverImage?: CoverImage | null;
  latePledgeEnabled?: boolean;
}

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
 * ---------------------------------------------------------------------- */

/**
 * Which editor tab fixes a requirement — the route segment, not a label.
 *
 * `string` rather than a union of the three the service sends today, on purpose.
 * A requirement pointing at a section this build does not know about is a
 * deployment ahead of the client, and a union would make that a type error at the
 * boundary and a silently wrong link at runtime. `isChecklistSection` in
 * `./checklist` narrows it, and an item that does not narrow is rendered without
 * a link rather than with one that goes nowhere.
 */
export type ChecklistSection = string;

/**
 * One requirement of docs/architecture.md §5.3, and how this campaign stands
 * against it.
 *
 * `requirement` is the stable name to branch on — `COVER_IMAGE`, `RISKS`.
 * `label` and `detail` are prose and may be reworded at any time (§10.4), so
 * nothing keys off them.
 */
export interface ChecklistItem {
  requirement: string;
  label: string;
  satisfied: boolean;
  section: ChecklistSection;
  /** Why it is not met, quoting the campaign's own numbers. Absent when it is met. */
  detail?: string | null;
}

/**
 * The last decision platform staff took, as the creator reads it.
 *
 * `current` is the server's answer to "is this something to act on now, or is it
 * what happened last time" — a campaign resubmitted after a change request is in
 * `SUBMITTED` while the newest note is still the change request's. The client
 * does not work that out by comparing states; getting it wrong means shouting at
 * somebody whose campaign is fine.
 */
export interface ModerationOutcome {
  outcome: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  note?: string | null;
  /** ISO 8601, UTC. */
  decidedAt: string;
  current: boolean;
}

/**
 * `GET /v1/projects/{id}/checklist`.
 *
 * Blocking and advisory arrive as two arrays rather than one with a flag,
 * because an interface that renders a suggestion in the same red as a
 * requirement teaches creators that the checklist exaggerates — and the half they
 * stop reading is the half that was true.
 */
export interface ProjectChecklist {
  projectId: string;
  state: ProjectState;
  /** Whether §5.3 is satisfied. Not whether §6.1 allows the move from here. */
  submittable: boolean;
  /** 0–100 over every requirement, blocking weighted twice advisory. */
  score: number;
  blocking: readonly ChecklistItem[];
  advisory: readonly ChecklistItem[];
  moderation?: ModerationOutcome | null;
}

export async function getProjectChecklist(
  id: string,
  signal?: AbortSignal,
): Promise<ProjectChecklist> {
  const response = await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}/checklist`, {
    signal,
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
export async function submitProject(id: string, signal?: AbortSignal): Promise<ProjectEdit> {
  return readProject(
    await authorizedFetch(`/v1/projects/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      signal,
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

export interface Subcategory {
  id: string;
  slug: string;
  name: string;
}

export interface Category extends Subcategory {
  subcategories: readonly Subcategory[];
}

/**
 * One taxon as the endpoint sends it.
 *
 * `name` is optional and the slug is the fallback only so that a malformed
 * response cannot put `undefined` into an `<option>`. The response also carries
 * `nameAz` and `nameEn`, which are the interim columns of V6 and are on their
 * way out under expand-then-contract — this client deliberately does not read
 * them, because the API cannot drop them until nothing does.
 */
interface RawTaxon {
  id: string;
  slug: string;
  name?: string;
  subcategories?: readonly RawTaxon[];
}

function taxonName(raw: RawTaxon): string {
  return raw.name ?? raw.slug;
}

export async function listCategories(signal?: AbortSignal): Promise<readonly Category[]> {
  const response = await authorizedFetch('/v1/categories', { signal });
  if (!response.ok) throw await errorFrom(response);

  const raw = (await response.json()) as readonly RawTaxon[];

  return raw.map((category) => ({
    id: category.id,
    slug: category.slug,
    name: taxonName(category),
    subcategories: (category.subcategories ?? []).map((sub) => ({
      id: sub.id,
      slug: sub.slug,
      name: taxonName(sub),
    })),
  }));
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

/** One row of the history. Without the document; see `getStoryVersion`. */
export interface StoryVersionSummary {
  number: number;
  /** ISO 8601, UTC. */
  createdAt: string;
  authorId: string;
  /**
   * Characters of prose, counted as §5.3 counts them.
   *
   * The one number that makes a list of timestamps usable: "3 minutes ago, 1,240
   * characters" tells a creator which version came before they deleted a section,
   * and a timestamp alone does not.
   */
  characters: number;
}

export interface StoryVersionDetail extends StoryVersionSummary {
  /**
   * Unnarrowed on purpose. Callers pass it through `readStoryDocument`, which
   * refuses a document written against a schema this build does not know rather
   * than letting it into the editor's state.
   */
  document: unknown;
}

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
 * A campaign as its public pre-launch page shows it.
 *
 * DELIBERATELY NARROW, and the server draws the same line. There is no creator,
 * no goal, no story, and no category here: `GET /v1/projects/{creatorSlug}/
 * {projectSlug}` is the public project page and it belongs to another epic, so
 * nothing in this issue may decide its shape by accident. What is left is the
 * promise a pre-launch page makes — read from the same columns the campaign page
 * will use, so the page somebody followed and the campaign it becomes cannot
 * disagree.
 */
export interface PrelaunchPage {
  id: string;
  slug: string;
  /** `PRELAUNCH` or `SCHEDULED`; the endpoint 404s for every other state. */
  state: ProjectState;
  title: string;
  blurb?: string | null;
  coverImage?: CoverImage | null;
  /** ISO 8601, UTC. */
  scheduledLaunchAt?: string | null;
  /**
   * How many people have asked to be told. The one number that makes a
   * pre-launch page work: a campaign with no pledges yet has nothing else to
   * show that anybody else cares about it.
   */
  followerCount: number;
}

/** The answer to "tell me when this opens". */
export interface RemindResult {
  /** Always true after a successful call. */
  following: boolean;
  followerCount: number;
}

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

/**
 * An item as the creator's editor sees it — `ItemResponse`.
 *
 * `imageUrl` is an address the client declared, not an upload. There is no
 * media pipeline (docs/architecture.md §13), and the field becomes a reference
 * to a `media` row when there is one; the interface says so rather than
 * pretending to have an uploader.
 */
export interface Item {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  /** Absent for a digital item, which the service refuses to give a weight. */
  weightGrams?: number | null;
  isDigital: boolean;
  sku?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `CreateItemRequest`. Only the name is required. */
export interface NewItem {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  weightGrams?: number | null;
  isDigital?: boolean;
  sku?: string | null;
}

/**
 * `ItemPatchRequest`, with JSON Merge Patch semantics.
 *
 * Same rule as `ProjectPatch`: an absent key leaves the field alone, an
 * explicit `null` clears it. That is why every optional field is `T | null`
 * rather than `T`.
 */
export interface ItemPatch {
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  weightGrams?: number | null;
  isDigital?: boolean;
  sku?: string | null;
}

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

/**
 * How a tier reaches the person who backed it — `ShippingType`.
 *
 * A property of the tier, not of the campaign: one campaign routinely offers a
 * digital thank-you, a poster shipped domestically, and a boxed set shipped
 * anywhere, and each is a different question at checkout.
 */
export type ShippingType = 'NONE' | 'DIGITAL' | 'LOCAL_PICKUP' | 'DOMESTIC' | 'INTERNATIONAL';

/** One line of a tier's composition — `RewardItemBody`. */
export interface RewardItemLine {
  itemId: string;
  quantity: number;
}

/**
 * One destination's shipping rate — `ShippingRuleBody`.
 *
 * BOTH AMOUNTS ARE STRINGS, for the reason every amount in this file is
 * (§10.3): they are added to a pledge total and charged to a card. There is no
 * currency on a rate — the whole table is denominated in the campaign's, which
 * the tier already carries, so repeating it on thirty destinations would be
 * thirty chances for one of them to disagree with the tier it belongs to.
 *
 * One type for the request and the response, matching the server's own single
 * record: two would drift the first time a field was added to one of them.
 */
export interface ShippingRate {
  /** ISO 3166-1 alpha-2, uppercase. The service normalises and re-checks it. */
  countryCode: string;
  amount: string;
  /** What each unit after the first costs. `"0.00"` is a flat rate, deliberately. */
  additionalItemAmount: string;
}

/**
 * A reward tier as the creator's editor sees it — `RewardResponse`.
 *
 * The response of every endpoint that touches a tier, so the editor applies the
 * same update whichever call it made. It is the CREATOR's projection and
 * carries what no public response may: the reservation counts and the secret
 * token.
 */
export interface Reward {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  price: Money;
  /** An ISO date. A month is what a creator can honestly promise. */
  estimatedDelivery?: string | null;
  /** Null is unlimited, which is the common case. */
  limitQuantity?: number | null;
  /** Places taken by confirmed pledges. Read-only; epic #50 writes it. */
  claimedQuantity: number;
  /** Places held by a checkout in progress. Read-only; #51 writes it. */
  reservedQuantity: number;
  /** Derived from the three above, or null when unlimited. */
  remainingQuantity?: number | null;
  shippingType: ShippingType;
  isEarlyBird: boolean;
  isFeatured: boolean;
  isSecret: boolean;
  /** The link that reaches a secret tier. Present only for the creator. */
  secretToken?: string | null;
  isAddon: boolean;
  sortOrder: number;
  /** ISO 8601, UTC. */
  availableFrom?: string | null;
  /**
   * ISO 8601, UTC. A moment in the PAST is how the service expresses "hidden"
   * (docs/architecture.md §5.3): it withdraws a tier from sale without deleting
   * it, which is the only thing permitted once somebody has backed it. The
   * editor presents that as hiding rather than as a date — see `lib/projects/rewards`.
   */
  availableUntil?: string | null;
  items: readonly RewardItemLine[];
  shippingRules: readonly ShippingRate[];
  /**
   * The optimistic-locking counter.
   *
   * No endpoint takes it yet, so nothing here sends it. It is read because a
   * concurrent write is answered `409 REWARD_MODIFIED`, and knowing the version
   * a refusal was about is what lets a later `If-Match` be added without a
   * second read.
   */
  version: number;
  /**
   * True once §5.3 has frozen this tier's price, which happens at launch.
   *
   * ON THE REWARD, NOT IN `ProjectEdit.lockedFields`. That array is filtered
   * server-side to the campaign's own patch keys — `goal`, `durationDays`,
   * `scheduledLaunchAt` — so it can never name a field of this body. The editor
   * used to look for `'price'` in it and therefore never disabled anything (#183).
   *
   * There is no counterpart for `limitQuantity` because §5.3 permits raising it
   * at any time. The client validates it against what is claimed and reserved and
   * lets the service refuse a lowering it cannot know about.
   */
  pricingLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `CreateRewardRequest`. A title and a price; the rest is edited afterwards. */
export interface NewReward {
  title: string;
  description?: string | null;
  price: Money;
  estimatedDelivery?: string | null;
  limitQuantity?: number | null;
  shippingType?: ShippingType;
  isEarlyBird?: boolean;
  isFeatured?: boolean;
  isSecret?: boolean;
  isAddon?: boolean;
  availableFrom?: string | null;
  availableUntil?: string | null;
  items?: readonly RewardItemLine[];
}

/**
 * `RewardPatchRequest`, with JSON Merge Patch semantics.
 *
 * `items` replaces the WHOLE composition when present. There is no
 * add-one-line patch, because a composition is what a backer is promised and
 * the client always holds all of it — a per-line patch would let two tabs each
 * remove a different item and leave a tier containing neither.
 *
 * The per-country rates are deliberately absent. They are replaced through
 * `replaceShippingRules`, because a rate table is read as a whole by whatever
 * quotes from it.
 */
export interface RewardPatch {
  title?: string;
  description?: string | null;
  price?: Money;
  estimatedDelivery?: string | null;
  limitQuantity?: number | null;
  shippingType?: ShippingType;
  isEarlyBird?: boolean;
  isFeatured?: boolean;
  isSecret?: boolean;
  isAddon?: boolean;
  availableFrom?: string | null;
  availableUntil?: string | null;
  items?: readonly RewardItemLine[];
}

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

/**
 * One entry of the campaign's question and answer list.
 *
 * Three fields and no timestamps, because that is the whole of what the service
 * publishes: `ProjectFaqResponse` carries an identifier, a question and an
 * answer. The order is not on the entry either — `sort_order` is a column the
 * service reads and the list is returned in it, so position is a property of
 * the list rather than of the row, exactly as it is for a reward tier.
 */
export interface ProjectFaq {
  id: string;
  question: string;
  answer: string;
}

/** What a new entry needs. Both halves are required — the service refuses a blank. */
export interface NewProjectFaq {
  question: string;
  answer: string;
}

/**
 * A partial edit. Merge-patch semantics: an absent field is left alone.
 *
 * Not `Partial<NewProjectFaq>`, for the reason this module's header gives about
 * writing shapes out — a patch type derived from a creation type silently gains
 * every field the creation type gains, including ones the service will not
 * accept in a patch.
 */
export interface ProjectFaqPatch {
  question?: string;
  answer?: string;
}

/** §4.4's bounds. Refused by the service; shown to the creator before it is. */
export const FAQ_QUESTION_MAX_CHARACTERS = 200;
export const FAQ_ANSWER_MAX_CHARACTERS = 4000;

/**
 * §4.4's server-side cap on how many entries one campaign may publish.
 *
 * Restated so the editor can say "this campaign is at the limit" before a
 * creator types an entry the service will refuse. The service is still the
 * thing that enforces it.
 */
export const MAX_PROJECT_FAQS = 50;

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

/** Adds an entry to the end of the list. Refused past {@link MAX_PROJECT_FAQS}. */
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
