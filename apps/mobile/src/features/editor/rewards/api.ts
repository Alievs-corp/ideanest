import { useQuery } from '@tanstack/react-query';
import type {
  Item,
  ItemPatch,
  NewItem,
  NewReward,
  Reward,
  RewardPatch,
  ShippingRate,
} from '@ideanest/campaign-editor/contract';
import { api, sendJson } from '../../../api/client';
import { queryKeys } from '../../../api/queries';

/**
 * The Rewards tab's requests — the app's half of the web's item and reward calls in
 * `lib/projects/api.ts` (#162). The bodies are `@ideanest/campaign-editor/contract`'s, shared with
 * the web; reads go through `api()`, writes through `sendJson` (the session's fetch, refusals as
 * the shared `ApiError`, so `problem.code` and `meta` reach the panel as they reach the web's).
 */

const id = (value: string) => encodeURIComponent(value);

/** `GET /v1/projects/{id}/items` — the campaign's items, in the service's order. */
export async function listItems(projectId: string, signal?: AbortSignal): Promise<readonly Item[]> {
  const body = await api().get('/v1/projects/{projectId}/items', {
    path: { projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  // The generated schema describes the same body loosely; the contract is the shared type.
  return body as unknown as readonly Item[];
}

/** `GET /v1/projects/{id}/rewards` — every tier, hidden and secret ones included, in order. */
export async function listRewards(projectId: string, signal?: AbortSignal): Promise<readonly Reward[]> {
  const body = await api().get('/v1/projects/{projectId}/rewards', {
    path: { projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  return body as unknown as readonly Reward[];
}

export async function createItem(projectId: string, input: NewItem): Promise<Item> {
  return (await sendJson('POST', `/v1/projects/${id(projectId)}/items`, input)) as Item;
}

/** Merge-patch semantics: only the keys present are written. Never called with an empty patch. */
export async function patchItem(itemId: string, patch: ItemPatch): Promise<Item> {
  return (await sendJson('PATCH', `/v1/items/${id(itemId)}`, patch)) as Item;
}

/** `204`. Refused with `ITEM_IN_USE` while a tier contains the item. */
export async function deleteItem(itemId: string): Promise<void> {
  await sendJson('DELETE', `/v1/items/${id(itemId)}`);
}

export async function createReward(projectId: string, input: NewReward): Promise<Reward> {
  return (await sendJson('POST', `/v1/projects/${id(projectId)}/rewards`, input)) as Reward;
}

export async function patchReward(rewardId: string, patch: RewardPatch): Promise<Reward> {
  return (await sendJson('PATCH', `/v1/rewards/${id(rewardId)}`, patch)) as Reward;
}

/** `204`. Refused with `REWARD_HAS_BACKERS` once somebody has chosen the tier. */
export async function deleteReward(rewardId: string): Promise<void> {
  await sendJson('DELETE', `/v1/rewards/${id(rewardId)}`);
}

/** The copy is the service's: a new id, appended at the end of the list. */
export async function duplicateReward(rewardId: string): Promise<Reward> {
  return (await sendJson('POST', `/v1/rewards/${id(rewardId)}/duplicate`)) as Reward;
}

/** Every tier id exactly once, in the new order; answered with the list in that order. */
export async function reorderRewards(projectId: string, rewardIds: readonly string[]): Promise<readonly Reward[]> {
  return (await sendJson('PATCH', `/v1/projects/${id(projectId)}/rewards/reorder`, { rewardIds })) as readonly Reward[];
}

/** Replaces the whole rate table; answered with the tier. Amounts are wire strings, never numbers. */
export async function replaceShippingRules(rewardId: string, rules: readonly ShippingRate[]): Promise<Reward> {
  return (await sendJson('PUT', `/v1/rewards/${id(rewardId)}/shipping-rules`, { rules })) as Reward;
}

/**
 * The two lists the tab draws, under `projectEditLists` (`lib/offline.ts`): persisted and private,
 * so offline the tab shows them as last loaded, read-only, and sign-out erases them. A tier is
 * unreadable without the items (its composition names them by id), so the panel waits for both.
 */
export function useEditorItems(projectId: string) {
  return useQuery({
    queryKey: queryKeys.editorItems(projectId),
    enabled: projectId !== '',
    queryFn: ({ signal }) => listItems(projectId, signal),
  });
}

export function useEditorRewards(projectId: string) {
  return useQuery({
    queryKey: queryKeys.editorRewards(projectId),
    enabled: projectId !== '',
    queryFn: ({ signal }) => listRewards(projectId, signal),
  });
}
