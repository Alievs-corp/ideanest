/**
 * Writes `maestro/links.yaml` — flow 4 of issue #165's end-to-end suite — from the claimed-route
 * table in `@ideanest/links`.
 *
 *   node e2e/generate-links-flow.mjs          # write the flow
 *   node e2e/generate-links-flow.mjs --check  # fail when the committed flow is not what the table makes
 *
 * <h2>Why generated</h2>
 *
 * The flow opens every claimed web path and checks the screen it lands on. Written by hand it
 * would be a second copy of `CLAIMED_ROUTES` that nobody updates when a row is added, which is the
 * drift `@ideanest/links` exists to end. So the table decides which links are opened; this file
 * only knows a sample value for each route's parameters (the seeded fixtures), and the landing
 * screen's id comes from the route file itself (`withScreenRoot('<name>', …)`).
 *
 * <h2>What each sample asserts</h2>
 *
 * Every route of every row is opened three ways — unprefixed (what the API's emails send),
 * locale-prefixed (what a browser shows; the four locales take turns), and `ideanest://` (push
 * payloads) — each from a stopped app, so a screen left over from the previous link cannot pass
 * for this one. Then `https://<site>/az/admin` must not open the app.
 *
 * The generator refuses to write a flow that misses a row: every route a row names needs a sample,
 * every path pattern a row claims needs a sample that matches it, and every sample has to be a
 * claimed path in all its forms.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAIMED_ROUTES, LOCALES, isClaimedPath, matchesPattern } from '@ideanest/links/claims';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'src', 'app');
const OUTPUT = join(HERE, 'maestro', 'links.yaml');

/**
 * The table, in the shape this generator reads. The one place that knows `ClaimedRoute`'s fields:
 * if the table's shape changes, this is the function to change.
 *
 * @returns {{ id: string, patterns: readonly string[], routes: readonly string[] }[]}
 */
function claimedRows(table) {
  return table.map((row) => ({ id: row.id, patterns: row.paths, routes: row.routes }));
}

/**
 * One link per landing route, with the seeded fixtures as Maestro variables. `lands` overrides
 * the route's own screen where the route moves on by itself.
 */
const SAMPLES = [
  { route: '(tabs)/index', path: '/' },
  { route: 'discover', path: '/discover?sort=newest' },
  { route: '(tabs)/search', path: '/search?q=e2e' },
  { route: 'categories/index', path: '/categories' },
  { route: 'categories/[category]/index', path: '/categories/${CATEGORY_SLUG}' },
  { route: 'categories/[category]/[subcategory]', path: '/categories/${CATEGORY_SLUG}/${SUBCATEGORY_SLUG}' },
  { route: 'collections/index', path: '/collections' },
  { route: 'collections/[slug]', path: '/collections/${COLLECTION_SLUG}' },
  { route: 'campaigns/new', path: '/projects/new' },
  { route: 'campaigns/[id]/prelaunch', path: '/projects/${CAMPAIGN_ID}/prelaunch' },
  { route: 'campaigns/[id]/back', path: '/projects/${CAMPAIGN_ID}/back' },
  { route: 'campaigns/[id]/edit/basics', path: '/projects/${DRAFT_ID}/edit' },
  { route: 'campaigns/[id]/edit/basics', path: '/projects/${DRAFT_ID}/edit/basics' },
  { route: 'campaigns/[id]/edit/story', path: '/projects/${DRAFT_ID}/edit/story' },
  { route: 'campaigns/[id]/edit/rewards', path: '/projects/${DRAFT_ID}/edit/rewards' },
  { route: 'campaigns/[id]/edit/faq', path: '/projects/${DRAFT_ID}/edit/faq' },
  { route: 'campaigns/[id]/edit/prelaunch', path: '/projects/${DRAFT_ID}/edit/prelaunch' },
  { route: 'campaigns/[id]/edit/review', path: '/projects/${DRAFT_ID}/edit/review' },
  { route: 'campaigns/[id]/dashboard/index', path: '/projects/${CAMPAIGN_ID}/dashboard' },
  { route: 'campaigns/[id]/dashboard/charts', path: '/projects/${CAMPAIGN_ID}/dashboard/charts' },
  { route: 'campaigns/[id]/dashboard/backers', path: '/projects/${CAMPAIGN_ID}/dashboard/backers' },
  { route: 'campaigns/[id]/dashboard/finance', path: '/projects/${CAMPAIGN_ID}/dashboard/finance' },
  { route: 'campaigns/[id]/dashboard/surveys', path: '/projects/${CAMPAIGN_ID}/dashboard/surveys' },
  { route: 'projects/[creatorSlug]/[projectSlug]', path: '/projects/${CAMPAIGN_PATH}' },
  // A notification row written before slugs existed: the web has no page there either.
  { route: '+not-found', path: '/projects/${CAMPAIGN_ID}' },
  { route: '(tabs)/pledges', path: '/pledges' },
  { route: 'pledges/[id]/index', path: '/pledges/${PLEDGE_ID}' },
  { route: 'pledges/[id]/address', path: '/pledges/${PLEDGE_ID}/address' },
  { route: 'u/[slug]', path: '/u/${CREATOR_SLUG}' },
  { route: 'notifications', path: '/notifications' },
  { route: '(tabs)/me', path: '/account' },
  { route: 'saved', path: '/account/saved' },
  { route: 'account/campaigns', path: '/account/campaigns' },
  { route: 'account/deliveries', path: '/account/deliveries' },
  { route: 'account/following', path: '/account/following' },
  { route: 'account/surveys', path: '/account/surveys' },
  { route: 'settings/index', path: '/settings' },
  { route: 'settings/profile', path: '/settings/profile' },
  { route: 'settings/notifications', path: '/settings/notifications' },
  { route: 'settings/sessions', path: '/settings/sessions' },
  { route: 'settings/email', path: '/settings/email' },
  { route: 'settings/password', path: '/settings/password' },
  { route: 'settings/security', path: '/settings/security' },
  { route: 'settings/privacy', path: '/settings/privacy' },
  { route: 'settings/payout', path: '/settings/payout?card=failed' },
  { route: 'settings/language', path: '/settings/language' },
  { route: '(auth)/sign-in', path: '/sign-in' },
  { route: '(auth)/register', path: '/register' },
  { route: '(auth)/reset-password/index', path: '/reset-password' },
  // The tokens are deliberately dead: the screen opens, and the service refuses them.
  { route: '(auth)/verify-email', path: '/verify-email?token=e2e-dead-token' },
  { route: '(auth)/reset-password/confirm', path: '/reset-password/confirm?token=e2e-dead-token' },
  { route: '(auth)/confirm-email-change', path: '/confirm-email-change?token=e2e-dead-token' },
  { route: 'about', path: '/about' },
  { route: 'how-it-works', path: '/how-it-works' },
  { route: 'pricing', path: '/pricing' },
  { route: 'trust-safety', path: '/trust-safety' },
  { route: 'legal/index', path: '/legal' },
  { route: 'legal/[document]/index', path: '/legal/${LEGAL_DOCUMENT}' },
  { route: 'legal/[document]/v/[version]', path: '/legal/${LEGAL_DOCUMENT}/v/${LEGAL_VERSION}' },
  // Outside a maintenance window the screen has nothing to wait for and replaces itself with Home.
  { route: 'maintenance', path: '/maintenance', lands: '(tabs)/index' },
];

/** Never the app's: the console is excluded from the claim on both platforms. */
const UNCLAIMED = '/az/admin';

/** Stand-ins for the variables, so a sample can be matched against the table's patterns. */
const STAND_INS = {
  CAMPAIGN_ID: '00000000-0000-4000-8000-000000000001',
  DRAFT_ID: '00000000-0000-4000-8000-000000000002',
  PLEDGE_ID: '00000000-0000-4000-8000-000000000003',
  CAMPAIGN_PATH: 'e2e-creator/e2e-live-campaign',
};

function concrete(path) {
  return path.replace(/\$\{(\w+)\}/g, (_, name) => STAND_INS[name] ?? `e2e-${name.toLowerCase()}`);
}

function pathOnly(path) {
  return path.split('?')[0];
}

/** The landing screen's id, read from the route file: `withScreenRoot('<name>', …)`. */
function screenIdOf(route) {
  const file = join(APP, `${route}.tsx`);
  if (!existsSync(file)) throw new Error(`${route}: no route file at ${file}`);
  const match = /withScreenRoot\('([a-z0-9-]+)'/.exec(readFileSync(file, 'utf8'));
  if (match === null) throw new Error(`${route}: the route file does not wrap its screen in withScreenRoot`);
  return `screen-${match[1]}`;
}

/** Throws unless the samples cover every row of the table, every route and every pattern. */
function checkCoverage(rows) {
  const problems = [];
  for (const row of rows) {
    const mine = SAMPLES.filter(
      (sample) =>
        row.routes.includes(sample.route) &&
        row.patterns.some((pattern) => matchesPattern(pattern, pathOnly(concrete(sample.path)))),
    );
    for (const route of row.routes) {
      if (!mine.some((sample) => sample.route === route)) problems.push(`${row.id}: no sample opens ${route}`);
    }
    for (const pattern of row.patterns) {
      if (!mine.some((sample) => matchesPattern(pattern, pathOnly(concrete(sample.path))))) {
        problems.push(`${row.id}: no sample matches ${pattern}`);
      }
    }
  }
  const claimedRoutes = new Set(rows.flatMap((row) => row.routes));
  for (const sample of SAMPLES) {
    if (!claimedRoutes.has(sample.route)) problems.push(`${sample.path}: ${sample.route} is in no row of the table`);
    for (const form of [pathOnly(concrete(sample.path)), ...LOCALES.map((locale) => prefixed(locale, concrete(sample.path)))]) {
      if (!isClaimedPath(pathOnly(form))) problems.push(`${form}: not a claimed path`);
    }
  }
  if (isClaimedPath(UNCLAIMED)) problems.push(`${UNCLAIMED} is claimed, and the flow asserts it is not`);
  if (problems.length > 0) throw new Error(`The links flow cannot cover the table:\n  ${problems.join('\n  ')}`);
}

function prefixed(locale, path) {
  return path === '/' ? `/${locale}` : path.startsWith('/?') ? `/${locale}${path.slice(1)}` : `/${locale}${path}`;
}

function quoted(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function openAndAssert(link, screenId) {
  return [
    '- stopApp',
    '- openLink:',
    `    link: ${quoted(link)}`,
    '    autoVerify: true',
    '- extendedWaitUntil:',
    '    visible:',
    `      id: ${screenId}`,
    '    timeout: 20000',
  ];
}

const VARIABLES = [
  'SITE',
  'CAMPAIGN_ID',
  'CAMPAIGN_PATH',
  'DRAFT_ID',
  'PLEDGE_ID',
  'CREATOR_SLUG',
  'CATEGORY_SLUG',
  'SUBCATEGORY_SLUG',
  'COLLECTION_SLUG',
  'LEGAL_DOCUMENT',
  'LEGAL_VERSION',
  'CREATOR_EMAIL',
  'CREATOR_PASSWORD',
];

function render(rows) {
  checkCoverage(rows);
  const lines = [
    '# GENERATED by apps/mobile/e2e/generate-links-flow.mjs from @ideanest/links CLAIMED_ROUTES.',
    '# Do not edit: change the table or the generator, then run `node e2e/generate-links-flow.mjs`.',
    '#',
    '# Flow 4 (#165): every claimed route, opened unprefixed, locale-prefixed and as ideanest://,',
    '# each from a stopped app, lands on its screen; https://<site>/az/admin does not open the app.',
    '# Signed in as the seeded creator, who owns the campaign ids the editor and dashboard links name.',
    'appId: az.ideanest.app',
    'name: Claimed links',
    'tags:',
    '  - links',
    'env:',
    ...VARIABLES.map((name) => `  ${name}: \${MAESTRO_${name} || ${name}}`),
    '---',
    '- runFlow: subflows/launch.yaml',
    '- runFlow:',
    '    file: subflows/sign-in-and-wait.yaml',
    '    env:',
    '      EMAIL: ${CREATOR_EMAIL}',
    '      PASSWORD: ${CREATOR_PASSWORD}',
  ];

  SAMPLES.forEach((sample, index) => {
    const locale = LOCALES[index % LOCALES.length];
    const screenId = screenIdOf(sample.lands ?? sample.route);
    lines.push('', `# ${sample.route} <- ${sample.path}`);
    lines.push(...openAndAssert(`\${SITE}${sample.path}`, screenId));
    lines.push(...openAndAssert(`\${SITE}${prefixed(locale, sample.path)}`, screenId));
    lines.push(...openAndAssert(`ideanest://${sample.path.slice(1)}`, screenId));
  });

  lines.push(
    '',
    '# Never claimed: the console opens in the browser, and the app stays where it was.',
    '- stopApp',
    '- launchApp',
    '- extendedWaitUntil:',
    '    visible:',
    '      id: screen-home',
    '    timeout: 30000',
    '- openLink:',
    `    link: ${quoted(`\${SITE}${UNCLAIMED}`)}`,
    '    autoVerify: true',
    '- extendedWaitUntil:',
    '    notVisible:',
    '      id: screen-home',
    '    timeout: 20000',
    '- launchApp',
    '- extendedWaitUntil:',
    '    visible:',
    '      id: screen-home',
    '    timeout: 20000',
    '- assertNotVisible:',
    '    id: screen-not-found',
    '',
  );
  return lines.join('\n');
}

const flow = render(claimedRows(CLAIMED_ROUTES));

if (process.argv.includes('--check')) {
  const committed = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (committed !== flow) {
    console.error('::error::e2e/maestro/links.yaml is not what @ideanest/links CLAIMED_ROUTES makes. Run `node e2e/generate-links-flow.mjs`.');
    process.exitCode = 1;
  } else {
    console.log('e2e/maestro/links.yaml matches the claimed-route table.');
  }
} else {
  writeFileSync(OUTPUT, flow);
  console.log(`Wrote ${OUTPUT}: ${SAMPLES.length} routes, ${SAMPLES.length * 3} links.`);
}
