// The edge maintenance responder behind a real Traefik -- issue #214, section 2.
//
//   node ops/edge/test/live.test.mjs
//
// Needs Docker with Compose v2. Brings up ops/edge/test/compose.yaml (Traefik with
// the shipped dynamic configuration, the edge container, and stand-ins for the API
// and the web labelled the way Coolify labels them), then:
//
//   - with both up, checks the edge stays out of the way, including for the API's
//     own maintenance 503 and for ordinary 502/503 errors;
//   - checks a 504 from an upstream becomes the edge's answer, with status 503;
//   - stops the API and checks every request to its host gets the problem document;
//   - stops the web and checks its host gets the HTML page, and /v1/ on it JSON.
//
// Everything is torn down afterwards, pass or fail.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { EDGE_PROBLEM, assertEdgePage, assertEdgeProblem } from './contract.mjs';

const composeFile = join(dirname(fileURLToPath(import.meta.url)), 'compose.yaml');
const PORT = 18443;
const API = 'api.ideyanest.com';
const WEB = 'ideyanest.com';

function compose(...args) {
  return execFileSync('docker', ['compose', '-f', composeFile, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** One HTTPS request to the local Traefik, as if to `host`. Never throws on a status. */
function fetchAs(host, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        servername: host,
        rejectUnauthorized: false, // Traefik's default self-signed certificate
        method,
        path,
        headers: {
          host,
          ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`${method} ${host}${path} timed out`)));
    if (body) req.write(body);
    req.end();
  });
}

/** Polls until `ready(response)` holds, because Traefik applies Docker events asynchronously. */
async function waitFor(host, path, ready, what) {
  let last;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      last = await fetchAs(host, path);
      if (ready(last)) return last;
    } catch (error) {
      last = error;
    }
    await sleep(500);
  }
  assert.fail(`${what} did not happen within 30 s; last: ${last?.status ?? last} ${last?.body?.slice?.(0, 200) ?? ''}`);
}

before(async () => {
  compose('down', '-v', '--remove-orphans');
  compose('up', '-d', '--build', '--wait');
  await waitFor(API, '/v1/status', (r) => r.status === 200, 'the API router');
  await waitFor(WEB, '/', (r) => r.status === 200, 'the web router');
});

after(() => {
  if (process.exitCode) {
    try {
      process.stderr.write(compose('logs', '--no-color', 'proxy'));
    } catch {
      // The logs are a courtesy; the failure has already been reported.
    }
  }
  compose('down', '-v', '--remove-orphans');
});

test('with the API up, its responses pass through untouched', async () => {
  const ok = await fetchAs(API, '/v1/status');
  assert.equal(ok.status, 200);
  assert.equal(ok.body, 'upstream\n');
});

test("the API's own maintenance 503 is not overwritten by the edge's", async () => {
  const res = await fetchAs(API, '/v1/__test/api-maintenance');
  assert.equal(res.status, 503);
  assert.equal(res.headers['retry-after'], '600');
  const body = JSON.parse(res.body);
  assert.equal(body.source, 'api');
  assert.equal(body.endsAt, '2026-10-04T22:30:00Z');
});

test('an ordinary 503 or 502 from the API stays an ordinary error', async () => {
  for (const code of [503, 502]) {
    const res = await fetchAs(API, `/v1/__test/${code}`);
    assert.equal(res.status, code);
    assert.notEqual(JSON.parse(res.body).type, EDGE_PROBLEM.type, `${code} must not become maintenance`);
  }
});

test('a 504 at the proxy becomes the edge answer, with status 503', async () => {
  assertEdgeProblem(await fetchAs(API, '/v1/__test/504'), 'API 504');
  assertEdgePage(await fetchAs(WEB, '/__test/504'), 'web 504');
});

test('with the API stopped, every request to its host gets the problem document', async () => {
  compose('stop', 'api');
  await waitFor(API, '/v1/status', (r) => r.status === 503, 'the API fallback');
  assertEdgeProblem(await fetchAs(API, '/v1/status'), 'GET /v1/status');
  assertEdgeProblem(await fetchAs(API, '/v1/projects?page=2'), 'GET /v1/projects');
  assertEdgeProblem(await fetchAs(API, '/'), 'GET /');
  assertEdgeProblem(
    await fetchAs(API, '/v1/auth/login', { method: 'POST', body: '{"email":"a@example.com"}' }),
    'POST /v1/auth/login',
  );
  const head = await fetchAs(API, '/v1/status', { method: 'HEAD' });
  assert.equal(head.status, 503, 'HEAD status');
  assert.equal(head.headers['retry-after'], '120', 'HEAD retry-after');
  // The web is still up and still answers for itself.
  assert.equal((await fetchAs(WEB, '/')).status, 200);
});

test('with the web stopped, its hosts get the page, and /v1/ on them the problem document', async () => {
  compose('stop', 'web');
  await waitFor(WEB, '/', (r) => r.status === 503, 'the web fallback');
  assertEdgePage(await fetchAs(WEB, '/'), 'GET /');
  assertEdgePage(await fetchAs(WEB, '/az/projects/some-campaign'), 'GET a page');
  assertEdgePage(await fetchAs('www.ideyanest.com', '/en'), 'GET www');
  assertEdgeProblem(await fetchAs(WEB, '/v1/categories'), 'GET /v1/ on the web host');
});

test('the fallback answers only for the platform hosts', async () => {
  const res = await fetchAs('unrelated.example.com', '/');
  assert.equal(res.status, 404);
});
