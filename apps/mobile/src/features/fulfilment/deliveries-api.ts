import { useQuery } from '@tanstack/react-query';
import type { BackerFulfilment } from '@ideanest/account/fulfilment';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';

/**
 * One row of `GET /v1/me/fulfilments` as it arrives. Written out here because the generated
 * schema names the row `Item`, which collides with the saved list's row and types it as that
 * (`BackerFulfilmentResponse.fulfilments: Item[]`). Absent rather than null: the service
 * serialises with `non_null`.
 */
interface FulfilmentRow {
  readonly projectId?: string;
  readonly projectTitle?: string;
  readonly projectSlug?: string;
  readonly creatorSlug?: string;
  readonly fulfilment?: {
    readonly pledgeId?: string;
    readonly status?: string;
    readonly carrier?: string;
    readonly trackingNumber?: string;
    readonly trackingUrl?: string;
    readonly shippedAt?: string;
    readonly deliveredAt?: string;
    readonly updatedAt?: string;
  };
}

export function deliveryFrom(row: FulfilmentRow): BackerFulfilment {
  const parcel = row.fulfilment ?? {};
  return {
    projectId: row.projectId ?? '',
    projectTitle: row.projectTitle ?? null,
    projectSlug: row.projectSlug ?? null,
    creatorSlug: row.creatorSlug ?? null,
    fulfilment: {
      pledgeId: parcel.pledgeId ?? '',
      status: parcel.status ?? 'PREPARING',
      carrier: parcel.carrier ?? null,
      trackingNumber: parcel.trackingNumber ?? null,
      trackingUrl: parcel.trackingUrl ?? null,
      shippedAt: parcel.shippedAt ?? null,
      deliveredAt: parcel.deliveredAt ?? null,
      updatedAt: parcel.updatedAt ?? null,
    },
  };
}

/** Every parcel owed to this account — `GET /v1/me/fulfilments`. The service does not page it. */
export async function listMyDeliveries(signal?: AbortSignal): Promise<readonly BackerFulfilment[]> {
  const body = (await api().get('/v1/me/fulfilments', signal === undefined ? {} : { signal })) as unknown as {
    readonly fulfilments?: readonly FulfilmentRow[];
  };
  return (body.fulfilments ?? []).map(deliveryFrom);
}

/** The list, persisted under `fulfilments` (`lib/offline.ts`). */
export function useDeliveries(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.fulfilments(),
    enabled,
    queryFn: ({ signal }) => listMyDeliveries(signal),
  });
}
