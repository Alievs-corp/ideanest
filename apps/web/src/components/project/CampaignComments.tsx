import { Link } from '../../i18n/navigation';
import { MessageSquareOff } from 'lucide-react';
import { Tag } from '@ideanest/ui/server';
import { formatInstant, SERVER_TIME_ZONE } from '../../lib/projects/deadline';
import type { CampaignComment, CampaignCommentPage } from '../../lib/community/comments';
import { CommentComposer } from './CommentComposer';
import { CommentControls } from './CommentControls';
import { ViewerInstant } from './ViewerClock';
import { getLocale, getTranslations } from 'next-intl/server';
import { localeOrDefault } from '../../lib/i18n/locale';
import { commentCopy, reportControlCopy } from '../../lib/i18n/shell-copy.server';

/**
 * §4.4's Comments tab — issue #285, over §4.9's C-01, C-02, C-03 and C-07.
 *
 * <h2>The list is server-rendered; only the writing is not</h2>
 *
 * The read is `permitAll` and the conversation under a campaign is public content, so it is
 * in the initial HTML like the story above it. The three client boundaries beneath this
 * component are the three things that need a session — the composer, and one control group per
 * comment — and each argues itself in its own file.
 *
 * <h2>Chronological, and the order is the service's</h2>
 *
 * §4.4 asks for a chronological thread. Nothing here sorts: the service pages by a keyset over
 * a UUID v7 that agrees with `created_at`, so re-sorting in the browser would reorder the page
 * relative to the cursor that produced it — and the first symptom would be a comment appearing
 * twice across two pages.
 *
 * <h2>The creator highlight is a flag, a word and a border — never a colour alone</h2>
 *
 * C-02 asks for the campaign's own replies to be distinguished. `byCreator` is settled by the
 * server at write time, from `ProjectAccess`, and §4.9 explains why: taken from the request
 * body it would be a claim of authority made by the side making the claim, and derived on read
 * it would silently vanish the day its author left the team.
 *
 * So the highlight reads that field, and it is drawn three ways at once: a tag that says
 * "From the campaign", a left border, and a lighter surface. docs/ui-kit.md §9.2 forbids
 * colour carrying meaning on its own, and "this answer is from the person asking for the
 * money" is precisely the kind of meaning that must not depend on being able to see a border
 * tint.
 *
 * <strong>Not lime.</strong> §2.4: lime says "act now". A creator's reply is not urgent, it is
 * authoritative, and lime here would compete with the countdown that is the one urgent thing
 * on this page.
 *
 * <h2>A withdrawn comment is a tombstone, and the row stays</h2>
 *
 * §4.9 gives three independent reasons, each sufficient: replies must not be orphaned when
 * their root goes, a moderator holding a report has to be able to read what it said, and
 * "removed" printed beside a name is an accusation published to everybody on the page. The
 * service therefore serves `body: null`, `authorId: null`, `deleted: true`, and this renders
 * that as a note in place — never as a gap, and never with the withdrawal attributed to
 * anybody.
 *
 * No controls under a tombstone. There is nothing to reply to that would not be better placed
 * under the thread, nothing to withdraw twice, and nothing left for a moderator to read if it
 * were reported.
 *
 * <h2>NOBODY IS NAMED, AND THAT IS A GAP RATHER THAN A DESIGN</h2>
 *
 * `CommentResponse` carries `authorId` — an account identifier — and no display name, no slug
 * and no avatar. The public profile read is addressed by slug (`GET /v1/users/{slug}`), so
 * there is no endpoint that turns the one into the other, and the campaign response carries
 * the creator's slug and name but not their id. This is the same shape of gap the page's own
 * comment describes about reporting the creator's account.
 *
 * The honest consequence is a thread where the campaign's replies are marked and everybody
 * else is unattributed. <strong>Nothing is invented to fill it</strong>: a byline reading
 * "Backer" would be a claim about somebody's relationship to the campaign that §4.9 says the
 * service does not currently check, and one reading "Anonymous" would be a claim they chose
 * it. Whoever adds a public name to the comment projection closes it, and this component
 * gains a byline and nothing else.
 *
 * <h2>Motion</h2>
 *
 * None. This tab reads as long content and docs/motion-system.md §8 forbids animation in it.
 */

export interface CampaignCommentsProps {
  /** `null` when the service refused — a different thing from a campaign nobody has commented on. */
  readonly page: CampaignCommentPage | null;
  readonly projectId: string;
  readonly campaignTitle: string;
  /** §10.2's canonical path for this campaign — where a sign-in returns to. */
  readonly returnTo: string;
  /** The next page of conversations, or `null`. Built by the page from the cursor. */
  readonly olderHref: string | null;
  /** True when one conversation is being read in full rather than the whole tab. */
  readonly singleThread: boolean;
  /** Back to the whole tab, when one conversation is being read. */
  readonly allThreadsHref: string;
  /** For each root, where the rest of its replies live. Keyed by the root's identifier. */
  readonly threadHrefs: Readonly<Record<string, string>>;
}

export async function CampaignComments({
  page,
  projectId,
  campaignTitle,
  returnTo,
  olderHref,
  singleThread,
  allThreadsHref,
  threadHrefs,
}: CampaignCommentsProps) {
  const t = await getTranslations('campaign.comments');
  const copy = await commentCopy();

  return (
    <section aria-labelledby="campaign-comments" className="flex flex-col gap-6">
      <h2 id="campaign-comments" className="text-xl font-medium tracking-[-0.02em] text-white">
        {t('heading')}
      </h2>

      {singleThread ? (
        <p>
          <Link
            href={allThreadsHref}
            scroll={false}
            className="rounded-sm text-sm text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            {t('all')}
          </Link>
        </p>
      ) : (
        /*
          The composer is above the list rather than below it. A tab whose write control is at
          the foot of a hundred comments is a tab where the control is unreachable on the
          surface that needs it most — and §4.9's rate limit means somebody who scrolled that
          far to find it may then be refused.
        */
        <CommentComposer
          copy={copy}
          target={{ kind: 'campaign', projectId }}
          returnTo={returnTo}
          label={copy.composerLabel}
          submitLabel={copy.postComment}
        />
      )}

      {page === null ? (
        /*
         * THE SERVICE, NOT THE CAMPAIGN. `fetchCommentThreads` answers `null` only when the
         * read was refused or could not be made. "Nobody has commented" printed over a
         * restarting service is a statement about the campaign that happens to be false.
         */
        <p className="text-sm text-white/64">
          {t('failed')}
        </p>
      ) : page.threads.length === 0 ? (
        <p className="text-sm text-white/64">{t('empty')}</p>
      ) : (
        <ol className="flex flex-col gap-6">
          {page.threads.map((thread) => (
            <li key={thread.root.id}>
              <CommentEntry
                comment={thread.root}
                campaignTitle={campaignTitle}
                returnTo={returnTo}
              />

              {(thread.replies.length > 0 || thread.nextReplyCursor !== null) && (
                <ol className="mt-3 flex flex-col gap-3 border-l border-white/8 pl-4 sm:pl-6">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentEntry
                        comment={reply}
                        campaignTitle={campaignTitle}
                        returnTo={returnTo}
                      />
                    </li>
                  ))}

                  {thread.nextReplyCursor !== null && threadHrefs[thread.root.id] !== undefined && (
                    <li>
                      <Link
                        href={threadHrefs[thread.root.id] as string}
                        scroll={false}
                        className="rounded-sm text-xs text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
                      >
                        {t('showReplies')}
                      </Link>
                    </li>
                  )}
                </ol>
              )}
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

async function CommentEntry({
  comment,
  campaignTitle,
  returnTo,
}: {
  readonly comment: CampaignComment;
  readonly campaignTitle: string;
  readonly returnTo: string;
}) {
  /*
   * Its own lookup rather than a `t` threaded down from the section above it. Both are server
   * components in the same module, so each reaching the request directly costs nothing and
   * keeps the signature about the comment rather than about where its words came from.
   */
  const t = await getTranslations('campaign.comments');
  const copy = await commentCopy();
  const serverInstant = formatInstant(
    comment.createdAt,
    SERVER_TIME_ZONE,
    localeOrDefault(await getLocale()),
  );

  if (comment.deleted) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-surface-2 px-4 py-3 text-sm text-white/40">
        <MessageSquareOff aria-hidden="true" className="size-4" />
        {/*
          NO NAME AND NO ACTOR. §4.9: author, campaign team and staff may all remove, and
          "removed" printed beside a name is an accusation published to everybody on the page.
          The tombstone says a comment was withdrawn and stops there.
        */}
        <span>{t('withdrawn')}</span>
      </div>
    );
  }

  return (
    <article
      className={
        comment.byCreator
          ? 'flex flex-col gap-2 rounded-lg border border-white/8 border-l-2 border-l-white/40 bg-surface-3 p-4'
          : 'flex flex-col gap-2 rounded-lg border border-white/8 bg-surface-2 p-4'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {comment.byCreator && (
          /*
            A WORD, not a tint. §9.2 forbids colour carrying meaning alone, and C-02's whole
            point is that a reader can tell the campaign's own answer from everybody else's.
            `default` rather than `success` or lime: this is an attribution, not a verdict and
            not an urgency.
          */
          <Tag variant="default">{t('fromCreator')}</Tag>
        )}

        {serverInstant !== null && (
          <span className="text-xs text-white/40">
            <ViewerInstant instant={comment.createdAt} serverText={serverInstant} />
          </span>
        )}
      </div>

      {/*
        `whitespace-pre-line`, never `dangerouslySetInnerHTML`. A comment body is text a
        stranger typed, it reaches this component from a public endpoint, and injecting it as
        markup would make the campaign page a cross-site scripting vector on the origin that
        holds the session cookie — the argument `CampaignStory` makes about the story document,
        and it applies here with far more force because there is no schema behind this field at
        all.
      */}
      <p className="max-w-[68ch] text-[15px] leading-relaxed whitespace-pre-line text-reading">
        {comment.body}
      </p>

      <CommentControls
        copy={copy}
        reportCopy={await reportControlCopy()}
        commentId={comment.id}
        authorId={comment.authorId}
        acceptsReplies={comment.acceptsReplies}
        returnTo={returnTo}
        campaignTitle={campaignTitle}
      />
    </article>
  );
}
