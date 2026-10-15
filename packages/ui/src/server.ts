/**
 * The members a React Server Component may import — `@ideanest/ui/server`.
 *
 * <h2>Why a second entry point exists</h2>
 *
 * `index.ts` is a barrel, and several of the components behind it consume `createContext`,
 * `useState` or `useId`. Reaching for the barrel from a Server Component pulls every one of
 * those into the server graph, and the build refuses the route outright — "you're importing
 * a module that depends on `createContext` into a React Server Component module". That is
 * not a warning: `next build` fails, and it fails naming a component the page never used.
 *
 * Until issue 119 the answer was "do not import `@ideanest/ui` from a Server Component", which
 * `app/discover/page.tsx` says in capitals. That was livable while every campaign surface
 * was a client boundary. It stopped being livable when the campaign page became a server
 * render whose whole purpose is to put content in the HTML: marking its components
 * `'use client'` to get at a progress bar would ship the entire page to the browser to
 * render something that never changes.
 *
 * <h2>What may be in here</h2>
 *
 * **Components with no client-only dependency at all** — no hook, no context, no event
 * handler. Every one of them is a function of its props that returns markup, so it renders
 * identically on a server and in a browser and belongs in either.
 *
 * A component that acquires state stops being eligible and must be removed from this list
 * rather than marked `'use client'` in place: the directive would make it a client boundary
 * for every Server Component that imports it, silently, and the first symptom would be a
 * page whose First Load JS grew for no visible reason. `UiServerEntryTests` is what checks
 * the list rather than trusting this paragraph.
 *
 * **This is not a subset anybody has to keep in sync by hand.** Everything here is
 * re-exported from the same module `index.ts` exports it from, so a component cannot exist
 * in two versions; what differs is only which of them a given consumer may reach.
 */
export { Card, CardTitle, CardSubtitle, CardFooter, type CardProps } from './components/Card/Card';
export { Pill, type PillProps } from './components/Pill/Pill';
export { Tag, type TagProps } from './components/Tag/Tag';
export { Avatar, type AvatarProps } from './components/Avatar/Avatar';
export { ProgressBar, type ProgressBarProps } from './components/ProgressBar/ProgressBar';
/* Stateless, and needed by the server-rendered browse pages the public web epic added — the
   home page, the category landing pages and the search results all have a "nothing here"
   branch, and the alternative was three hand-written ones that would drift from the kit's.

   (The epic is deliberately not cited by number here: the design-token test reads a `#` and
   three digits in this package as a colour literal and fails the build for it.) */
export { EmptyState, type EmptyStateProps } from './components/data/EmptyState';
export { StatBlock, StatRow, type StatBlockProps } from './components/StatBlock/StatBlock';
export {
  Media,
  MediaFrame,
  MEDIA_RATIOS,
  aspectRatioOf,
  isPlaceholderUri,
  type MediaProps,
  type MediaFrameProps,
  type MediaRatio,
  type MediaRatioToken,
  type MediaRadius,
  type IntrinsicSize,
} from './components/media/Media';

export { cn } from './lib/cn';
