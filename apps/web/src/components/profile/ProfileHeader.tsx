import Image from 'next/image';
import type { ReactNode } from 'react';
import { MediaFrame } from '@ideanest/ui/server';
import { canOptimise } from '../../lib/images/source';
import type { PublicProfile } from '../../lib/profiles/api';

/**
 * Who the profile belongs to — §4.2 P-01 and P-02, issue #274.
 *
 * <h2>It carries the identity and nothing else</h2>
 *
 * A picture, a name, a handle. The counts are on the tabs, where they say how much is behind
 * each one; repeating them here would be the same two numbers twice on one screen, and the
 * second copy is the one that goes stale when somebody adds a `count` to a tab and forgets
 * this file. The biography is on the About tab, because §4.2 gives it a tab (P-06) and a
 * header that also printed it would make that tab a duplicate of the top of the page.
 *
 * <h2>The Follow control is a slot, and Report is not here</h2>
 *
 * #143 gave the profile a Follow toggle and a Report control. The header stays a Server
 * Component and takes the toggle as `actions`, so the client island is the button and not the
 * name and picture around it. Report sits at the foot of the page, quietly, for the campaign
 * page's reason: "something is wrong here" is not the first thing to put beside a person's
 * name. Both are addressed by slug — `POST /v1/users/{slug}/report` replaced the id-keyed
 * route, because `PublicProfileResponse` deliberately carries no account id.
 *
 * <h2>The avatar is hand-rolled, which is not a preference</h2>
 *
 * `@ideanest/ui`'s `Avatar` is the component for this and it is not exported from
 * `@ideanest/ui/server` — the lean entry point a Server Component may import. Reaching for
 * the barrel instead fails `next build` outright, naming a component this page never used
 * (`packages/ui/src/server.ts` explains the split), and adding `Avatar` to that entry point
 * is a change to `packages/ui`, which this pull request does not touch. What is here is the
 * same 56-pixel profile size and the same initials fallback docs/ui-kit.md §7.6 specifies,
 * with the box reserved before the image arrives so the heading beside it does not move.
 */

/** "Jane Doe" -> "JD", the same rule `Avatar` uses. */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

export interface ProfileHeaderProps {
  readonly profile: PublicProfile;
  /**
   * The one sentence this header owns — issue #324.
   *
   * The name, the handle and the initials are the person's own and are never translated. What
   * is left is the picture's alternative text, and it is a sentence about whose face it is
   * rather than a label, so it belongs in the catalogue like any other.
   */
  readonly avatarAlt: string;
  /** Drawn beside the name — the Follow toggle (#143). Absent draws nothing. */
  readonly actions?: ReactNode;
}

export function ProfileHeader({ profile, avatarAlt, actions }: ProfileHeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-5">
      <div className="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-[var(--surface-1)]">
        {profile.avatarUrl === null ? (
          /*
            `role="img"` with a name, rather than two letters read out as text. A screen
            reader announcing "AY" where a face would be is noise; announcing the person's
            name is the information the picture would have carried.
          */
          <span
            role="img"
            aria-label={profile.name}
            className="grid size-full place-items-center bg-surface-3 text-lg font-medium text-white/64"
          >
            {initialsOf(profile.name)}
          </span>
        ) : (
          <MediaFrame ratio="1/1">
            <Image
              src={profile.avatarUrl}
              /* A content image: it is this person, and the heading beside it names them, so
                 the alt says whose picture it is rather than repeating the name alone. */
              alt={avatarAlt}
              fill
              sizes="56px"
              unoptimized={!canOptimise(profile.avatarUrl)}
              className="object-cover"
            />
          </MediaFrame>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
          {profile.name}
        </h1>
        {/* The handle is the address of this page, which is worth showing: it is what
            somebody copies when they want to point at this person. */}
        <p className="mt-1 truncate text-sm text-white/40">@{profile.slug}</p>
      </div>

      {actions !== undefined && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
