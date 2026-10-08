/**
 * Checks that the two halves of the deep links (§4.12 MB-02) name the same application.
 *
 * <h2>What can go wrong, and why nothing else catches it</h2>
 *
 * `app.config.ts` declares the bundle identifier, the Android package, and the
 * host whose links this application claims. `apps/web`'s
 * `lib/mobile/association.ts` serves the two files that grant that claim, and it
 * reads its identifiers from the environment at run time.
 *
 * Nothing connects the two. A bundle identifier changed here and not there
 * produces an association file that is served, fetched, parsed, and silently
 * disagreed with: iOS caches the answer for up to a week, Android stops
 * verifying, and every shared campaign link opens the browser. There is no error
 * anywhere — on the site, in the application, or in a build log.
 *
 * So this asserts the one thing a machine can assert without either half being
 * deployed: the identifiers in the Expo configuration are the ones the web half
 * is configured with, when it is configured at all.
 *
 * <h2>The paths, too (#165)</h2>
 *
 * The intent filter's paths are built from `@ideanest/links`' claimed-route table, the same table
 * the web's association file claims for iOS. A prefix added to `app.config.ts` by hand, or a row
 * the filter lost, fails here, as does any entry that would hand `/admin` to the application.
 * The table is imported directly: Node strips its types, which is why `claims.ts` imports
 * nothing relative.
 *
 * <h2>Unconfigured passes</h2>
 *
 * A checkout with no `IDEANEST_IOS_APP_ID` is a developer's machine or a pull
 * request from a fork, and the web half answers 404 there by design. Failing
 * would make the check about whether somebody had exported a variable rather
 * than about whether the two agree.
 */
import { execSync } from 'node:child_process';
import { intentDrift } from '@ideanest/links/claims';

/** Read from the resolved Expo config rather than from the source, so a computed value counts. */
function expoConfig() {
  // `execSync` rather than `execFileSync`, because on Windows `pnpm` is a `.cmd`
  // and only a shell will run one. The command is a literal with nothing
  // interpolated into it, so there is nothing to escape.
  const json = execSync('pnpm --filter @ideanest/mobile exec expo config --json', {
    encoding: 'utf8',
    // `expo config` writes progress to stderr, which is not the document.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(json);
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

const config = expoConfig();

const bundleIdentifier = config.ios?.bundleIdentifier;
const androidPackage = config.android?.package;
const siteUrl = config.extra?.siteUrl;

if (!bundleIdentifier) fail('app.config.ts declares no ios.bundleIdentifier.');
if (!androidPackage) fail('app.config.ts declares no android.package.');
if (!siteUrl) fail('app.config.ts resolved no siteUrl.');

const claimedHost = siteUrl ? new URL(siteUrl).host : null;
const associatedDomain = (config.ios?.associatedDomains ?? []).find((entry) => entry.startsWith('applinks:'));

if (claimedHost && associatedDomain !== `applinks:${claimedHost}`) {
  fail(
    `ios.associatedDomains claims ${associatedDomain ?? 'nothing'} but siteUrl is ${siteUrl}. ` +
      'A universal link is granted by the host in siteUrl and by no other.',
  );
}

const intentHosts = (config.android?.intentFilters ?? [])
  .flatMap((filter) => filter.data ?? [])
  .map((entry) => entry.host);

if (claimedHost && !intentHosts.includes(claimedHost)) {
  fail(
    `android.intentFilters claim ${JSON.stringify(intentHosts)} but siteUrl is ${siteUrl}. ` +
      'Android verifies the host in the intent filter against that host\'s assetlinks.json.',
  );
}

if (claimedHost) {
  const data = (config.android?.intentFilters ?? []).flatMap((filter) => filter.data ?? []);
  const drift = intentDrift(data, claimedHost);
  for (const entry of drift.missing) {
    fail(`android.intentFilters lack ${entry}, which @ideanest/links claims. Build the data from androidIntentData().`);
  }
  for (const entry of drift.extra) {
    fail(`android.intentFilters claim ${entry}, which @ideanest/links does not. Add the row to CLAIMED_ROUTES instead.`);
  }
  for (const entry of drift.admin) {
    fail(`android.intentFilters claim ${entry}, which reaches /admin. Android cannot exclude, so nothing may cover it.`);
  }
}

/*
 * The web half, when this environment has been told about it. `IDEANEST_IOS_APP_ID`
 * is `<team prefix>.<bundle identifier>`, so the bundle identifier is its suffix.
 */
const iosAppId = process.env.IDEANEST_IOS_APP_ID?.trim();
if (iosAppId && bundleIdentifier && !iosAppId.endsWith(`.${bundleIdentifier}`)) {
  fail(
    `IDEANEST_IOS_APP_ID is ${iosAppId} but the application's bundle identifier is ${bundleIdentifier}. ` +
      'iOS will fetch the association file, disagree with it, and stop opening links — silently.',
  );
}

const configuredPackage = process.env.IDEANEST_ANDROID_PACKAGE?.trim();
if (configuredPackage && configuredPackage !== androidPackage) {
  fail(
    `IDEANEST_ANDROID_PACKAGE is ${configuredPackage} but the application's package is ${androidPackage}.`,
  );
}

if (process.exitCode !== 1) {
  console.log(
    `The mobile association identifiers agree: ${bundleIdentifier} / ${androidPackage} on ${claimedHost}, ` +
      'and the intent filter claims exactly the @ideanest/links table.',
  );
}
