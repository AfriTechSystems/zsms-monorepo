/**
 * Metro, taught about the monorepo.
 *
 * Spec: https://docs.expo.dev/guides/monorepos/
 *
 * Metro's default resolver walks up from the project looking for `node_modules`, and in a
 * workspace that is not enough: npm hoists most packages to the repository root, so a
 * transitive dependency of `expo-router` — `query-string`, in the failure that prompted
 * this — resolves from nowhere and the bundle fails with a module-not-found deep inside a
 * library nobody imported directly.
 *
 * Two settings fix it, and both are about telling Metro the truth:
 *
 *   * `watchFolders` — the workspace root, so editing `packages/design-tokens` rebuilds
 *     the app rather than serving a stale copy.
 *   * `nodeModulesPaths` — both the app's own `node_modules` and the hoisted root one,
 *     in that order, so a version pinned for the app still wins.
 *
 * `disableHierarchicalLookup` is deliberately NOT set. It is the stricter configuration
 * Expo's guide offers, and it breaks `@zsms/*` workspace links, which resolve through the
 * very hierarchy it disables.
 */

const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
