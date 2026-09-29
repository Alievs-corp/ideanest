/**
 * `jest-expo`, and why this package alone in the repository is not on vitest.
 *
 * Every other workspace runs vitest, and that is still the right default. React
 * Native is the exception for a mechanical reason rather than a preference: its
 * source ships untranspiled, with Flow annotations, and the transform that
 * strips them is `babel-preset-expo` — the same one Metro uses. A runner that
 * does not go through Babel meets `import type Foo from ...` in
 * `react-native/index.js` and stops at the first import of the framework.
 * `jest-expo` is that Babel transform plus the platform mocks, maintained by the
 * people who ship the SDK.
 */
const path = require('node:path');
const preset = require('jest-expo/jest-preset');

/*
 * `jest-expo`'s pnpm allowlist, EXTENDED RATHER THAN REPLACED.
 *
 * The preset's first pattern is
 * `/node_modules/(?!(.pnpm|react-native|@react-native|expo|@expo|...))`: every
 * package it names is compiled on the way in, and everything else in
 * `node_modules` is left alone. `.pnpm` is in that list, which is what makes the
 * preset work in this repository at all.
 *
 * It stops working one directory deeper, and that is the whole bug. pnpm stores
 * a package at `node_modules/.pnpm/<name>@<version>/node_modules/<name>/`, so
 * every real file has a SECOND `/node_modules/` in its path — and the pattern is
 * unanchored. `.pnpm` satisfies the lookahead at the first one; at the second the
 * next segment is the package's own name, and for anything not in the list the
 * pattern matches and the file is skipped.
 *
 * Nothing noticed while every dependency outside the list shipped CommonJS.
 * `@shopify/flash-list` 2.3 ships ESM, so `campaign-list.test.tsx` stopped at
 * `SyntaxError: Cannot use import statement outside a module` on a line nobody
 * had touched.
 *
 * So the package is added to the preset's own allowlist rather than a
 * hand-written list replacing it — the distinction the note below is about. A
 * future dependency that ships ESM is one more name here, and the throw is what
 * turns a change in the preset's shape into a message instead of a silently
 * un-extended list.
 */
const PNPM_ALLOWLIST = '(?!(.pnpm|';
const [storePattern, ...otherPatterns] = preset.transformIgnorePatterns;

if (typeof storePattern !== 'string' || !storePattern.includes(PNPM_ALLOWLIST)) {
  throw new Error(
    "jest-expo's transformIgnorePatterns no longer begins with the pnpm-aware " +
      'allowlist that this file extends. Read the preset and rewrite the ' +
      'extension in apps/mobile/jest.config.js — do not pin jest-expo to hide it.',
  );
}

module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: [path.join(__dirname, 'jest.setup.ts')],
  /*
   * Reanimated 4 sits on `react-native-worklets`, whose entry point is a
   * `.native.ts` file that reaches straight for the native module and throws
   * outside an application. The package ships this resolver for the purpose: it
   * drops the `native` extension when resolving anything inside it, so Jest gets
   * the JavaScript half. Without it every suite that renders an animated
   * component fails at import with `Cannot read properties of undefined
   * (reading 'loadUnpackers')`, which names nothing anybody wrote.
   */
  resolver: require.resolve('react-native-worklets/jest/resolver.js'),
  /*
   * THE PRESET'S LIST, WITH ONE NAME ADDED — NOT A LIST OF OUR OWN.
   *
   * React Native and most of the Expo SDK ship untranspiled and are compiled on
   * the way in by `babel-preset-expo`. `jest-expo`'s preset already carries the
   * pattern for that AND already knows about pnpm — its list begins
   * `/node_modules/(?!(.pnpm|react-native|...`.
   *
   * A hand-written `transformIgnorePatterns` here replaces that wholesale, which
   * is what happened first: the list had to name each package, `standard-navigation`
   * had to be added when Expo Router pulled it in, and scoped packages needed a
   * `+` in the terminator because pnpm writes their directories as
   * `@react-native+jest-preset@0.86.3`. All of that was rebuilding something the
   * preset already had, and getting a different answer from it on a different
   * operating system. That is still true, and it is why the extension above adds
   * a name to the preset's pattern instead of writing a replacement for it.
   */
  transformIgnorePatterns: [
    storePattern.replace(PNPM_ALLOWLIST, `${PNPM_ALLOWLIST}@shopify|use-intl|intl-messageformat|@formatjs|`),
    ...otherPatterns,
  ],
  moduleNameMapper: {
    '^@/(.*)$': path.join(__dirname, 'src/$1'),
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}'],
};
