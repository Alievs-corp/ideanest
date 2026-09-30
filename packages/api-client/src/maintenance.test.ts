import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError, errorFrom } from './problem';
import {
  MAINTENANCE_PROBLEM_TYPE,
  MAX_RETRY_AFTER_SECONDS,
  MIN_RETRY_AFTER_SECONDS,
  UNKNOWN_END_RETRY_AFTER_SECONDS,
  contractRetryAfterSeconds,
  isMaintenanceProblem,
  maintenanceFromResponse,
  maintenanceOf,
} from './maintenance';

/** The maintenance contract, read — issue #214. See `maintenance.ts`. */

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

const JAVA = '../../../apps/api/src/main/java/az/ideanest/shared/maintenance/';

const NOW = Date.parse('2026-10-04T22:10:00Z');

const API_BODY = {
  type: MAINTENANCE_PROBLEM_TYPE,
  title: 'Scheduled maintenance',
  status: 503,
  startsAt: '2026-10-04T22:00:00Z',
  endsAt: '2026-10-04T22:30:00Z',
  source: 'api',
};

/** Exactly what `ops/edge` serves when the service is not running. */
const EDGE_BODY = JSON.parse(source('../../../ops/edge/html/problem.json')) as Record<string, unknown>;

function problemResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 503,
    headers: { 'content-type': 'application/problem+json', ...init.headers },
  });
}

describe('the contract this reads', () => {
  it('is the one MaintenanceProblem.java and ActiveMaintenance.java write', () => {
    const problem = source(`${JAVA}MaintenanceProblem.java`);
    expect(problem).toContain(`TYPE = "${MAINTENANCE_PROBLEM_TYPE}"`);

    const active = source(`${JAVA}ActiveMaintenance.java`);
    expect(active).toContain(`MIN_RETRY_AFTER_SECONDS = ${MIN_RETRY_AFTER_SECONDS};`);
    expect(active).toContain(`MAX_RETRY_AFTER_SECONDS = ${MAX_RETRY_AFTER_SECONDS};`);
    expect(active).toContain(`UNKNOWN_END_RETRY_AFTER_SECONDS = ${UNKNOWN_END_RETRY_AFTER_SECONDS};`);
  });

  it('is the one the edge serves', () => {
    expect(EDGE_BODY.type).toBe(MAINTENANCE_PROBLEM_TYPE);
    expect(EDGE_BODY.source).toBe('edge');
  });
});

describe('isMaintenanceProblem', () => {
  it('is true for the maintenance type on a 503, from either producer', () => {
    expect(isMaintenanceProblem(new ApiError(503, API_BODY))).toBe(true);
    expect(isMaintenanceProblem(new ApiError(503, EDGE_BODY))).toBe(true);
    expect(isMaintenanceProblem(API_BODY)).toBe(true);
    // Duck-typed: another bundle's copy of ApiError is still an ApiError.
    expect(isMaintenanceProblem({ status: 503, problem: API_BODY })).toBe(true);
  });

  it('is false for a plain 503 — an outage is not maintenance', () => {
    expect(isMaintenanceProblem(new ApiError(503))).toBe(false);
    expect(isMaintenanceProblem(new ApiError(503, { status: 503, title: 'Service Unavailable' }))).toBe(false);
    expect(
      isMaintenanceProblem(
        new ApiError(503, { type: 'https://ideanest.az/problems/dependency-unavailable', status: 503 }),
      ),
    ).toBe(false);
  });

  it('is false for the type on any other status, and for anything that is not a problem', () => {
    expect(isMaintenanceProblem(new ApiError(502, API_BODY))).toBe(false);
    expect(isMaintenanceProblem({ ...API_BODY, status: 500 })).toBe(false);
    expect(isMaintenanceProblem(new Error('offline'))).toBe(false);
    expect(isMaintenanceProblem(null)).toBe(false);
    expect(isMaintenanceProblem(undefined)).toBe(false);
    expect(isMaintenanceProblem(MAINTENANCE_PROBLEM_TYPE)).toBe(false);
  });
});

describe('maintenanceOf', () => {
  it('reads a window from the service', () => {
    expect(maintenanceOf(new ApiError(503, API_BODY), NOW)).toEqual({
      startsAt: '2026-10-04T22:00:00Z',
      endsAt: '2026-10-04T22:30:00Z',
      source: 'api',
      retryAfterSeconds: 20 * 60,
    });
  });

  it('reads the edge, which knows neither instant', () => {
    expect(maintenanceOf(new ApiError(503, EDGE_BODY), NOW)).toEqual({
      startsAt: null,
      endsAt: null,
      source: 'edge',
      retryAfterSeconds: UNKNOWN_END_RETRY_AFTER_SECONDS,
    });
  });

  it('prefers the Retry-After errorFrom copied onto the problem', async () => {
    const error = await errorFrom(problemResponse(API_BODY, { headers: { 'Retry-After': '45' } }));
    expect(maintenanceOf(error, NOW)?.retryAfterSeconds).toBe(45);
  });

  it('treats a garbled instant as absent and an unknown source as the edge', () => {
    const odd = { ...API_BODY, endsAt: 'soon', startsAt: 42, source: 'moon' };
    expect(maintenanceOf(odd, NOW)).toEqual({
      startsAt: null,
      endsAt: null,
      source: 'edge',
      retryAfterSeconds: UNKNOWN_END_RETRY_AFTER_SECONDS,
    });
  });

  it('is null for anything that is not the maintenance problem', () => {
    expect(maintenanceOf(new ApiError(503), NOW)).toBeNull();
    expect(maintenanceOf(new ApiError(500, API_BODY), NOW)).toBeNull();
  });
});

describe('maintenanceFromResponse', () => {
  it('reads the body from a clone, so the response is handed on unread', async () => {
    const response = problemResponse(API_BODY, { headers: { 'Retry-After': '1200' } });
    const found = await maintenanceFromResponse(response, NOW);

    expect(found).toEqual({
      startsAt: '2026-10-04T22:00:00Z',
      endsAt: '2026-10-04T22:30:00Z',
      source: 'api',
      retryAfterSeconds: 1200,
    });
    expect(response.bodyUsed).toBe(false);
    expect(((await response.json()) as { type: string }).type).toBe(MAINTENANCE_PROBLEM_TYPE);
  });

  it('believes the header over the endsAt arithmetic', async () => {
    const response = problemResponse(EDGE_BODY, { headers: { 'Retry-After': '120' } });
    expect((await maintenanceFromResponse(response, NOW))?.retryAfterSeconds).toBe(120);
  });

  it('derives the wait from endsAt when the header is missing or is a date', async () => {
    expect((await maintenanceFromResponse(problemResponse(API_BODY), NOW))?.retryAfterSeconds).toBe(1200);
    const dated = problemResponse(API_BODY, { headers: { 'Retry-After': 'Sun, 04 Oct 2026 22:30:00 GMT' } });
    expect((await maintenanceFromResponse(dated, NOW))?.retryAfterSeconds).toBe(1200);
  });

  it('is null for a plain 503, a non-JSON 503, a broken body and every other status', async () => {
    const plain = new Response('Service Unavailable', { status: 503, headers: { 'content-type': 'text/plain' } });
    expect(await maintenanceFromResponse(plain, NOW)).toBeNull();
    expect(await maintenanceFromResponse(problemResponse({ status: 503, title: 'Busy' }), NOW)).toBeNull();
    const broken = new Response('{"type":', {
      status: 503,
      headers: { 'content-type': 'application/problem+json' },
    });
    expect(await maintenanceFromResponse(broken, NOW)).toBeNull();
    expect(await maintenanceFromResponse(problemResponse(API_BODY, { status: 500 }), NOW)).toBeNull();
    expect(await maintenanceFromResponse(new Response('{}', { status: 200 }), NOW)).toBeNull();
  });
});

describe('contractRetryAfterSeconds', () => {
  it('is the seconds to the end, rounded up and clamped to 30 s – 1 h', () => {
    expect(contractRetryAfterSeconds('2026-10-04T22:30:00Z', NOW)).toBe(1200);
    expect(contractRetryAfterSeconds('2026-10-04T22:11:00.400Z', NOW)).toBe(61);
    expect(contractRetryAfterSeconds('2026-10-04T22:10:05Z', NOW)).toBe(MIN_RETRY_AFTER_SECONDS);
    expect(contractRetryAfterSeconds('2026-10-04T21:00:00Z', NOW)).toBe(MIN_RETRY_AFTER_SECONDS);
    expect(contractRetryAfterSeconds('2026-10-06T00:00:00Z', NOW)).toBe(MAX_RETRY_AFTER_SECONDS);
  });

  it('is 300 with no announced end', () => {
    expect(contractRetryAfterSeconds(null, NOW)).toBe(UNKNOWN_END_RETRY_AFTER_SECONDS);
  });
});
