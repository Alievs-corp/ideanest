import Image from 'next/image';
import { Link } from '../../i18n/navigation';
import { ArrowUpRight } from 'lucide-react';
import { formatDay, SERVER_TIME_ZONE } from '../../lib/projects/deadline';
import { canOptimise } from '../../lib/images/source';
import { profileHref, type CreatorProject, type PublicProfile } from '../../lib/projects/creatorProfile';
import type { CampaignPage } from '../../lib/projects/publicPage';
import { ViewerInstant } from './ViewerClock';
import { getLocale, getTranslations } from 'next-intl/server';
import { localeOrDefault } from '../../lib/i18n/locale';
import { FollowControl } from '../profile/FollowControl';
import { followControlCopyFrom } from '../../lib/i18n/profile-copy';

/**
 * §4.4's Creator tab — issue #282.
 *
 * <h2>Every row is a field that exists, and the missing ones are named rather than filled</h2>
 *
 * §4.4 asks this tab for "biography, history, previous projects, contact".
 * `lib/projects/creatorProfile.ts` sets out what the platform actually publishes and what it
 * does not; the short version, as it lands on the page:
 *
 * <ul>
 *   <li><strong>Biography</strong> — `bio` on `GET /v1/users/{slug}`. It arrives as an
 *       explicit `null` when the creator has written none, so an absent biography is a
 *       creator who has not written one and never a value still in flight. The row is
 *       omitted; a box saying "This creator has not written a biography" would put a small
 *       accusation on the page of everybody who has not got round to it.
 *   <li><strong>Previous projects</strong> — `GET /v1/users/{slug}/projects`, minus the
 *       campaign being read.
 *   <li><strong>History as a figure</strong> — not published, and structurally so: counting a
 *       creator's campaigns inside the `user` module would give it a dependency on `project`
 *       and `pledge` that the module-boundary test refuses. <strong>Nothing here prints a
 *       total.</strong> The list below is capped, so a count taken from its length would
 *       understate a prolific creator, and a count taken from nowhere would be invented.
 *   <li><strong>Contact</strong> — there is no endpoint. §4.9's C-12 is half built: a creator
 *       can message their backers and the reply half does not exist, so this page has nothing
 *       that would carry a message to this creator. No control is offered, because a contact
 *       control that opens a mail client the platform knows nothing about is the platform
 *       pretending to have a feature.
 * </ul>
 *
 * <h2>A private or missing profile degrades to the byline</h2>
 *
 * `GET /v1/users/{slug}` answers 404 — never 403 — for an unknown slug, a deleted account and
 * an account that has chosen `PRIVATE`. The three are indistinguishable on purpose: a 403
 * would confirm that a given handle belongs to somebody who has chosen not to be listed.
 *
 * So a `null` profile renders the creator's name and avatar from the campaign response, which
 * is the same byline the header already shows, and <strong>no profile link and no
 * explanation</strong>. "This creator's profile is private" would rebuild in the interface
 * exactly the oracle the 404 exists to close.
 *
 * <h2>Why the discovery card is not reused for the project list</h2>
 *
 * `components/discovery/ProjectCard` renders the feed's projection, which carries a
 * `completionPercent` the service computes and a `badge` from §4.3's five status words.
 * `ProfileProjectCard` has neither. Mapping one to the other would mean computing a
 * percentage here and inventing a badge — a second implementation of both, on a tab, where
 * the first disagreement would be visible as one campaign showing two different completion
 * figures on two pages. A compact row is the honest shape for what this endpoint sends.
 *
 * <h2>Follow — #143</h2>
 *
 * `FollowControl` sits under the creator's name. It is addressed by the campaign's
 * `creator.slug`, which is there even when the profile is private, so a reader can follow the
 * person whose campaign they are reading either way — following says nothing about whether a
 * profile is public, and the control draws the same in both cases. It is the tab's one new
 * client boundary: the owner sees nothing, a visitor sees a sign-in link, and everybody else
 * the toggle.
 *
 * <h2>Motion</h2>
 *
 * None. `ViewerInstant` and `FollowControl` are the tab's client boundaries, and neither
 * animates.
 */

/** The nine public states, as a word rather than the enum. Only the ones this tab can meet. */
const STATE_WORDS: Partial<Record<CreatorProject['state'], string>> = {
  PRELAUNCH: 'Coming soon',
  LIVE: 'Live',
  SUCCESSFUL: 'Funded',
  COLLECTING: 'Funded',
  LATE_PLEDGE: 'Late pledges open',
  FULFILLING: 'Fulfilling',
  COMPLETED: 'Completed',
  UNSUCCESSFUL: 'Did not fund',
  CANCELED: 'Cancelled',
};

export interface CreatorPanelProps {
  readonly campaign: CampaignPage;
  /** `null` when the profile could not be read — see the class comment on what that means. */
  readonly profile: PublicProfile | null;
  /** The creator's other public campaigns, already trimmed of the one being read. */
  readonly projects: readonly CreatorProject[];
  /** Where the Follow control's sign-in returns to — this tab's own address. */
  readonly returnTo: string;
}

export async function CreatorPanel({ campaign, profile, projects, returnTo }: CreatorPanelProps) {
  const locale = localeOrDefault(await getLocale());
  const t = await getTranslations('campaign.creator');
  const followCopy = followControlCopyFrom(await getTranslations('profile'));

  /*
   * The campaign's own creator fields are the fallback, not the profile's. They came with the
   * page and are true whatever the profile endpoint says, so a creator whose profile is
   * private still has a name and a face beside the campaign they made.
   */
  const name = profile?.name ?? campaign.creator.name;
  const avatarUrl = profile?.avatarUrl ?? campaign.creator.avatarUrl;

  const joinedServerText =
    profile?.joinedAt == null ? null : formatDay(profile.joinedAt, SERVER_TIME_ZONE, locale);

  return (
    <section aria-labelledby="campaign-creator" className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h2 id="campaign-creator" className="text-xl font-medium tracking-[-0.02em] text-white">
          {t('heading')}
        </h2>

        <div className="flex items-start gap-4">
          {/*
            The avatar is decorative: the name is beside it as text, so a screen reader that
            announced the picture too would read the same person twice. An empty `alt` takes it
            out of the accessibility tree, which is the correct answer for an image whose
            content is already stated.

            `unoptimized` for an address the optimiser will not fetch, for the reason
            `CampaignMedia` gives: `next/image` raises on a URL no remote pattern matches, and
            a raised render in a Server Component takes the whole page down.
          */}
          {avatarUrl !== null && (
            <Image
              src={avatarUrl}
              alt=""
              width={56}
              height={56}
              unoptimized={!canOptimise(avatarUrl)}
              className="size-14 shrink-0 rounded-full object-cover"
            />
          )}

          <div className="flex flex-col gap-1">
            {profile === null ? (
              <p className="text-base font-medium text-white">{name}</p>
            ) : (
              <Link
                href={profileHref(profile.slug)}
                className="inline-flex items-center gap-1 rounded-sm text-base font-medium text-white underline-offset-4 hover:underline"
              >
                {name}
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link>
            )}

            {profile?.joinedAt != null && joinedServerText !== null && (
              <p className="text-sm text-white/64">
                Member since{' '}
                <ViewerInstant
                  instant={profile.joinedAt}
                  serverText={joinedServerText}
                  precision="day"
                />
              </p>
            )}

            <div className="mt-2">
              <FollowControl
                slug={campaign.creator.slug}
                name={name}
                returnTo={returnTo}
                copy={followCopy}
              />
            </div>
          </div>
        </div>

        {profile?.bio != null && (
          <p className="max-w-[68ch] text-[1.0625rem] leading-[1.75] whitespace-pre-line text-reading">
            {profile.bio}
          </p>
        )}
      </div>

      {projects.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-medium text-white">{t('others')}</h3>

          <ul className="flex flex-col gap-2">
            {projects.map((project) => {
              const word = STATE_WORDS[project.state];
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${encodeURIComponent(project.creatorSlug)}/${encodeURIComponent(project.slug)}`}
                    className="flex flex-col gap-1 rounded-lg border border-white/8 bg-surface-2 p-4 transition-colors duration-150 ease-in-out hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                  >
                    <span className="text-sm font-medium text-white">{project.title}</span>
                    {project.blurb !== null && (
                      <span className="line-clamp-2 text-sm text-white/64">{project.blurb}</span>
                    )}
                    {/*
                      The state as a word, never as a colour. §9.2: colour alone carries no
                      meaning, and "Did not fund" is exactly the fact a reader must not have to
                      infer from a hue.
                    */}
                    {word !== undefined && <span className="text-xs text-white/40">{word}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>

          {profile !== null && (
            <p className="text-sm text-white/64">
              <Link
                href={profileHref(profile.slug)}
                className="rounded-sm text-white underline-offset-4 hover:underline"
              >
                See everything {name} has made
              </Link>
            </p>
          )}
        </div>
      )}

      {/*
        NOTHING IS SAID WHEN THERE IS NOTHING TO SAY. A creator on their first campaign has no
        other campaigns, and printing "no previous projects" beside a campaign asking for money
        would turn the absence of a track record into a sentence about them. The header already
        names them; this tab adds what the platform knows and stops.
      */}
    </section>
  );
}
