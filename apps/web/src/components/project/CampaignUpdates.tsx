import { Link } from '../../i18n/navigation';
import { Lock } from 'lucide-react';
import { Tag } from '@ideanest/ui/server';
import { formatDay, SERVER_TIME_ZONE } from '../../lib/projects/deadline';
import type { CampaignUpdate, CampaignUpdatePage } from '../../lib/community/updates';
import { ViewerInstant } from './ViewerClock';
import { getLocale, getTranslations } from 'next-intl/server';
import { localeOrDefault } from '../../lib/i18n/locale';

/**
 * §4.4's Updates tab — issue #284, over §4.9's public update read.
 *
 * <h2>Server-rendered, like the story above it</h2>
 *
 * `GET /v1/projects/{projectId}/updates` is `permitAll`, and what it returns is the campaign
 * speaking to the people who backed it. A tab that fetched it after hydration would put that
 * behind JavaScript on the route #119 exists to keep in the initial HTML — and "update 7 said
 * the moulds were late" is exactly the kind of sentence somebody finds by searching for a
 * phrase from it.
 *
 * Nothing here is a client boundary. The one exception is the publication date, which goes
 * through `ViewerInstant` for the reason `ViewerClock` gives at length: the server cannot
 * know the reader's time zone, and that island already exists on this page for the deadline.
 *
 * <h2>The number is the service's, and this component never counts</h2>
 *
 * §4.9: the number is allocated once, at insert, behind a lock on the newest row, and never
 * recomputed — because "update 7" is a thing somebody says to support six months later.
 * `Update {n}` below prints {@link CampaignUpdate.number} and never an index into the array.
 * A `row_number()` at render time would renumber every earlier update the first time one was
 * withheld, and it would do it silently.
 *
 * <h2>Nothing is filtered here, and that is the rule rather than an omission</h2>
 *
 * §4.9 is explicit that `BACKERS_ONLY` is enforced by the service, which withholds such an
 * update from anybody outside the campaign's team. The list that arrives is already the list
 * this caller may see. <strong>A client-side filter would be a second, weaker copy of an
 * entitlement rule</strong>, and the first time the two disagreed the weaker one would decide
 * whether a private update went into public HTML.
 *
 * The badge is still rendered, because being able to see a backers-only update and knowing
 * that not everybody can are two different things — and a backer forwarding a link is
 * entitled to know which they are forwarding.
 *
 * <h2>"Comments on updates" is C-05 and is not built</h2>
 *
 * §4.4's table says updates carry comments and §4.9 lists C-05 among the things that do not
 * exist yet: there is no endpoint that would attach a comment to an update, and the comment
 * endpoints address a campaign rather than an update. So there is no comment control here.
 * One that posted to the campaign thread instead would file a reply about update 7 under the
 * campaign at large, where nobody reading update 7 would find it.
 *
 * <h2>Motion</h2>
 *
 * None. docs/motion-system.md §8 forbids animation in long content, and an update is long
 * content: a paragraph that fades in as it is scrolled past is a paragraph somebody is trying
 * to read.
 */

export interface CampaignUpdatesProps {
  /** `null` when the service refused — a different thing from a campaign with no updates. */
  readonly page: CampaignUpdatePage | null;
  /** Where the next page lives, or `null` on the last. Built by the page from the cursor. */
  readonly olderHref: string | null;
  /** True when the reader is already past the first page — see the empty state below. */
  readonly paged: boolean;
}

export async function CampaignUpdates({ page, olderHref, paged }: CampaignUpdatesProps) {
  const t = await getTranslations('campaign.updates');

  return (
    <section aria-labelledby="campaign-updates" className="flex flex-col gap-6">
      <h2 id="campaign-updates" className="text-xl font-medium tracking-[-0.02em] text-white">
        {t('heading')}
      </h2>

      {page === null ? (
        /*
         * THE SERVICE, NOT THE CAMPAIGN. `fetchProjectUpdates` answers `null` only when the
         * read was refused or could not be made, and saying "no updates yet" here would print
         * a claim about the creator over a restarting service. The rest of the page — the
         * story, the tiers, the header — rendered fine, so the page is not an error; this one
         * section is.
         */
        <p className="text-sm text-white/64">
          {t('failed')}
        </p>
      ) : page.updates.length === 0 ? (
        <p className="text-sm text-white/64">
          {paged ? t('noOlder') : t('none')}
        </p>
      ) : (
        <ol className="flex flex-col gap-6">
          {page.updates.map((update) => (
            <li key={update.number}>
              <UpdateEntry update={update} />
            </li>
          ))}
        </ol>
      )}

      {olderHref !== null && (
        <p>
          <Link
            href={olderHref}
            scroll={false}
            className="rounded-sm text-sm text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {t('older')}
          </Link>
        </p>
      )}
    </section>
  );
}

async function UpdateEntry({ update }: { readonly update: CampaignUpdate }) {
  /*
   * Its own lookup rather than a `t` threaded down from the section above it. Both are server
   * components in the same module, so each reaching the request directly costs nothing and
   * keeps the signature about the comment rather than about where its words came from.
   */
  const t = await getTranslations('campaign.updates');
  const serverDay = formatDay(
    update.publishedAt,
    SERVER_TIME_ZONE,
    localeOrDefault(await getLocale()),
  );

  return (
    <article
      aria-labelledby={`update-${update.number}`}
      className="flex flex-col gap-3 rounded-lg border border-white/8 bg-surface-2 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium tracking-[0.04em] text-white/40 uppercase">
          Update {update.number}
        </span>

        {serverDay !== null && (
          <span className="text-xs text-white/40">
            <ViewerInstant instant={update.publishedAt} serverText={serverDay} precision="day" />
          </span>
        )}

        {update.visibility === 'BACKERS_ONLY' && (
          /*
            A word AND an icon, never a colour on its own (docs/ui-kit.md §9.2). `warning`
            rather than lime: lime is "act now" (§2.4) and there is nothing to act on — this
            says who else can read the paragraph below it.
          */
          <Tag variant="warning" className="gap-1.5">
            <Lock aria-hidden="true" className="size-3" />
            {t('backersOnly')}
          </Tag>
        )}
      </div>

      <h3 id={`update-${update.number}`} className="text-base font-medium text-white">
        {update.title}
      </h3>

      {update.body !== '' && (
        /*
          `whitespace-pre-line`, never `dangerouslySetInnerHTML`. An update body is plain text
          a creator typed and it reaches this component from a public endpoint; injecting it as
          markup would make the campaign page a cross-site scripting vector on the origin that
          holds the session — which is the argument `CampaignStory` makes about the story
          document, and it applies here with less ceremony because there is no schema at all
          behind this field.
        */
        <p className="max-w-[68ch] text-[1.0625rem] leading-[1.75] whitespace-pre-line text-reading">
          {update.body}
        </p>
      )}
    </article>
  );
}
