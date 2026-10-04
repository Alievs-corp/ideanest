import type { ReactElement } from 'react';
import type { CampaignTabId } from '@ideanest/campaign/tabs';
import type { CampaignPage } from '../../../lib/campaign-page';

/**
 * How a tab of the campaign page fills the page's one list — #155.
 *
 * <h2>Why a tab is a hook and not a component</h2>
 *
 * The page is a single virtualised list: blocks 1–10 are its header, the tab bar is its sticky
 * first row, the active tab's content is its body and the rewards and the report link are its
 * footer. Updates and Comments page — `onEndReached` appends the next page into that same list —
 * so a tab cannot be a component that renders its own `ScrollView` inside the page's; it has to
 * hand the page *rows*. Each tab is therefore a hook the screen calls on every render:
 *
 * ```ts
 * const body: CampaignTabBody = useUpdatesTab(context);
 * ```
 *
 * <h2>The rules every tab keeps</h2>
 *
 * - **All five hooks are called on every render** (the rules of hooks), with `active` true for
 *   the one on screen. A tab reads nothing while it is inactive — `enabled: context.active` on
 *   each query — so the Creator tab's profile is requested only once the Creator tab opens
 *   (#155's "tab data loads lazily"). An inactive tab returns `INACTIVE_TAB` or any body; the
 *   screen draws only the active one.
 * - **Every hook a tab calls, it calls on every render, before any early return.** The screen
 *   calls all five tab hooks on every render and switches which one is `active`; a hook behind
 *   `if (!context.active) return INACTIVE_TAB` would run on some renders and not others, and React
 *   throws ("Rendered more hooks than during the previous render") on the first tab switch. Call
 *   the queries with `enabled: context.active`, then return `INACTIVE_TAB` when inactive.
 *   (`campaign-tab.tsx` and `comments-tab.tsx` are examples. `campaign-screen.test.tsx` cycles
 *   through all five tabs and back.)
 * - **Its reads and writes live in its own file**, or in a module beside it. The query keys are
 *   already in `api/queries.ts`'s `queryKeys` (`projectFaqs`, `projectUpdates`, `comments`,
 *   `profile`, `profileProjects`), so a tab does not need to change that file; `api/client.ts`'s
 *   `sendJson` is the JSON write.
 * - **Rows are keyed within the tab**; the screen prefixes the tab's id, so two tabs may both
 *   have a row called `empty`.
 * - **Layout**: the screen gives every row the page's side gutter and draws it inside the white
 *   content sheet (`SurfaceProvider surface="white"`), so a row reads its tones from
 *   `useSurface()` rather than naming dark ones; the space *above* a row is the row's own (the
 *   Campaign tab puts 32 between its blocks, the web's `gap-8`; a list of cards may put less
 *   between them).
 * - **No entry animation** on any row — only the page's first screenful, its header, rises; rows
 *   arrive with a tab switch or a page and never animate in — and every word from the catalogue.
 * - **Offline**: a write is disabled and says why, as the header's Save and Remind do.
 */
export interface CampaignTabContext {
  readonly campaign: CampaignPage;
  /** This tab is the one on screen. Read nothing while it is false. */
  readonly active: boolean;
  /** The device has no connection: cached rows may be shown, writes are disabled. */
  readonly offline: boolean;
  /**
   * The route's search parameters as Expo Router gives them — `thread` for the Comments tab's
   * single-thread view (`CAMPAIGN_THREAD_PARAM`). `tab` is the screen's and is already applied.
   */
  readonly params: Readonly<Record<string, string | undefined>>;
  /**
   * Sets one search parameter on the route (`router.setParams`, so a link and state restoration
   * see it), or removes it with `null`. Not for `tab`, which the tab bar owns.
   */
  readonly setParam: (name: string, value: string | null) => void;
  /**
   * Scrolls the page so the tab bar is at the top — what switching tabs does. For a tab whose
   * content is replaced in place (opening a single comment thread and leaving it again), so the
   * reader is not left half way down a page that is now a different length.
   */
  readonly scrollToTabs: () => void;
}

/** One row of the list's body. `render` is called by the list when the row is on screen. */
export interface CampaignTabRow {
  readonly key: string;
  readonly render: () => ReactElement;
}

export interface CampaignTabBody {
  /** The rows, in order, after the tab bar. Pages are appended here, never replaced. */
  readonly rows: readonly CampaignTabRow[];
  /**
   * Drawn after the last row and above the rewards: "Older updates" (the accessible path to the
   * next page), "There are no older updates.", or a next-page failure with a retry.
   */
  readonly footer: ReactElement | null;
  /**
   * Called to append the next page; `null` when nothing pages.
   *
   * <strong>"End" is the end of this tab's rows, not of the list.</strong> The rewards and the
   * report link below the body do not count: the screen calls this when the bottom of the viewport
   * comes within half a screen of the last row (plus `footer`), so the next page arrives below what
   * the reader is looking at, before they reach the rewards. It is called once per list height —
   * the page it asked for growing the list is what re-arms it — and again on a tab that is
   * switched to; it is not called while the tab's `rows` are still empty. Guard against a fetch
   * already in flight and against the last page (`hasNextPage`) all the same.
   */
  readonly onEndReached: (() => void) | null;
  /**
   * Pull to refresh: refetch this tab's first page. Called only on the active tab, alongside the
   * page's own reads; the spinner stays until every promise settles. Never rejects the page's
   * refresh — return a promise that settles either way.
   */
  readonly refresh: () => Promise<unknown>;
  /**
   * The first page is on its way and there is nothing to show yet. While this is true and `rows`
   * is empty, the screen draws one placeholder in the body, so a tab does not need its own.
   */
  readonly loading: boolean;
}

/** The hook every tab file exports, under its own name. */
export type CampaignTabHook = (context: CampaignTabContext) => CampaignTabBody;

/** What a tab may return while it is not the one on screen: nothing, cheaply. */
export const INACTIVE_TAB: CampaignTabBody = Object.freeze({
  rows: Object.freeze([]) as readonly CampaignTabRow[],
  footer: null,
  onEndReached: null,
  refresh: () => Promise.resolve(),
  loading: false,
});

export type { CampaignTabId };
