// The maintenance contract as the edge must answer it -- issue #214, "The contract"
// and section 2. Shared by static.test.mjs (the files) and live.test.mjs (the
// responses through Traefik), so both check against one statement of it.

import assert from 'node:assert/strict';

/** The problem type every maintenance response carries, from the API and the edge alike. */
export const MAINTENANCE_TYPE = 'https://ideanest.az/problems/maintenance';

/** The edge's body, exactly. It has no announced start or end, and says where it came from. */
export const EDGE_PROBLEM = Object.freeze({
  type: MAINTENANCE_TYPE,
  title: 'Scheduled maintenance',
  status: 503,
  startsAt: null,
  endsAt: null,
  source: 'edge',
});

/** The edge's Retry-After, in seconds. The API's is computed; the edge's is fixed. */
export const EDGE_RETRY_AFTER = 120;

/**
 * Asserts a response is the edge's maintenance problem document.
 * @param {{ status: number, headers: Record<string, string | string[] | undefined>, body: string }} response
 * @param {string} what  names the request in a failure message
 */
export function assertEdgeProblem(response, what) {
  assert.equal(response.status, 503, `${what}: status`);
  assertEdgeHeaders(response, what);
  assert.match(
    String(response.headers['content-type']),
    /^application\/problem\+json\b/,
    `${what}: content-type`,
  );
  let body;
  try {
    body = JSON.parse(response.body);
  } catch (error) {
    assert.fail(`${what}: body is not JSON (${error.message}): ${response.body.slice(0, 200)}`);
  }
  assert.deepEqual(body, EDGE_PROBLEM, `${what}: body`);
}

/**
 * Asserts a response is the edge's HTML maintenance page.
 * @param {{ status: number, headers: Record<string, string | string[] | undefined>, body: string }} response
 * @param {string} what
 */
export function assertEdgePage(response, what) {
  assert.equal(response.status, 503, `${what}: status`);
  assertEdgeHeaders(response, what);
  assert.match(
    String(response.headers['content-type']),
    /^text\/html;\s*charset=utf-8$/i,
    `${what}: content-type`,
  );
  assert.match(response.body, /IdeyaNest hazırda əlçatan deyil/, `${what}: Azerbaijani copy`);
  assert.match(response.body, /IdeyaNest is unavailable right now/, `${what}: English copy`);
}

function assertEdgeHeaders(response, what) {
  assert.equal(response.headers['retry-after'], String(EDGE_RETRY_AFTER), `${what}: retry-after`);
  assert.equal(response.headers['cache-control'], 'no-store', `${what}: cache-control`);
}
