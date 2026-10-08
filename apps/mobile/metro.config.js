/**
 * Metro in a pnpm workspace.
 *
 * Two things are not defaults. `watchFolders` reaches the repository root
 * because `@ideanest/design-tokens` and `@ideanest/api-client` are symlinked
 * out of `apps/mobile`, and a bundler that does not watch the real directory
 * serves a stale copy of a package you just edited. `disableHierarchicalLookup`
 * stays off and `nodeModulesPaths` names both stores, because pnpm's layout is
 * not the flat `node_modules` Metro assumes and a transitive dependency
 * resolves from the store rather than from beside the importer.
 *
 * The base is Expo's default configuration as `@sentry/react-native` hands it back (#165): the
 * same config, plus a debug id written into every bundle and its source map, which is how a
 * crash report finds its source map whatever release or update the bundle shipped in. Sentry's
 * web session-replay packages are resolved to nothing — replay is off, and they are not
 * shipped to a phone either way.
 */
const path = require('node:path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getSentryExpoConfig(projectRoot, { includeWebReplay: false });

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
