import type { Money } from '@ideanest/money';
import type { ProjectState } from '@ideanest/campaign/states';
import type { StoryDocument } from '@ideanest/campaign/story';

/**
 * The creator's half of the project contract, as both clients read it — issue #162.
 *
 * TYPES AND PURE NARROWING ONLY. How a request is sent is the part the two clients genuinely
 * do differently: the web goes through `authorizedFetch` and its refresh rotation, the app
 * through its own typed `api()`. So every fetch stays with its client (`apps/web/src/lib/
 * projects/api.ts` for the web), and what moved here is the vocabulary those requests carry,
 * which must not be written twice. CLAUDE.md §3: types shared between packages live in a
 * shared package, never duplicated.
 *
 * Shapes come from the epic contract §5 and docs/architecture.md §10.2. Nothing here invents
 * a field.
 *
 * Nullable fields are typed `?: T | null` throughout. The service serialises with
 * `default-property-inclusion: non_null`, so a null `subcategoryId` is ABSENT from the JSON
 * rather than present and null — but the contract's own example prints it as `null`, and a
 * client that treats the two differently breaks the first time that setting changes. Both
 * readings mean "not set".
 */

export type { Money };

/*
 * The nineteen states of docs/architecture.md §6.1 live in `@ideanest/campaign/states` since
 * #155, so the app's campaign screen reads the same vocabulary. Re-exported under the same name.
 */
export type { ProjectState };

/**
 * The story document, as `PATCH /v1/projects/{id}` carries it.
 *
 * The block union and its reader are `@ideanest/campaign/story`; the operations the editor
 * performs on it are `@ideanest/campaign-editor/story`. Re-exported here so that a client
 * reading a `ProjectEdit` does not have to know there are two modules.
 *
 * A response is narrowed with `readStoryDocument` rather than cast. The story may have been
 * written by a newer deployment of the editor, and casting would put a block this build does
 * not recognise into the editor's state — where the next autosave would send it back mangled.
 */
export type {
  StoryBlock,
  StoryDocument,
  StorySpan,
  StorySpans,
} from '@ideanest/campaign/story';

/* -------------------------------------------------------------------------
 * The project — contract §5 (#31)
 * ---------------------------------------------------------------------- */

/**
 * The cover image, as three plain fields plus the upload behind them.
 *
 * The width and height are here because §5.3 recommends a cover of at least 1024×576
 * (`./cover-image`), and the checklist (#37) cannot check what nothing records.
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
 * The campaign's video — issue #331, docs/architecture.md §13.2.
 *
 * RESPONSE ONLY, and every field is the server's measurement. A request names a video by
 * {@link ProjectPatch.videoMediaId} and nothing else: the duration, the frame size and the
 * poster are facts ffprobe established about the transcoded file, and a client that sent them
 * would be sending numbers to be disbelieved — the argument {@link CoverImage.mediaId} makes
 * about an uploaded cover.
 */
export interface CampaignVideo {
  mediaId: string;
  /** An H.264/AAC MP4 of at most 720p with its index at the front: a plain `<video>` plays it. */
  url: string;
  /** The still a player shows before it is pressed. */
  posterUrl: string;
  /** Of the transcoded frame, in pixels. */
  width: number;
  height: number;
  durationMs: number;
  /** The poster's §13.1 placeholder, as a data URL. */
  blurDataUrl?: string | null;
}

/**
 * A project as the editor sees it — the creator's projection, contract §5.
 *
 * This is the response of every mutation on a project, so one request both changes the
 * project and returns the truth about it. The editor therefore never has to guess what the
 * server did with what it sent.
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
  /** At most one, of at most sixty seconds. Absent or null for a campaign without one. */
  video?: CampaignVideo | null;
  latePledgeEnabled: boolean;
  /**
   * Field names the server will refuse to change, by name — `"goal"`, `"durationDays"`.
   *
   * Empty until the campaign launches; from `LIVE` onwards it lists `goal`, `durationDays`,
   * and `scheduledLaunchAt`, which §5.3 freezes. A client-side guess at the same rule is not
   * the plan: immutability after launch is a business rule and it is enforced where the money
   * is, so this list is read rather than derived and an editor that ignores it is answered
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
 * An absent key leaves the field alone; an explicit `null` clears it. That distinction is why
 * every optional field here is `T | null` rather than just `T`, and why the autosave path
 * builds patches by field rather than sending the whole form: sending the whole form would
 * overwrite the story with whatever the basics tab happened to be holding.
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
  /**
   * The upload to show as the campaign's video, or `null` to take it down.
   *
   * It must be a READY video uploaded by the caller; anything else is answered `400
   * PROJECT_FIELD_INVALID` with `meta.field` naming this key. The previous video's files are
   * deleted once the edit commits, so a replaced clip does not go on costing storage.
   */
  videoMediaId?: string | null;
  latePledgeEnabled?: boolean;
}

/* -------------------------------------------------------------------------
 * Submission — the completeness checklist (#37)
 *
 * The checklist is ADVICE. `POST /submit` re-checks the same rules with the same server-side
 * class, so a client that skipped this read, cached its answer, or is an older build gets the
 * same verdict — as a 409 rather than as a list.
 * ---------------------------------------------------------------------- */

/**
 * Which editor tab fixes a requirement — the route segment, not a label.
 *
 * `string` rather than a union of the three the service sends today, on purpose. A
 * requirement pointing at a section this build does not know about is a deployment ahead of
 * the client, and a union would make that a type error at the boundary and a silently wrong
 * link at runtime. `isChecklistSection` in `./checklist` narrows it, and an item that does not
 * narrow is rendered without a link rather than with one that goes nowhere.
 */
export type ChecklistSection = string;

/**
 * One requirement of docs/architecture.md §5.3, and how this campaign stands against it.
 *
 * `requirement` is the stable name to branch on — `COVER_IMAGE`, `RISKS`. `label` and
 * `detail` are prose and may be reworded at any time (§10.4), so nothing keys off them.
 * The service writes both in the language of the request's `Accept-Language`, so a client
 * renders them as they arrive and asks in the language its screen is drawn in.
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
 * `current` is the server's answer to "is this something to act on now, or is it what
 * happened last time" — a campaign resubmitted after a change request is in `SUBMITTED` while
 * the newest note is still the change request's. The client does not work that out by
 * comparing states; getting it wrong means shouting at somebody whose campaign is fine.
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
 * Blocking and advisory arrive as two arrays rather than one with a flag, because an
 * interface that renders a suggestion in the same red as a requirement teaches creators that
 * the checklist exaggerates — and the half they stop reading is the half that was true.
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

/* -------------------------------------------------------------------------
 * Taxonomy — `GET /v1/categories`
 *
 * The endpoint localises. Each taxon carries a `name` already resolved against the request's
 * `Accept-Language`, falling back to Azerbaijani (§21.1) when the requested one has no
 * translation.
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
 * `name` is optional and the slug is the fallback only so that a malformed response cannot
 * put `undefined` into a picker. The response also carries `nameAz` and `nameEn`, which are
 * the interim columns of V6 and are on their way out under expand-then-contract — this reader
 * deliberately does not read them, because the API cannot drop them until nothing does.
 */
export interface RawTaxon {
  id: string;
  slug: string;
  name?: string;
  subcategories?: readonly RawTaxon[];
}

function taxonName(raw: RawTaxon): string {
  return raw.name ?? raw.slug;
}

/** The category tree as the editor's pickers read it, out of the endpoint's body. */
export function categoriesFrom(raw: readonly RawTaxon[]): readonly Category[] {
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
 * ---------------------------------------------------------------------- */

/** One row of the history. Without the document; see {@link StoryVersionDetail}. */
export interface StoryVersionSummary {
  number: number;
  /** ISO 8601, UTC. */
  createdAt: string;
  authorId: string;
  /**
   * Characters of prose, counted as §5.3 counts them.
   *
   * The one number that makes a list of timestamps usable: "3 minutes ago, 1,240 characters"
   * tells a creator which version came before they deleted a section, and a timestamp alone
   * does not.
   */
  characters: number;
}

export interface StoryVersionDetail extends StoryVersionSummary {
  /**
   * Unnarrowed on purpose. Callers pass it through `readStoryDocument`, which refuses a
   * document written against a schema this build does not know rather than letting it into
   * the editor's state.
   */
  document: unknown;
}

/* -------------------------------------------------------------------------
 * Pre-launch — #39
 * ---------------------------------------------------------------------- */

/**
 * A campaign as its public pre-launch page shows it.
 *
 * DELIBERATELY NARROW, and the server draws the same line. There is no creator, no goal, no
 * story, and no category here: what is left is the promise a pre-launch page makes — read
 * from the same columns the campaign page will use, so the page somebody followed and the
 * campaign it becomes cannot disagree.
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
   * How many people have asked to be told. The one number that makes a pre-launch page work:
   * a campaign with no pledges yet has nothing else to show that anybody else cares about it.
   */
  followerCount: number;
}

/** The answer to "tell me when this opens". */
export interface RemindResult {
  /** Always true after a successful call. */
  following: boolean;
  followerCount: number;
}

/* -------------------------------------------------------------------------
 * Items — docs/architecture.md §10.2 (#32, #34)
 *
 * The atomic things a campaign produces. Items come BEFORE tiers, which is the order §4.6 puts
 * them in: a tier is a selection of items with quantities, so there is nothing to compose until
 * these exist.
 * ---------------------------------------------------------------------- */

/**
 * An item as the creator's editor sees it — `ItemResponse`.
 *
 * `imageUrl` is an address the client declared, not an upload.
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
 * Same rule as `ProjectPatch`: an absent key leaves the field alone, an explicit `null` clears
 * it. That is why every optional field is `T | null` rather than `T`.
 */
export interface ItemPatch {
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  weightGrams?: number | null;
  isDigital?: boolean;
  sku?: string | null;
}

/* -------------------------------------------------------------------------
 * Reward tiers — docs/architecture.md §10.2 (#32, #34)
 * ---------------------------------------------------------------------- */

/**
 * How a tier reaches the person who backed it — `ShippingType`.
 *
 * A property of the tier, not of the campaign: one campaign routinely offers a digital
 * thank-you, a poster shipped domestically, and a boxed set shipped anywhere, and each is a
 * different question at checkout.
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
 * BOTH AMOUNTS ARE STRINGS, for the reason every amount on this platform is (§10.3): they are
 * added to a pledge total and charged to a card. There is no currency on a rate — the whole
 * table is denominated in the campaign's, which the tier already carries.
 *
 * One type for the request and the response, matching the server's own single record: two
 * would drift the first time a field was added to one of them.
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
 * The response of every endpoint that touches a tier, so the editor applies the same update
 * whichever call it made. It is the CREATOR's projection and carries what no public response
 * may: the reservation counts and the secret token.
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
   * (docs/architecture.md §5.3): it withdraws a tier from sale without deleting it, which is
   * the only thing permitted once somebody has backed it. The editor presents that as hiding
   * rather than as a date — see `./rewards`.
   */
  availableUntil?: string | null;
  items: readonly RewardItemLine[];
  shippingRules: readonly ShippingRate[];
  /**
   * The optimistic-locking counter.
   *
   * No endpoint takes it yet, so nothing sends it. It is read because a concurrent write is
   * answered `409 REWARD_MODIFIED`, and knowing the version a refusal was about is what lets a
   * later `If-Match` be added without a second read.
   */
  version: number;
  /**
   * True once §5.3 has frozen this tier's price, which happens at launch.
   *
   * ON THE REWARD, NOT IN `ProjectEdit.lockedFields`. That array is filtered server-side to
   * the campaign's own patch keys — `goal`, `durationDays`, `scheduledLaunchAt` — so it can
   * never name a field of this body (#183).
   *
   * There is no counterpart for `limitQuantity` because §5.3 permits raising it at any time.
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
 * `items` replaces the WHOLE composition when present. There is no add-one-line patch, because
 * a composition is what a backer is promised and the client always holds all of it.
 *
 * The per-country rates are deliberately absent. They are replaced through
 * `PUT /v1/rewards/{id}/shipping-rules`, because a rate table is read as a whole by whatever
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

/* -------------------------------------------------------------------------
 * FAQ — docs/architecture.md §4.4 and §10.2 (#283)
 *
 * The bounds §4.4 refuses an entry against are `./faqs`, beside the rules that use them.
 * ---------------------------------------------------------------------- */

/**
 * One entry of the campaign's question and answer list.
 *
 * Three fields and no timestamps, because that is the whole of what the service publishes.
 * The order is not on the entry either: position is a property of the list rather than of the
 * row, exactly as it is for a reward tier.
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
 * Not `Partial<NewProjectFaq>`: a patch type derived from a creation type silently gains every
 * field the creation type gains, including ones the service will not accept in a patch.
 */
export interface ProjectFaqPatch {
  question?: string;
  answer?: string;
}
