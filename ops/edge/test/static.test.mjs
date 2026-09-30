// Checks the edge maintenance files against the contract without running anything.
// Issue #214, section 2. No dependencies beyond Node itself:
//
//   node ops/edge/test/static.test.mjs
//
// live.test.mjs is the other half: it runs the container behind Traefik and
// checks what actually comes back.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EDGE_PROBLEM, EDGE_RETRY_AFTER, MAINTENANCE_TYPE } from './contract.mjs';

const edge = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(edge, '..', '..');
// A Windows checkout has CRLF line endings (.gitattributes, text=auto).
const read = (path) => readFileSync(join(edge, path), 'utf8').replace(/\r\n/g, '\n');

test('the problem document is the contract, exactly', () => {
  assert.deepEqual(JSON.parse(read('html/problem.json')), EDGE_PROBLEM);
});

test('the problem type uses the same scheme as every problem type the API declares', () => {
  const prefix = MAINTENANCE_TYPE.slice(0, MAINTENANCE_TYPE.lastIndexOf('/') + 1);
  const declared = new Set();
  for (const file of javaSources(join(repo, 'apps', 'api', 'src', 'main'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/"(https?:\/\/[^"]*\/problems\/)([a-z0-9-]*)"/g)) {
      declared.add(match[1]);
      // Once the API declares the maintenance type itself (issue #214 step 1),
      // it must be this one, character for character.
      if (match[2] === 'maintenance') assert.equal(match[1] + match[2], MAINTENANCE_TYPE, file);
    }
  }
  assert.ok(declared.size > 0, 'found no problem types in apps/api to compare with');
  assert.deepEqual([...declared], [prefix], 'the API uses a different problem-type scheme');
});

test('every response carries Retry-After 120 and no-store, including on a 503', () => {
  const headers = read('edge-headers.conf');
  assert.match(headers, new RegExp(`^add_header Retry-After ${EDGE_RETRY_AFTER} always;$`, 'm'));
  assert.match(headers, /^add_header Cache-Control no-store always;$/m);
});

test('nginx serves the problem document as application/problem+json and the page as HTML', () => {
  // A location block ends at its own indentation; `types { }` inside it does not end it.
  const conf = read('nginx.conf');
  const problemLocations = [...conf.matchAll(/location = \/__edge\/problem\.json \{([\s\S]*?)\n {8}\}/g)];
  assert.equal(problemLocations.length, 2, 'one problem location per server block');
  for (const [, body] of problemLocations) {
    assert.match(body, /default_type application\/problem\+json;/);
    assert.match(body, /include \/etc\/nginx\/edge-headers\.conf;/);
  }
  const page = conf.match(/location = \/__edge\/maintenance\.html \{([\s\S]*?)\n {8}\}/);
  assert.ok(page, 'the page location exists');
  assert.match(page[1], /default_type text\/html;/);
  assert.match(page[1], /charset utf-8;/);
  assert.match(page[1], /include \/etc\/nginx\/edge-headers\.conf;/);
  assert.match(conf, /listen 8080 default_server;/);
  assert.match(conf, /listen 8081 default_server;/);
});

test('the Traefik file points each service at the port that answers for it', () => {
  const traefik = read('traefik/edge-maintenance.yaml');
  assert.match(traefik, /edge-api:\s*\n\s*loadBalancer:\s*\n\s*servers:\s*\n\s*- url: http:\/\/ideanest-edge:8080\n/);
  assert.match(traefik, /edge-web:\s*\n\s*loadBalancer:\s*\n\s*servers:\s*\n\s*- url: http:\/\/ideanest-edge:8081\n/);
});

test('the errors middlewares never take a 502 or 503 the application produced itself', () => {
  const traefik = read('traefik/edge-maintenance.yaml');
  const lists = [...traefik.matchAll(/^\s+status:\s*\n((?:\s+- .*\n)+)/gm)];
  assert.equal(lists.length, 2, 'one status list per middleware');
  for (const [, items] of lists) {
    const codes = items.trim().split('\n').map((line) => line.replace(/^\s*-\s*/, '').replace(/['"]/g, ''));
    assert.deepEqual(codes, ['504']);
  }
});

test('the page is self-contained, neutral, and refreshes as often as Retry-After says', () => {
  const html = read('html/maintenance.html');
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(markup, /<script/i, 'no scripts');
  assert.doesNotMatch(markup, /\s(src|href)\s*=/i, 'no linked resources');
  assert.doesNotMatch(markup, /url\(|@import/i, 'no external styles');
  assert.doesNotMatch(markup, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, 'no colour literals');
  assert.match(markup, new RegExp(`<meta http-equiv="refresh" content="${EDGE_RETRY_AFTER}" />`));
  for (const lang of ['az', 'en', 'ru', 'tr']) {
    assert.match(markup, new RegExp(`<section lang="${lang}">`), `a ${lang} section`);
  }
  // The edge cannot tell a deploy from a crash, so it must not claim either.
  const english = markup.match(/<section lang="en">([\s\S]*?)<\/section>/)[1];
  assert.doesNotMatch(english, /planned|scheduled|maintenance/i);
});

function* javaSources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* javaSources(path);
    else if (name.endsWith('.java')) yield path;
  }
}
