import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@ideanest/api-client';
import {
  readMine,
  readPlanCatalogue,
  type MySubscription,
  type Plan,
} from '@ideanest/plans/catalogue';
import { readFeeDisclosure, type FeeDisclosure } from '@ideanest/plans/fees';
import { api, sendJson } from '../../api/client';
import { queryKeys } from '../../api/queries';

/**
 * The pricing reads and writes — issue #164, the web's `lib/plans/api.ts` and `lib/fees/server.ts`.
 *
 * <h2>A 401 on the subscription is an answer</h2>
 *
 * `GET /v1/me/subscription` refuses a reader with no session, and on this page that is the ordinary
 * state of somebody deciding whether to bring a campaign here: `signed-out`, not an error. A reader
 * the app knows is signed out is not asked at all.
 *
 * <h2>A body that does not narrow is a failure</h2>
 *
 * Never an empty catalogue ("there are no plans on sale" is a statement about the platform) and never
 * "nothing held" (which would offer a plan to somebody who has one).
 */

/** A response the shared narrowing refused. */
export class UnreadablePricingResponse extends Error {
  constructor() {
    super('The pricing response could not be read');
    this.name = 'UnreadablePricingResponse';
  }
}

/** What the subscription read says: the holding, or a reader with no session. */
export type SubscriptionAnswer =
  | { readonly state: 'signed-out' }
  | { readonly state: 'read'; readonly subscription: MySubscription['subscription'] };

/** An hour fresh, as the web caches the catalogue and the fee terms. */
const PUBLIC_STALE_MS = 60 * 60 * 1000;

export function usePlanCatalogue() {
  return useQuery({
    queryKey: queryKeys.plans(),
    staleTime: PUBLIC_STALE_MS,
    retry: false,
    queryFn: async ({ signal }): Promise<readonly Plan[]> => {
      const plans = readPlanCatalogue(await api().get('/v1/plans', { signal }));
      if (plans === null) throw new UnreadablePricingResponse();
      return plans;
    },
  });
}

/**
 * The platform's fee terms. Not retried: the disclosure's own failure sentence offers the retry, and
 * it never says "nothing is deducted" for a read that failed (#145).
 */
export function usePlatformFeeDisclosure() {
  return useQuery({
    queryKey: queryKeys.platformFeeDisclosure(),
    staleTime: PUBLIC_STALE_MS,
    retry: false,
    queryFn: async ({ signal }): Promise<FeeDisclosure> => {
      const disclosure = readFeeDisclosure(await api().get('/v1/fees/disclosure', { signal }));
      if (disclosure === null) throw new UnreadablePricingResponse();
      return disclosure;
    },
  });
}

export function useMySubscription(signedIn: boolean) {
  return useQuery({
    queryKey: [...queryKeys.mySubscription(), signedIn] as const,
    retry: false,
    queryFn: async ({ signal }): Promise<SubscriptionAnswer> => {
      if (!signedIn) return { state: 'signed-out' };
      let body: unknown;
      try {
        body = await api().get('/v1/me/subscription', { signal });
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) return { state: 'signed-out' };
        throw cause;
      }
      return { state: 'read', subscription: mineOf(body).subscription };
    },
  });
}

function mineOf(body: unknown): MySubscription {
  const mine = readMine(body);
  if (mine === null) throw new UnreadablePricingResponse();
  return mine;
}

/**
 * Buys a plan. What comes back is not necessarily an entitlement: a priced plan arrives
 * `PENDING_PAYMENT` with `entitled: false`, and the page renders what it is given.
 */
export async function chooseSubscription(planId: string): Promise<MySubscription> {
  return mineOf(await sendJson('POST', '/v1/me/subscription', { planId }));
}

/** Cancels at the end of the period: the response carries the date the entitlement stops. */
export async function cancelSubscription(): Promise<MySubscription> {
  return mineOf(await sendJson('DELETE', '/v1/me/subscription'));
}
