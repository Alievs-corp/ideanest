import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';

/**
 * §4.11's AD-16: queue depth, failed jobs, provider status — §18, issue #316.
 *
 * <h2>This is not monitoring, and the screen says so</h2>
 *
 * §18's observability work is a system that watches continuously and wakes somebody. This
 * is a page a member of staff opens when a creator says their update never arrived. Every
 * number on it is a count the service can already take, which is why it did not need #138 —
 * but nothing here alerts, and presenting a dashboard as though it were monitoring would be
 * worse than an honest gap, because the gap would then look filled.
 *
 * `monitored` comes from the service for exactly that reason: when #138 lands it becomes
 * true and the disclaimer disappears with no change here.
 */

/** Three levels. Worst-wins when they are rolled up, because an average of one broken queue is useless. */
export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export interface QueueHealth {
  name: string;
  waiting: number;
  /**
   * Rows that ran out of attempts.
   *
   * Never added into `waiting`: a deep queue is a platform under load and a dead row is a
   * platform that has given up, and one number would let a thousand-item backlog hide one
   * message that will never be sent.
   */
  dead: number;
  status: HealthStatus;
}

export interface JobHealth {
  name: string;
  /** `READY`, or `DEAD` once it has run out of attempts and will not restart itself. */
  state: string;
  lastRunAt?: string | null;
  nextAttemptAt?: string | null;
  /**
   * Zero when it is not due yet, and zero for a job that is not expected to run — dead, or
   * held. Seconds, so the column sorts as a number.
   */
  overdueBySeconds: number;
  attempts: number;
  lastError?: string | null;
  /**
   * Why a job that is not dead is deliberately not running: `MAINTENANCE` while a window holds
   * the jobs that send money or messages out, `UNSCHEDULED` for one with no trigger on this
   * deployment. Absent while it runs on its schedule. Either is healthy.
   */
  hold?: string | null;
  status: HealthStatus;
}

export interface ProviderHealth {
  /** What the screen groups by, as an identifier it words — `payments`. */
  kind: string;
  /** As the platform names it — `PAYRIFF`. The screen gives it its proper name. */
  provider: string;
  /** Not configured is not unhealthy. It is switched off, which is a different column. */
  configured: boolean;
  available: boolean;
  /** Why it is not available — `NOT_CONFIGURED`, `CIRCUIT_OPEN` — or absent while it is. */
  reason?: string | null;
  status: HealthStatus;
}

export interface PlatformHealth {
  /** When this was measured. A stale tab is not a healthy platform. */
  at: string;
  status: HealthStatus;
  /** False until #138. See the module comment. */
  monitored: boolean;
  queues: QueueHealth[];
  jobs: JobHealth[];
  providers: ProviderHealth[];
}

/** The whole screen, as of now. */
export async function readHealth(signal?: AbortSignal): Promise<PlatformHealth> {
  const response = await authorizedFetch('/v1/admin/health', { signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as PlatformHealth;
}

/** Worst first, then by name: the row that needs somebody is at the top. */
const SEVERITY: Readonly<Record<HealthStatus, number>> = { CRITICAL: 0, DEGRADED: 1, HEALTHY: 2 };

export function worstFirst<T extends { status: HealthStatus; name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (SEVERITY[a.status] ?? 3) - (SEVERITY[b.status] ?? 3) || a.name.localeCompare(b.name));
}

/** How late a job is, in the largest unit that keeps the number readable. */
export type Lateness = { readonly unit: 'minutes' | 'hours' | 'days'; readonly count: number };

export function latenessOf(seconds: number): Lateness {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}

/** Providers under their kind, in the order the service sent them. */
export function byKind(providers: readonly ProviderHealth[]): [string, ProviderHealth[]][] {
  const groups = new Map<string, ProviderHealth[]>();
  for (const provider of providers) {
    const group = groups.get(provider.kind) ?? [];
    group.push(provider);
    groups.set(provider.kind, group);
  }
  return [...groups.entries()];
}
