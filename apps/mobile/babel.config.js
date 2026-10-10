/**
 * Babel for the phone app.
 *
 * ## Why this file has to exist
 *
 * It did not, and that was the cause of the crash reported three times: "undefined is
 * not a function" at `(teacher)/(tabs)/_layout.tsx:30`, with both layouts then reported
 * as missing their default export.
 *
 * Reanimated 4 does not work without a Babel plugin. Its animated functions are
 * **worklets** — code lifted out and compiled to run on the UI thread — and the lifting
 * is the plugin's job. With no config the plugin never runs, every worklet stays
 * `undefined`, and the first thing to call one throws. The drawer is built on Reanimated,
 * so opening it was that first thing. Both layouts then threw while evaluating their
 * imports, which is why Expo Router reported their default exports missing: a cascade,
 * not two more faults.
 *
 * Hermes blames the module's FIRST import line, which is why every report pointed at
 * `import { Tabs } from 'expo-router'` — a line that was never wrong.
 *
 * ## Why `react-native-worklets/plugin` and not `react-native-reanimated/plugin`
 *
 * Reanimated 4 moved worklet compilation into its own package. `react-native-worklets`
 * is a peer dependency (`0.13.x`, and 0.13.0 is installed), and the plugin lives there
 * now. The old path is what Reanimated 2 and 3 used and does not exist here.
 *
 * ## Adding this file exposed a second, hidden fault
 *
 * With no `babel.config.js`, Expo's Metro transformer supplies its own and resolves the
 * preset itself. Adding one made Babel resolve `babel-preset-expo` normally — and the
 * workspace root held a stale **12.0.12**, an SDK-50-era copy left by an older install
 * that nothing declares. It predates expo-router's app-root injection, so the bundle
 * died on `Invalid call ... process.env.EXPO_ROUTER_APP_ROOT`.
 *
 * `apps/mobile` now pins `babel-preset-expo@~57.0.13`, the version Expo 57 names, and
 * `metro.config.js` already searches the app's own `node_modules` first. The hoisted
 * copy is left alone rather than deleted — nothing else uses it, but removing a package
 * nobody declared is a separate decision.
 *
 * ## It must stay last
 *
 * The plugin rewrites functions other transforms may also touch, and it expects to see
 * them after everything else has run. Reanimated's own documentation is explicit about
 * this, and a plugin added below it is the usual cause of "it worked until I added X".
 */

module.exports = function babel(api) {
  // Cached per environment rather than per call — Metro compiles thousands of files and
  // rebuilding this object for each one is pure overhead.
  api.cache(true)

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Must be last. See above.
      'react-native-worklets/plugin',
    ],
  }
}
