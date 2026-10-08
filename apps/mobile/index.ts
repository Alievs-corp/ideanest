/**
 * The application's entry — `package.json`'s `main`.
 *
 * <p>Expo Router's own entry, `expo-router/entry`, preceded by the one thing that has to happen
 * before any module translates: `Intl.PluralRules` on Hermes, which ships without it
 * (`src/lib/intl-polyfill.ts` says what broke). Imports are evaluated in the order written, so the
 * polyfill is installed before Expo Router loads the root layout or a single route.
 *
 * <p>Crash reporting starts second (#165, `src/lib/crash/reporting.ts`), for the same reason: an
 * error thrown while the route tree is first evaluated is the one most worth seeing.
 *
 * <p>Nothing else belongs here. Providers, listeners and the link handler are the root layout's
 * (`src/app/_layout.tsx`), where they can be rendered and tested.
 */
import './src/lib/intl-polyfill';
import './src/lib/crash/start';
import 'expo-router/entry';
