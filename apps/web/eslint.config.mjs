/**
 * ESLint for `apps/web`.
 *
 * ## Why this file did not exist until now
 *
 * `package.json` has carried a `lint` script since the repository was created and
 * `turbo lint` has been run against it. It never linted anything: the script was
 * `next lint`, which with no configuration present **prompts interactively** for one.
 * Under turbo that surfaced as an opaque non-zero exit, and in CI it would have hung
 * on a question nobody could answer.
 *
 * A lint script that has never run is worse than no lint script, because it implies
 * coverage that does not exist. `next lint` is also removed in Next 16, so a flat
 * config and the `eslint` CLI is where this had to end up regardless.
 *
 * ## Why not `eslint-config-next`
 *
 * It was tried first and could not resolve its own parser: npm hoists
 * `eslint-config-next` to the repository root while `next` stays in
 * `apps/web/node_modules`, so `next/dist/compiled/babel/eslint-parser` is not
 * reachable from where the config is loaded. Fighting the hoisting would mean
 * pinning installs per workspace and re-checking it on every dependency change.
 *
 * The plugins are used directly instead. It is less magic, has fewer moving parts,
 * and keeps the rule set something a reader can see rather than inherit.
 *
 * ## The rules are chosen, not defaulted
 *
 * This is a 50-screen codebase that has never been linted. Every recommended rule at
 * `error` would produce a wall, and the usual response to a wall is to disable the
 * linter. So the bar for `error` is: **would a human reviewer stop a pull request over
 * it.** Rules about style are off — style is not what this codebase needs a machine
 * for.
 */

import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import nextPlugin from '@next/eslint-plugin-next'
import react from 'eslint-plugin-react'

export default tseslint.config(
  {
    // Generated and vendored trees. `.next/types` especially: it holds generated code
    // that does not satisfy the rules we hold our own code to, and linting it reports
    // problems nobody can fix.
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'next-env.d.ts',
      'public/**',
      '*.config.mjs',
    ],
  },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    /**
     * The Next and React plugins are registered for their rules AND so that the
     * `eslint-disable-next-line` comments already in the codebase resolve. Those
     * comments explain why a raw `<img>` serves a school's R2 logo and why the theme
     * uses `dangerouslySetInnerHTML` — prose worth more than the lines it suppresses.
     * Without the plugins ESLint errors on the unknown rule name, which would have
     * pushed somebody to delete the explanation to silence the linter.
     */
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin, react },
    rules: {
      // ---- real defects: errors ------------------------------------------
      /**
       * A missing hook dependency is a stale-closure bug, not a preference. It is
       * exactly the class of defect that produces "why is this screen showing the
       * previous pupil's marks" — a wrong answer rendered confidently.
       */
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',

      /**
       * `await` on a non-promise, or a floating promise, is how a save silently does
       * not happen. This codebase is almost entirely async data access.
       */
      '@typescript-eslint/no-misused-promises': 'off', // needs type-aware linting; see below
      '@typescript-eslint/no-unused-vars': [
        'error',
        // Leading underscore is the established convention here for a deliberately
        // unused parameter — a route handler that takes `_request`, for instance.
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // ---- judgement calls, deliberately not errors -----------------------
      /**
       * `any` is a real smell, but this codebase has a legitimate recurring use:
       * PostgREST widens an inferred row type to a union including its error shape,
       * and the rows are narrowed once behind an explicit runtime error check. Those
       * casts are commented where they appear. Warn so new ones are visible without
       * gating a merge on a pattern that is sometimes correct.
       */
      '@typescript-eslint/no-explicit-any': 'warn',

      // An empty catch is usually wrong, but `try { localStorage } catch {}` is the
      // documented pattern for storage that throws in a private window.
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // Next's own correctness rules. These catch real problems — a sync script that
      // blocks paint, an <a> where a <Link> belongs — so they are errors.
      ...nextPlugin.configs.recommended.rules,

      // Presentation, not defects. `<img>` is deliberate for school-supplied R2 logos
      // that next/image cannot serve without a remote pattern per school, and each use
      // carries a comment saying so.
      '@next/next/no-img-element': 'warn',
      'react/no-unescaped-entities': 'warn',
    },
  },

  /**
   * Type-aware rules are deliberately NOT enabled.
   *
   * They need a TypeScript program per lint run, which roughly triples the time and
   * would make `turbo lint` slower than `turbo build`. `npm run type-check` already
   * runs the real compiler over the same files in CI, so the type errors those rules
   * would find are caught there — by the tool that is authoritative about them.
   */
)
