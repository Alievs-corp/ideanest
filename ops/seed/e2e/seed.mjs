#!/usr/bin/env node
/**
 * Seeds a STAGING environment with what the mobile Maestro suite signs in as and
 * opens (issue #165, "End-to-end tests"). Idempotent: a second run finds everything the
 * first one made, prints the same identifiers, and changes only the two things that
 * expire on their own — the live campaign's deadline and the backer's draft pledge.
 *
 *   E2E_API_ORIGIN=https://staging-api.ideanest.az \
 *   E2E_DATABASE_URL=postgres://… \
 *   E2E_TOTP_SECRET=… E2E_BACKER_PASSWORD=… E2E_TWOFA_PASSWORD=… E2E_CREATOR_PASSWORD=… \
 *   node ops/seed/e2e/seed.mjs [--dry-run] [--env-file <path>]
 *
 * <h2>What it makes</h2>
 *
 * - **E2E Creator** (`E2E_CREATOR_EMAIL`) owns two campaigns: "E2E live campaign", LIVE,
 *   with two digital reward tiers and one digital add-on, and "E2E draft", a DRAFT with a
 *   title and nothing else. The same creator owns both, so "one draft campaign" means one
 *   campaign in DRAFT, not one campaign. Every tier is DIGITAL: nothing in the checkout
 *   asks for a shipping destination.
 * - **E2E Backer** (`E2E_BACKER_EMAIL`) holds one DRAFT pledge on the live campaign, on
 *   the first tier. The API expires a draft five minutes after it is made (the
 *   reservation TTL), so a re-run reuses the draft only while it is still a draft and
 *   otherwise makes a new one. The suite opens it with `?payment=failed`, which reads as
 *   failed whether it is still a draft or has expired; but while its hold is live the
 *   same backer cannot reserve again, so start the suite at least five minutes after
 *   this run (the checkout flow then releases the lapsed hold itself). A pledge the
 *   suite confirmed on an earlier run is cancelled first, through the API, because one
 *   backer holds one active pledge per campaign.
 * - **E2E Two Factor** (`E2E_TWOFA_EMAIL`) has two-factor on, with exactly the secret in
 *   `E2E_TOTP_SECRET` (base32, 20 bytes — `Totp.SECRET_BYTES`), so the suite can compute
 *   its codes. Its replay guard is reset at the end, so the suite's first code is
 *   accepted even inside the thirty seconds this run spent a code in.
 *
 * <h2>Inputs</h2>
 *
 * Required: `E2E_API_ORIGIN`, `E2E_DATABASE_URL` (not with `--dry-run`), `E2E_TOTP_SECRET`,
 * `E2E_BACKER_PASSWORD`, `E2E_TWOFA_PASSWORD`, `E2E_CREATOR_PASSWORD`. Optional, with
 * defaults: `E2E_BACKER_EMAIL` (e2e-backer@example.az), `E2E_TWOFA_EMAIL`
 * (e2e-2fa@example.az), `E2E_CREATOR_EMAIL` (e2e-creator@example.az), `E2E_PSQL` (the
 * psql binary, default `psql` on PATH).
 *
 * Output: `KEY=value` lines on stdout and nothing else, so the caller can source them;
 * `--env-file` writes the same lines to a file. Progress goes to stderr. No password and
 * no part of the TOTP secret is ever printed.
 *
 * <h2>It refuses production</h2>
 *
 * Before any network call or query: exit 2 when the API origin or the database host is
 * a production name — `ideyanest.com`, `ideanest.az`, or any subdomain of either that
 * does not start with `staging` — or the production server's address. Then, before its
 * first database write, it checks that the accounts the API just signed in exist in that
 * database under the same identifiers. An API and a database from two different
 * environments would otherwise have this script writing into the wrong one.
 *
 * <h2>Where it uses SQL, and why</h2>
 *
 * Everything goes through the public API except what the API cannot do unattended:
 *
 * 1. **Marking the three addresses verified.** Sign-in does not need it, but the Me tab
 *    shows an "unverified" warning that would sit on top of every screen the suite
 *    reads, and the only API path is the link in the verification email.
 * 2. **Setting the TOTP secret.** `POST /v1/auth/2fa/enable` always generates its own;
 *    the suite needs one it knows in advance. The secret is replaced while the enrolment
 *    is still unconfirmed, and `/2fa/confirm` is then called with a code computed from
 *    the new one — so the API itself proves the replacement is right.
 * 3. **Resetting `last_used_step`.** The replay guard refuses a second code from the same
 *    thirty seconds, and this run has just spent one.
 * 4. **Taking the campaign live.** Submission needs the creator agreement and a paid
 *    subscription, and approval needs a staff account; none of that belongs in a test
 *    seed. The campaign is built through the API as a DRAFT and then moved to LIVE with
 *    its three history rows (DRAFT → SUBMITTED → APPROVED → LIVE), each recorded as
 *    SYSTEM with a note naming this script, so nothing in the moderation trail claims
 *    a person decided it. No `project.launched` event is written: it would only notify
 *    followers the campaign does not have, and the web's public-page cache has a
 *    one-minute window of its own.
 * 5. **Re-extending the deadline.** The API's extension is once per campaign; the suite
 *    needs a campaign that is still live whenever it runs.
 *
 * Values reach psql as variables (`-v name=value`, read as `:'name'`), never spliced into
 * the SQL. The one exception is the TOTP secret, which is set with `\set` on stdin so it
 * stays out of the process list; it is hex by then and checked to be nothing else.
 *
 * <h2>Sign-in budget</h2>
 *
 * The API allows five sign-ins per address per fifteen minutes. A run signs in three
 * times — once per account — and the suite's own sign-ins come out of the same budget
 * when they leave from the same address.
 */
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** What the campaigns are found by on a re-run. Changing one orphans what the old one made. */
const LIVE_TITLE = 'E2E live campaign';
const DRAFT_TITLE = 'E2E draft';

const CURRENCY = 'AZN';

/** The first is TIER_TITLE. Matched by title on a re-run. */
const TIERS = [
  {
    title: 'E2E digital edition',
    description: 'The finished edition as a download. Nothing is posted, so no address is asked for.',
    price: '25.00',
    isAddon: false,
  },
  {
    title: 'E2E supporter edition',
    description: 'The digital edition and the supporters’ credits page, also as a download.',
    price: '60.00',
    isAddon: false,
  },
  {
    title: 'E2E wallpaper set',
    description: 'Six phone and desktop wallpapers from the campaign artwork.',
    price: '5.00',
    isAddon: true,
  },
];

const COVER = {
  url: 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=1600&h=1000&fit=crop&q=80',
  width: 1600,
  height: 1000,
};

/** `Totp.SECRET_BYTES`, `Totp.DIGITS`, `Totp.PERIOD`. */
const TOTP_SECRET_BYTES = 20;
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;

const DEVICE_LABEL = 'E2E seed (ops/seed/e2e)';
const SEED_NOTE = 'Set by ops/seed/e2e/seed.mjs for the end-to-end suite; nobody reviewed this campaign.';

/** Exit status for a refusal to touch the target, distinct from an ordinary failure. */
const REFUSED = 2;

const PRODUCTION_DOMAINS = ['ideyanest.com', 'ideanest.az'];
const PRODUCTION_ADDRESSES = ['46.224.142.29'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '10.0.2.2', 'host.docker.internal'];

class Refusal extends Error {}

// ---------------------------------------------------------------------------
// Target checks
// ---------------------------------------------------------------------------

/**
 * Whether a host is production. Exported for the checks in the pull request.
 *
 * Literal names only: staging may share the production server, so resolving a staging
 * name and refusing on the address would refuse the environment this exists for.
 */
export function isProductionHost(rawHost) {
  const host = String(rawHost).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (LOCAL_HOSTS.includes(host)) return false;
  if (PRODUCTION_ADDRESSES.includes(host)) return true;
  for (const domain of PRODUCTION_DOMAINS) {
    if (host === domain) return true;
    if (host.endsWith(`.${domain}`)) {
      const subdomain = host.slice(0, -(domain.length + 1));
      return !subdomain.startsWith('staging');
    }
  }
  return false;
}

/**
 * Every host a libpq connection string could connect to, or null when it cannot be read.
 *
 * Both forms libpq takes: a `postgres://` URI, whose query string may override the host,
 * and `key=value` pairs. A string that is neither is refused rather than guessed at.
 */
export function databaseHosts(connection) {
  const value = connection.trim();
  if (/^postgres(ql)?:\/\//i.test(value)) {
    // `new URL` cannot read a multi-host authority, so the hosts are cut out by hand.
    const authority = value.replace(/^postgres(ql)?:\/\//i, '').split(/[/?]/, 1)[0] ?? '';
    const hostPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
    const hosts = hostPart
      .split(',')
      .map((entry) => (entry.startsWith('[') ? entry.slice(1, entry.indexOf(']')) : entry.split(':')[0] ?? ''))
      .map((entry) => decodeURIComponent(entry));
    const query = value.includes('?') ? new URLSearchParams(value.slice(value.indexOf('?') + 1)) : null;
    for (const key of ['host', 'hostaddr']) {
      const override = query?.get(key);
      if (override) hosts.push(...override.split(','));
    }
    return hosts.filter((host) => host !== '');
  }
  if (/^\s*\w+\s*=/.test(value)) {
    const hosts = [];
    for (const match of value.matchAll(/(\w+)\s*=\s*('(?:[^'\\]|\\.)*'|\S+)/g)) {
      const [, key, raw] = match;
      if (key !== 'host' && key !== 'hostaddr') continue;
      const unquoted = raw.startsWith("'") ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw;
      hosts.push(...unquoted.split(','));
    }
    return hosts.filter((host) => host !== '');
  }
  return null;
}

/**
 * Runs before anything else is read or checked, so that a production target is refused
 * as such rather than for some other variable being missing.
 */
function requireNotProduction(apiOrigin, databaseUrl) {
  if (apiOrigin) {
    let api = null;
    try {
      api = new URL(apiOrigin);
    } catch {
      // Not a URL at all; readEnvironment says so.
    }
    if (api && isProductionHost(api.hostname)) {
      throw new Refusal(`E2E_API_ORIGIN is production (${api.hostname}). This seed runs against staging only.`);
    }
  }
  if (!databaseUrl) return;

  const hosts = databaseHosts(databaseUrl);
  if (hosts === null) {
    throw new Refusal('E2E_DATABASE_URL is neither a postgres:// URI nor key=value pairs, so its host cannot be checked.');
  }
  // No host at all is a Unix socket, which is this machine.
  const production = hosts.filter((host) => !host.startsWith('/') && isProductionHost(host));
  if (production.length > 0) {
    throw new Refusal(
      `E2E_DATABASE_URL points at production (${production.join(', ')}). This seed runs against staging only.`,
    );
  }
}

// ---------------------------------------------------------------------------
// TOTP, RFC 6238 — the same arithmetic as Totp.java
// ---------------------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, case and spaces ignored, padding optional. Null for anything else. */
export function decodeBase32(text) {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean === '' || /[^A-Z2-7]/.test(clean)) return null;
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    buffer = (buffer << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret, step, digits = TOTP_DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

function currentStep() {
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function log(message) {
  process.stderr.write(`  ${message}\n`);
}

function parseArguments(argv) {
  const options = { dryRun: false, envFile: null, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--env-file') {
      const path = argv[++index];
      if (!path) throw new Error('--env-file needs a path.');
      options.envFile = path;
    } else if (argument.startsWith('--env-file=')) options.envFile = argument.slice('--env-file='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function readEnvironment(dryRun) {
  const env = process.env;
  const required = ['E2E_API_ORIGIN', 'E2E_TOTP_SECRET', 'E2E_BACKER_PASSWORD', 'E2E_TWOFA_PASSWORD', 'E2E_CREATOR_PASSWORD'];
  if (!dryRun) required.push('E2E_DATABASE_URL');
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing ${missing.join(', ')}.`);

  let origin;
  try {
    origin = new URL(env.E2E_API_ORIGIN);
  } catch {
    throw new Error('E2E_API_ORIGIN is not a URL.');
  }
  if (origin.protocol !== 'https:' && !LOCAL_HOSTS.includes(origin.hostname.replace(/^\[|\]$/g, ''))) {
    throw new Error('E2E_API_ORIGIN must be https unless it is a local stack.');
  }

  const secret = decodeBase32(env.E2E_TOTP_SECRET);
  if (secret === null) throw new Error('E2E_TOTP_SECRET is not base32.');
  if (secret.length !== TOTP_SECRET_BYTES) {
    throw new Error(
      `E2E_TOTP_SECRET decodes to ${secret.length} bytes; the service stores exactly ${TOTP_SECRET_BYTES} ` +
        `(${Math.ceil((TOTP_SECRET_BYTES * 8) / 5)} base32 characters).`,
    );
  }

  const account = (prefix, defaultEmail, name) => ({
    email: (env[`${prefix}_EMAIL`] || defaultEmail).trim().toLowerCase(),
    password: env[`${prefix}_PASSWORD`] ?? '',
    name,
  });

  return {
    apiOrigin: origin.origin,
    databaseUrl: env.E2E_DATABASE_URL || undefined,
    psql: env.E2E_PSQL || 'psql',
    totpSecret: secret,
    backer: account('E2E_BACKER', 'e2e-backer@example.az', 'E2E Backer'),
    twoFactor: account('E2E_TWOFA', 'e2e-2fa@example.az', 'E2E Two Factor'),
    creator: account('E2E_CREATOR', 'e2e-creator@example.az', 'E2E Creator'),
  };
}

/** A failed request, described without anything that was sent in it. */
class ApiError extends Error {
  constructor(what, response) {
    const body = response.json ?? {};
    const code = body.code ? ` ${body.code}` : '';
    const detail = body.detail ?? body.title ?? '';
    const retry = response.status === 429 ? ` Retry after ${response.headers.get('retry-after') ?? '?'} s.` : '';
    super(`${what}: HTTP ${response.status}${code}${detail ? ` — ${detail}` : ''}.${retry}`);
    this.status = response.status;
    this.body = body;
  }
}

function createApi(origin) {
  return async function call(method, path, { token, body, headers = {} } = {}) {
    const response = await fetch(new URL(path, origin), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Never followed. A redirect could lead anywhere, including somewhere this
      // script was told not to go.
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, headers: response.headers };
  };
}

function ok(response, what) {
  if (response.status >= 200 && response.status < 300) return response.json;
  throw new ApiError(what, response);
}

/**
 * Runs one script through psql and returns what it printed, trimmed.
 *
 * `-t -A` leaves only the rows, so a script that ends in one `SELECT json_…` hands back
 * exactly one JSON value.
 */
function createSql(binary, databaseUrl) {
  return function run(script, variables = {}, { secretHex } = {}) {
    const args = [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A'];
    for (const [name, value] of Object.entries(variables)) args.push('-v', `${name}=${value}`);

    let input = script;
    if (secretHex !== undefined) {
      if (!/^[0-9a-f]+$/.test(secretHex)) throw new Error('The secret is not hex.');
      input = `\\set secret_hex '${secretHex}'\n${script}`;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', (error) => reject(new Error(`Could not run ${binary}: ${error.message}`)));
      child.on('close', (status) => {
        if (status === 0) resolve(stdout.trim());
        else reject(new Error(`psql exited ${status}: ${stderr.trim()}`));
      });
      child.stdin.end(input);
    });
  };
}

async function sqlJson(sql, script, variables) {
  const output = await sql(script, variables);
  return output === '' ? null : JSON.parse(output);
}

function shellValue(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@%+,=-]*$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

async function userByEmail(sql, email) {
  return sqlJson(
    sql,
    `SELECT json_build_object('id', id, 'deleted', deleted_at IS NOT NULL) FROM users WHERE email = :'email';`,
    { email },
  );
}

/** Registers the account if the database has never heard of it. Returns its row. */
async function ensureRegistered(api, sql, account) {
  const existing = await userByEmail(sql, account.email);
  if (existing?.deleted) throw new Error(`${account.email} belongs to a deleted account; choose another address.`);
  if (existing) return existing;

  log(`registering ${account.email}`);
  ok(
    await api('POST', '/v1/auth/register', {
      body: { email: account.email, password: account.password, name: account.name },
    }),
    `Registering ${account.email}`,
  );
  const created = await userByEmail(sql, account.email);
  if (!created) {
    throw new Refusal(
      `The API accepted ${account.email} but the database has no such account. ` +
        'E2E_API_ORIGIN and E2E_DATABASE_URL are not the same environment.',
    );
  }
  return created;
}

/** Tokens, or the challenge a second factor owes. */
async function signIn(api, account) {
  const response = await api('POST', '/v1/auth/login', {
    body: { email: account.email, password: account.password, deviceLabel: DEVICE_LABEL, tokenDelivery: 'body' },
  });
  const body = ok(response, `Signing in as ${account.email}`);
  if (body?.twoFactorRequired) return { challenge: body.challenge };
  requireNonProductionIssuer(body.accessToken);
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

/**
 * The host check reads names, and a local origin may be a tunnel to anywhere. The token's
 * issuer is the service's own `TOKEN_ISSUER`, production's is `https://api.ideyanest.com`.
 */
function requireNonProductionIssuer(accessToken) {
  let issuer = '';
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split('.')[1] ?? '', 'base64url').toString('utf8'));
    issuer = new URL(payload.iss).hostname;
  } catch {
    // A token without a readable issuer says nothing either way; the database check still runs.
    return;
  }
  if (isProductionHost(issuer)) {
    throw new Refusal(`The API issues tokens as ${issuer}, which is production. Nothing more is sent.`);
  }
}

async function me(api, token) {
  return ok(await api('GET', '/v1/me', { token }), 'Reading /v1/me');
}

/** Before the first write: the database knows these accounts by the ids the API gave. */
async function requireSameEnvironment(sql, accounts) {
  const ids = accounts.map((account) => account.id).join(',');
  const rows =
    (await sqlJson(
      sql,
      `SELECT coalesce(json_agg(json_build_object('id', id, 'email', email::text)), '[]'::json)
         FROM users WHERE id = ANY (string_to_array(:'ids', ',')::uuid[]);`,
      { ids },
    )) ?? [];
  for (const account of accounts) {
    const row = rows.find((candidate) => candidate.id === account.id);
    if (!row || row.email.toLowerCase() !== account.email) {
      throw new Refusal(
        `The API knows ${account.email} as ${account.id} and the database does not. ` +
          'E2E_API_ORIGIN and E2E_DATABASE_URL are not the same environment; nothing was written.',
      );
    }
  }
}

/** A signed-in account that is not expected to have a second factor. */
async function signInPlainly(api, sql, account) {
  await ensureRegistered(api, sql, account);
  const session = await signIn(api, account);
  if (session.challenge) throw new Error(`${account.email} has two-factor on; it is not meant to.`);
  const profile = await me(api, session.accessToken);
  return { ...account, ...session, id: profile.id, slug: profile.slug, displayName: profile.name };
}

/**
 * The two-factor account, signed in, with E2E_TOTP_SECRET as its secret.
 *
 * Two paths. Not yet enrolled: enable through the API, swap the secret it generated for
 * ours (SQL step 2), and confirm with a code from ours. Already enrolled: sign in with a
 * code from ours, and only if that is refused — the secret was rotated, or somebody
 * re-enrolled the account by hand — replace the secret and try the same challenge again.
 */
async function ensureTwoFactor(api, sql, account, secret, alreadyChecked) {
  const row = await ensureRegistered(api, sql, account);
  const secretHex = secret.toString('hex');
  const session = await signIn(api, account);

  if (!session.challenge) {
    const profile = await me(api, session.accessToken);
    await requireSameEnvironment(sql, [...alreadyChecked, { ...account, id: profile.id }]);

    log('enrolling two-factor');
    ok(
      await api('POST', '/v1/auth/2fa/enable', { token: session.accessToken, body: { password: account.password } }),
      'Starting two-factor enrolment',
    );
    // SQL step 2. Only an unconfirmed enrolment is touched, which is the one just started.
    const replaced = await sql(
      `UPDATE user_two_factor SET secret = decode(:'secret_hex', 'hex')
        WHERE user_id = :'user_id'::uuid AND confirmed_at IS NULL;
       SELECT count(*) FROM user_two_factor
        WHERE user_id = :'user_id'::uuid AND confirmed_at IS NULL AND secret = decode(:'secret_hex', 'hex');`,
      { user_id: profile.id },
      { secretHex },
    );
    if (replaced !== '1') throw new Error('The enrolment the API started was not there to replace.');
    // The API checking a code from our secret is the proof the replacement is right.
    ok(
      await api('POST', '/v1/auth/2fa/confirm', {
        token: session.accessToken,
        body: { code: totpCode(secret, currentStep()) },
      }),
      'Confirming two-factor with a code from E2E_TOTP_SECRET',
    );
    return { ...account, ...session, id: profile.id, displayName: profile.name };
  }

  const verify = () =>
    api('POST', '/v1/auth/2fa/verify', {
      body: { challenge: session.challenge, code: totpCode(secret, currentStep()), tokenDelivery: 'body' },
    });

  let response = await verify();
  if (response.status === 400 || response.status === 401) {
    log('the stored secret is not E2E_TOTP_SECRET; replacing it');
    await requireSameEnvironment(sql, alreadyChecked);
    // SQL steps 2 and 3, for an enrolment that is already confirmed.
    await sql(
      `UPDATE user_two_factor SET secret = decode(:'secret_hex', 'hex'), last_used_step = NULL
        WHERE user_id = :'user_id'::uuid AND confirmed_at IS NOT NULL;`,
      { user_id: row.id },
      { secretHex },
    );
    response = await verify();
  }
  const tokens = ok(response, 'Signing in with a code from E2E_TOTP_SECRET');
  const profile = await me(api, tokens.accessToken);
  if (profile.id !== row.id) {
    throw new Refusal(`The API and the database disagree about who ${account.email} is.`);
  }
  return {
    ...account,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    id: profile.id,
    displayName: profile.name,
  };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

async function myProjects(api, token) {
  const projects = [];
  let cursor = null;
  for (let page = 0; page < 40; page++) {
    const query = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) });
    const body = ok(await api('GET', `/v1/me/projects?${query}`, { token }), 'Listing the creator’s campaigns');
    projects.push(...(body.projects ?? []));
    cursor = body.nextCursor ?? null;
    if (!cursor) break;
  }
  return projects;
}

async function chooseCategory(api) {
  const categories = ok(await api('GET', '/v1/categories'), 'Reading the categories') ?? [];
  const withSubcategories = categories.filter((category) => (category.subcategories ?? []).length > 0);
  const category = withSubcategories.find((candidate) => candidate.slug === 'design') ?? withSubcategories[0];
  if (!category) throw new Error('The taxonomy has no category with a subcategory.');
  const subcategory =
    category.subcategories.find((candidate) => candidate.slug === 'product') ?? category.subcategories[0];
  return { category, subcategory };
}

function paragraph(text) {
  return { type: 'paragraph', spans: [{ text, marks: [] }] };
}

/** Comfortably past §5.3's 500-character story and 200-character risks. */
function campaignContent(category, subcategory) {
  return {
    blurb: 'A campaign that exists so the end-to-end suite has something live to back. Nothing ships.',
    categoryId: category.id,
    subcategoryId: subcategory.id,
    goal: { amount: '5000.00', currency: CURRENCY },
    durationDays: 30,
    coverImage: COVER,
    risks:
      'This campaign is test data on a staging server. It will never be collected, nothing will be ' +
      'delivered, and it is rebuilt whenever the end-to-end seed runs. If you are reading this on a ' +
      'production page, something has gone badly wrong and support should be told.',
    story: {
      version: 1,
      blocks: [
        paragraph(
          'This is the campaign the mobile end-to-end suite opens. It has two digital reward tiers and ' +
            'one digital add-on, so the checkout can be walked from the first tap to the payment step ' +
            'without being asked where anything should be posted.',
        ),
        {
          type: 'image',
          url: COVER.url,
          width: COVER.width,
          height: COVER.height,
          alt: 'An open notebook with a patterned cover on a desk',
        },
        paragraph(
          'Everything here is written by ops/seed/e2e/seed.mjs. Its deadline is pushed thirty days ' +
            'out every time the seed runs, so the campaign never ends while the suite depends on it. ' +
            'The pledges against it are drafts that expire after five minutes, and none of them is ' +
            'ever collected.',
        ),
        paragraph(
          'If a field on this page looks wrong, change the seed rather than the page: the next run ' +
            'reads the campaign back by its title and does not overwrite what it finds.',
        ),
      ],
    },
  };
}

function inFuture(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Every tier in TIERS, found by title or created. */
async function ensureRewards(api, token, projectId) {
  const existing = ok(await api('GET', `/v1/projects/${projectId}/rewards`, { token }), 'Listing rewards') ?? [];
  const result = [];
  for (const spec of TIERS) {
    let tier = existing.find((candidate) => candidate.title === spec.title);
    if (!tier) {
      log(`creating reward "${spec.title}"`);
      tier = ok(
        await api('POST', `/v1/projects/${projectId}/rewards`, {
          token,
          body: {
            title: spec.title,
            description: spec.description,
            price: { amount: spec.price, currency: CURRENCY },
            estimatedDelivery: inFuture(120),
            shippingType: 'DIGITAL',
            isAddon: spec.isAddon,
            items: [],
          },
        }),
        `Creating reward "${spec.title}"`,
      );
    } else if (tier.isAddon !== spec.isAddon || tier.shippingType === 'DOMESTIC' || tier.shippingType === 'INTERNATIONAL') {
      throw new Error(`Reward "${spec.title}" exists but is not what the seed makes; fix or remove it by hand.`);
    }
    result.push(tier);
  }
  return result;
}

/**
 * SQL step 4: DRAFT straight to LIVE, with the history the three skipped steps would
 * have written. One statement, so the state and its history land together or not at all.
 */
async function goLive(sql, projectId, creatorId) {
  const live = await sql(
    `BEGIN;
     WITH moved AS (
         UPDATE projects
            SET state = 'LIVE', launched_at = now(), duration_days = 30, deadline = now() + interval '30 days'
          WHERE id = :'project_id'::uuid AND creator_id = :'creator_id'::uuid AND state = 'DRAFT'
         RETURNING id
     ), steps (from_state, to_state, at) AS (
         VALUES ('DRAFT', 'SUBMITTED', now() - interval '2 seconds'),
                ('SUBMITTED', 'APPROVED', now() - interval '1 second'),
                ('APPROVED', 'LIVE', now())
     )
     INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
     SELECT gen_random_uuid(), moved.id, steps.from_state, steps.to_state, NULL, 'SYSTEM', :'note', steps.at
       FROM moved CROSS JOIN steps;
     SELECT state FROM projects WHERE id = :'project_id'::uuid;
     COMMIT;`,
    { project_id: projectId, creator_id: creatorId, note: SEED_NOTE },
  );
  if (live !== 'LIVE') throw new Error(`The campaign is ${live || 'missing'} after going live.`);
}

/**
 * SQL step 5: thirty days left, every run. The launch moves forward only as far as it has
 * to for the duration to stay inside §5.3's sixty days.
 */
async function extendDeadline(sql, projectId, creatorId) {
  const deadline = await sql(
    `UPDATE projects
        SET launched_at = greatest(launched_at, now() - interval '29 days'),
            deadline = now() + interval '30 days',
            duration_days = ceil(extract(epoch FROM (now() + interval '30 days')
                                 - greatest(launched_at, now() - interval '29 days')) / 86400)::int
      WHERE id = :'project_id'::uuid AND creator_id = :'creator_id'::uuid AND state = 'LIVE';
     SELECT deadline FROM projects WHERE id = :'project_id'::uuid AND state = 'LIVE';`,
    { project_id: projectId, creator_id: creatorId },
  );
  if (!deadline) throw new Error('The live campaign is not LIVE, so its deadline could not be extended.');
  return deadline;
}

/** The live campaign, found by title or built. Returns its edit view and tiers. */
async function ensureLiveCampaign(api, sql, creator) {
  const mine = await myProjects(api, creator.accessToken);
  const named = mine.filter((project) => project.title === LIVE_TITLE);
  let card = named.find((project) => project.state === 'LIVE') ?? named.find((project) => project.state === 'DRAFT');

  if (!card) {
    if (named.length > 0) log(`"${LIVE_TITLE}" exists only in ${named.map((p) => p.state).join(', ')}; making a new one`);
    log(`creating "${LIVE_TITLE}"`);
    card = ok(
      await api('POST', '/v1/projects', { token: creator.accessToken, body: { title: LIVE_TITLE } }),
      'Creating the live campaign',
    );
  }

  if (card.state === 'DRAFT') {
    const { category, subcategory } = await chooseCategory(api);
    log('writing the campaign’s content');
    ok(
      await api('PATCH', `/v1/projects/${card.id}`, {
        token: creator.accessToken,
        body: campaignContent(category, subcategory),
      }),
      'Writing the live campaign',
    );
  }

  // Before going live: a live campaign's prices are locked.
  const tiers = await ensureRewards(api, creator.accessToken, card.id);

  if (card.state === 'DRAFT') {
    log('taking the campaign live');
    await goLive(sql, card.id, creator.id);
  }
  const deadline = await extendDeadline(sql, card.id, creator.id);
  log(`deadline now ${deadline}`);

  const edit = ok(await api('GET', `/v1/projects/${card.id}/edit`, { token: creator.accessToken }), 'Reading the campaign');
  return { edit, tiers };
}

async function ensureDraftCampaign(api, creator) {
  const drafts = (await myProjects(api, creator.accessToken)).filter(
    (project) => project.title === DRAFT_TITLE && project.state === 'DRAFT',
  );
  if (drafts.length > 1) log(`${drafts.length} drafts are titled "${DRAFT_TITLE}"; using the first`);
  if (drafts[0]) return drafts[0];
  log(`creating "${DRAFT_TITLE}"`);
  return ok(
    await api('POST', '/v1/projects', { token: creator.accessToken, body: { title: DRAFT_TITLE } }),
    'Creating the draft campaign',
  );
}

// ---------------------------------------------------------------------------
// The backer's pledge
// ---------------------------------------------------------------------------

/**
 * A DRAFT pledge on the first tier. The one the backer already has when it is still a
 * draft; a confirmed one left by an earlier suite run is cancelled and replaced, because
 * a backer holds one active pledge per campaign.
 */
async function ensureDraftPledge(api, backer, projectId, tier) {
  const draft = () =>
    api('POST', '/v1/pledges/draft', {
      token: backer.accessToken,
      headers: { 'Idempotency-Key': randomUUID() },
      body: {
        projectId,
        rewardTierId: tier.id,
        addons: [],
        contribution: { amount: tier.price.amount, currency: tier.price.currency },
      },
    });

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await draft();
    if (response.status === 201 || response.status === 200) {
      log('drafted a new pledge');
      return response.json.id;
    }
    const meta = response.json?.meta;
    if (response.status !== 409 || response.json?.code !== 'PLEDGE_ALREADY_EXISTS' || !meta?.pledgeId) {
      throw new ApiError('Drafting the pledge', response);
    }
    if (meta.state === 'DRAFT') {
      log('reusing the backer’s draft pledge');
      return meta.pledgeId;
    }
    if (attempt > 0) break;
    log(`the backer already has a ${meta.state} pledge; cancelling it`);
    ok(
      await api('DELETE', `/v1/pledges/${meta.pledgeId}`, {
        token: backer.accessToken,
        headers: { 'Idempotency-Key': randomUUID() },
      }),
      'Cancelling the earlier pledge',
    );
  }
  throw new Error('The backer still has an active pledge after cancelling it.');
}

// ---------------------------------------------------------------------------
// Public catalogue
// ---------------------------------------------------------------------------

async function firstCollection(api) {
  const response = await api('GET', '/v1/collections');
  return response.status === 200 ? (response.json?.items?.[0]?.slug ?? null) : null;
}

async function firstLegalDocument(api) {
  const response = await api('GET', '/v1/legal/documents');
  if (response.status !== 200) return null;
  const documents = response.json?.documents ?? [];
  const document = documents.find((candidate) => candidate.kind === 'TERMS_OF_USE') ?? documents[0];
  if (!document) return null;
  // The address form @ideanest/legal uses: TERMS_OF_USE is terms-of-use.
  return { slug: document.kind.toLowerCase().replace(/_/g, '-'), version: document.version };
}

// ---------------------------------------------------------------------------

function printPlan(config) {
  log(`target API     ${config.apiOrigin}`);
  log(`target DB      ${config.databaseUrl ? (databaseHosts(config.databaseUrl) ?? []).join(', ') || 'local socket' : '(none given)'}`);
  log('would ensure, through the API unless marked SQL:');
  log(`  accounts      ${config.creator.email}, ${config.backer.email}, ${config.twoFactor.email}`);
  log('  SQL           mark the three addresses verified');
  log(`  two-factor    ${config.twoFactor.email} enrolled with E2E_TOTP_SECRET (SQL: secret, replay guard)`);
  log(`  campaign      "${LIVE_TITLE}" with ${TIERS.map((tier) => `"${tier.title}"`).join(', ')}`);
  log('  SQL           DRAFT -> LIVE with its history; deadline 30 days out');
  log(`  draft         "${DRAFT_TITLE}"`);
  log(`  pledge        a DRAFT pledge by ${config.backer.email} on "${TIERS[0].title}"`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stderr.write('Usage: node ops/seed/e2e/seed.mjs [--dry-run] [--env-file <path>]\nSee the header of this file.\n');
    return;
  }

  requireNotProduction(process.env.E2E_API_ORIGIN, process.env.E2E_DATABASE_URL);
  const config = readEnvironment(options.dryRun);
  log('target is not production');

  if (options.dryRun) {
    printPlan(config);
    log('dry run: nothing was requested or written');
    return;
  }

  const api = createApi(config.apiOrigin);
  const sql = createSql(config.psql, config.databaseUrl);
  const sessions = [];

  try {
    const creator = await signInPlainly(api, sql, config.creator);
    sessions.push(creator);
    const backer = await signInPlainly(api, sql, config.backer);
    sessions.push(backer);
    await requireSameEnvironment(sql, [creator, backer]);
    log('API and database are the same environment');

    const twoFactor = await ensureTwoFactor(api, sql, config.twoFactor, config.totpSecret, [creator, backer]);
    sessions.push(twoFactor);

    // SQL step 1.
    await sql(
      `UPDATE users SET email_verified_at = now()
        WHERE id = ANY (string_to_array(:'ids', ',')::uuid[]) AND email_verified_at IS NULL;`,
      { ids: [creator.id, backer.id, twoFactor.id].join(',') },
    );
    // SQL step 3, last, so nothing after it spends a code.
    await sql(`UPDATE user_two_factor SET last_used_step = NULL WHERE user_id = :'user_id'::uuid AND confirmed_at IS NOT NULL;`, {
      user_id: twoFactor.id,
    });

    const { edit, tiers } = await ensureLiveCampaign(api, sql, creator);
    const draft = await ensureDraftCampaign(api, creator);
    const pledgeId = await ensureDraftPledge(api, backer, edit.id, tiers[0]);

    const categories = ok(await api('GET', '/v1/categories'), 'Reading the categories') ?? [];
    const category = categories.find((candidate) => candidate.id === edit.categoryId);
    const subcategory = category?.subcategories?.find((candidate) => candidate.id === edit.subcategoryId);

    const page = await api('GET', `/v1/projects/${creator.slug}/${edit.slug}`);
    if (page.status !== 200 || page.json?.state !== 'LIVE') {
      log(`warning: the public page answered ${page.status}${page.json?.state ? ` (${page.json.state})` : ''}`);
    }

    const collection = await firstCollection(api);
    const legal = await firstLegalDocument(api);
    const addon = tiers.find((tier) => tier.isAddon);

    const output = [
      ['CAMPAIGN_ID', edit.id],
      ['CAMPAIGN_PATH', `${creator.slug}/${edit.slug}`],
      ['CAMPAIGN_TITLE', edit.title],
      ['TIER_ID', tiers[0].id],
      ['TIER_TITLE', tiers[0].title],
      ['ADDON_ID', addon.id],
      ['ADDON_TITLE', addon.title],
      ['PLEDGE_ID', pledgeId],
      ['DRAFT_ID', draft.id],
      ['DRAFT_TITLE', draft.title],
      ['CREATOR_SLUG', creator.slug],
      ['TWOFA_NAME', twoFactor.displayName],
      ['CATEGORY_SLUG', category?.slug],
      ['SUBCATEGORY_SLUG', subcategory?.slug],
      ['COLLECTION_SLUG', collection],
      ['LEGAL_DOCUMENT', legal?.slug],
      ['LEGAL_VERSION', legal?.version],
    ]
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${key}=${shellValue(value)}`)
      .join('\n');

    process.stdout.write(`${output}\n`);
    if (options.envFile) {
      writeFileSync(options.envFile, `${output}\n`, 'utf8');
      log(`wrote ${options.envFile}`);
    }
  } finally {
    // The seed's own sessions, so a run does not leave one more device in each list.
    for (const session of sessions) {
      if (!session.refreshToken) continue;
      await api('POST', '/v1/auth/logout', { body: { refreshToken: session.refreshToken } }).catch(() => undefined);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`\n${error instanceof Refusal ? 'REFUSED' : 'FAILED'}: ${error.message}\n`);
    process.exit(error instanceof Refusal ? REFUSED : 1);
  });
}
