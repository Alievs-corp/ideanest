import { startCrashReporting } from './reporting';

/*
 * Imported for its effect by `index.ts`, straight after the polyfill and before Expo Router loads a
 * single route, so an error thrown while the route tree is being evaluated is already reported.
 */
startCrashReporting();
