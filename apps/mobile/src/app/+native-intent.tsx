/**
 * Expo Router's own handling of incoming links, switched off — issue #153.
 *
 * Expo Router routes every URL the operating system hands over by itself, and `_layout.tsx` also
 * routes it, through `lib/links.ts`, which checks the host and rebuilds the params. With both on,
 * a link navigated twice: `/discover?utm_source=x` opened Discover with the raw params and then a
 * second, cleaned Discover on top of it, and Back landed on the raw one. A link with no
 * destination was still routed by Expo Router, so "refused" meant nothing.
 *
 * Answering null here tells Expo Router to stay where it is, for the launch URL and for every
 * later one, so the parser in `lib/links.ts` is the only way a link moves the application. That
 * keeps its refusal real and keeps the maintenance deferral (`deferUntilUp`) in force for links.
 *
 * #165 proposed the opposite — rewriting each link here so Expo Router routes it — and it is
 * deliberately not done. This hook runs before the root layout and its app lock exist, so a link
 * rewritten here would open its screen before the lock could hold it. `_layout.tsx` routes every
 * link through `openWhenAllowed` instead (`apps/mobile/README.md`, "Deep links").
 */
export function redirectSystemPath(): null {
  return null;
}
