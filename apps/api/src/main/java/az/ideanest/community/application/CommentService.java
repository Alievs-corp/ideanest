package az.ideanest.community.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.community.CommunityProperties;
import az.ideanest.community.domain.Comment;
import az.ideanest.community.domain.ReplyDepthExceededException;
import az.ideanest.community.infrastructure.BlockRepository;
import az.ideanest.community.infrastructure.CommentRepository;
import az.ideanest.project.application.CapabilityNotGrantedException;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.project.application.ProjectAccess;
import az.ideanest.project.application.ProjectNotFoundException;
import az.ideanest.project.application.PublicProjects;
import az.ideanest.shared.outbox.Outbox;
import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writing, reading and removing comments. §4.9's C-01, C-02, C-03 and CD-14.
 *
 * <h2>Who may comment, and the one thing this release cannot ask</h2>
 *
 * <p>§3.1's matrix says a comment may be written by "backers of that project and its
 * creator", and marks both Guest and User as ❌. <strong>This release enforces the
 * first half and not the second, and that is a deviation rather than an
 * oversight.</strong> What it does enforce: a signed-in account — the route sits under
 * {@code SecurityConfiguration}'s catch-all, so an anonymous caller and an account
 * inside §17.4's deletion grace period are both refused — and a campaign the caller is
 * allowed to see at all, which is {@link PublicProjects} and therefore §6.1's nine
 * public states.
 *
 * <p>What it cannot enforce is "has this account an active pledge on this campaign".
 * That is a statement about {@code pledges}, and the pledge module's application layer
 * publishes no answer to it — {@code PublicBackers} counts backers and deliberately
 * exposes none of them (#209), and {@code PledgeConflicts#activePledgeOf} is a
 * {@code REQUIRES_NEW} read that exists for one moment after a constraint violation
 * and counts a five-minute {@code DRAFT} reservation as a backing. Reaching into
 * another module's tables is what {@code ModuleBoundaryTests} exists to prevent.
 *
 * <p><strong>So this fails open where {@code ProjectUpdateService} fails closed, and
 * the asymmetry is deliberate.</strong> A backers-only update withheld from a backer
 * is a promise kept too tightly and is recoverable; showing it to the public is not. A
 * comment box open to a signed-in non-backer costs spam, which is bounded by the rate
 * limiter, reportable through the moderation module, and removable by the campaign's
 * team — while a comments tab only the creator can write in is C-01 shipped switched
 * off. Closing it is one method on the pledge module's application layer and one line
 * here, and it is called out in the pull request rather than left to be discovered.
 *
 * <h2>Where the creator highlight comes from</h2>
 *
 * <p>C-02 asks for creator replies to be visually distinguished, and
 * {@link #actingForTheCampaign} is the only place that is decided: {@link ProjectAccess}
 * is asked whether this account may act for the campaign, at the moment of the write,
 * and the answer is stored on the row. It is never read from the request — a claim of
 * authority a client could make is a claim anybody can make — and never recomputed on
 * read, because a collaborator whose grant is revoked in March still spoke for the
 * campaign in February. V25's header has the third option and why it loses.
 *
 * <h2>Authorisation is the community module's existing one, unchanged</h2>
 *
 * <p>{@code ProjectAccess#requireEditable} for "does this account act for the
 * campaign", exactly as {@code ProjectUpdateService} uses it and with the same
 * compromise: §7.2 defines a {@code RESPOND_TO_COMMENTS} capability and the
 * fine-grained form of that method takes a {@code Capability}, which lives in the
 * project module's {@code domain} package and is unreachable from here by
 * {@code ModuleBoundaryTests}. Matching the module's existing convention beats
 * inventing a second one.
 *
 * <h2>Blocks: what a reader hides, and who may answer whom</h2>
 *
 * <p>#324, and {@code BlockService} has the whole argument. Here it is two things. Every read
 * passes its reader down to {@code CommentRepository}, which leaves out the comments of anybody
 * that reader has blocked inside the query, so a page stays a page. And {@link #reply} refuses
 * somebody replying to a comment whose author has blocked them, without saying why.
 */
@Service
public class CommentService {

    /**
     * The first page's cursor: everything ordered below it, which is everything.
     *
     * <p>A value rather than a null bind, for {@code ProjectUpdateRepository#page}'s
     * reason — an untyped null is the parameter PostgreSQL declines to infer a type
     * for. The maximum UUID, because the page is descending.
     */
    private static final UUID NEWEST_FIRST = new UUID(-1L, -1L);

    /** The same, for the ascending reply page: everything above the minimum UUID. */
    private static final UUID OLDEST_FIRST = new UUID(0L, 0L);

    /**
     * The reader passed to the queries when nobody's blocks apply — a visitor, or an account
     * that has blocked nobody. The nil UUID, which no account has, so the {@code NOT EXISTS}
     * finds nothing; a value rather than a null bind, for {@link #NEWEST_FIRST}'s reason.
     */
    private static final UUID NOBODY = new UUID(0L, 0L);

    private final CommentRepository comments;
    private final CommentAuthors authors;
    private final BlockRepository blocks;
    private final ProjectAccess access;
    private final PublicProjects publicProjects;
    private final PlatformStaff moderators;
    private final AuditLog audit;
    private final Outbox outbox;
    private final CommunityProperties properties;
    private final Clock clock;

    public CommentService(
            CommentRepository comments,
            CommentAuthors authors,
            BlockRepository blocks,
            ProjectAccess access,
            PublicProjects publicProjects,
            PlatformStaff moderators,
            AuditLog audit,
            Outbox outbox,
            CommunityProperties properties,
            Clock clock) {

        this.comments = comments;
        this.authors = authors;
        this.blocks = blocks;
        this.access = access;
        this.publicProjects = publicProjects;
        this.moderators = moderators;
        this.audit = audit;
        this.outbox = outbox;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Posts a top-level comment. §10.2's {@code POST /v1/projects/{id}/comments}.
     *
     * <p>Not audited. {@code audit_logs} records privileged actions, and saying
     * something on a public page is the least privileged write on the platform — a row
     * per comment would bury the fourteen entries an investigation is looking for
     * under a million that say somebody talked. Removing <em>somebody else's</em>
     * comment is privileged, and {@link #delete} records that one.
     *
     * @param authorId the authenticated caller, never a value from a request body
     * @throws ProjectNotFoundException when there is no such campaign, and when it is
     *     not one this caller may see — deliberately the same answer
     */
    @Transactional
    public Comment post(UUID projectId, UUID authorId, String body) {
        boolean forTheCampaign = actingForTheCampaign(projectId, authorId);
        if (!forTheCampaign) {
            publicProjects.requireVisible(projectId);
        }
        return announce(comments.saveAndFlush(Comment.root(projectId, authorId, body, forTheCampaign)));
    }

    /**
     * Replies to a comment. §10.2's {@code POST /v1/comments/{id}/reply}.
     *
     * <p>The campaign is taken from the parent rather than from the caller, so a reply
     * is in its parent's conversation by construction — see {@code Comment#replyTo}.
     * The campaign is still checked: a comment on a campaign that has since been
     * suspended is not a conversation to add to, and the caller is told the comment is
     * not there rather than that the campaign is gone.
     *
     * @throws CommentNotFoundException when there is no such comment, when it has been
     *     removed, and when its campaign is not one this caller may see
     * @throws ReplyDepthExceededException when the parent is itself a reply. The rule
     *     is {@code Comment}'s and V25's; this method only carries it out
     * @throws CommentReplyNotPermittedException when the parent's author has blocked this
     *     caller — #324. Asked after visibility, so a comment the caller may not see is still
     *     simply not there
     */
    @Transactional
    public Comment reply(UUID parentId, UUID authorId, String body) {
        Comment parent = comments.findById(parentId).orElseThrow(() -> new CommentNotFoundException(parentId));
        if (parent.isDeleted()) {
            // Answering a comment that was removed would put a reply under a
            // tombstone, and on a page where the tombstone is the only context the
            // reply would be an accusation with nothing behind it.
            throw new CommentNotFoundException(parentId);
        }

        boolean forTheCampaign = actingForTheCampaign(parent.getProjectId(), authorId);
        if (!forTheCampaign) {
            requireVisibleOrNotFound(parent);
        }
        if (blocks.existsByBlockerIdAndBlockedId(parent.getAuthorId(), authorId)) {
            // Whoever wrote the parent asked not to hear from this caller. Asked of somebody
            // replying for the campaign too: a campaign's team is not owed a conversation
            // with a person who blocked one of its members.
            throw new CommentReplyNotPermittedException(parentId);
        }
        return announce(comments.saveAndFlush(Comment.replyTo(parent, authorId, body, forTheCampaign)));
    }

    /**
     * Removes a comment. §10.2's {@code DELETE /v1/comments/{id}}, and §4.7's CD-14.
     *
     * <p><strong>A tombstone, never a row removal.</strong> {@code Comment#deleteBy}
     * is the whole of it, and V25's header is why: the replies under a removed root
     * are other people's speech and are not the deleter's to take with it, and an open
     * report about this comment has to keep resolving to something a moderator can
     * read.
     *
     * <p><strong>Three people may do it, and one of them is audited.</strong> The
     * author withdrawing their own comment is not a privileged action and is not
     * recorded — it is the ordinary thing the button is for. The campaign's team
     * removing somebody else's comment (CD-14) and a platform moderator removing one
     * (AD-09) are: they are one account deleting another account's speech from a
     * public page, they are irreversible through any endpoint, and "who removed this,
     * and when" is the first question a complaint about over-moderation asks.
     *
     * <p>Deleting an already-removed comment succeeds and changes nothing, so a retry
     * and a double tap are harmless — and the audit row is written only by the call
     * that actually removed it, so a retry does not manufacture a second privileged
     * action.
     *
     * @throws CommentNotFoundException when there is no such comment
     * @throws CommentDeletionNotPermittedException when this caller is neither the
     *     author, nor on the campaign's team, nor platform staff holding
     *     {@code MODERATE_CONTENT}
     */
    @Transactional
    public Comment delete(UUID commentId, UUID actorId) {
        Comment comment = comments.findById(commentId).orElseThrow(() -> new CommentNotFoundException(commentId));

        boolean author = comment.getAuthorId().equals(actorId);
        boolean forTheCampaign = !author && actingForTheCampaign(comment.getProjectId(), actorId);
        // MODERATE_CONTENT, not "works here". This asked isStaff, which since #295 is true
        // for every role, so a partner, a curator or the finance team could take anybody's
        // speech off a public page: #574's mistake, and AD-09 puts comment removal in the same
        // queue as the campaign decisions. A question rather than requireCapability, because
        // a caller without it is refused below with the one refusal everybody else gets.
        boolean staff = !author
                && !forTheCampaign
                && moderators.capabilitiesOf(actorId).contains(StaffCapability.MODERATE_CONTENT);
        if (!author && !forTheCampaign && !staff) {
            throw new CommentDeletionNotPermittedException(commentId);
        }

        if (comment.deleteBy(actorId, clock.instant()) && !author) {
            audit.record(
                    AuditAction.PROJECT_COMMENT_REMOVED,
                    comment.getProjectId(),
                    staff ? AuditActor.moderator(actorId) : AuditActor.user(actorId),
                    AuditOutcome.SUCCEEDED,
                    // The identifiers and who acted, and deliberately not the text.
                    // AuditLog says to record what happened rather than to copy what
                    // it happened to; the text is on the `comments` row, which is
                    // exactly why that row survives a removal.
                    "comment=" + commentId + " author=" + comment.getAuthorId()
                            + " by=" + (staff ? "moderator" : "campaign"));
        }
        return comment;
    }

    /**
     * One page of a campaign's conversations, newest first, each with a preview of its
     * replies. §10.2's {@code GET /v1/projects/{id}/comments}.
     *
     * <p><strong>Two queries, whatever the campaign's size.</strong> One page of roots,
     * then one query for the replies of every root on it — see
     * {@code CommentRepository}. Nothing here loops over the page issuing queries, and
     * a change that made it do so would be the thing that takes the tab down on the
     * campaign that raised two million.
     *
     * <p>The campaign's own team is not a separate audience here, unlike the Updates
     * tab: a comment has no {@code BACKERS_ONLY} and no scheduling, so everybody who
     * may read the campaign reads the same thread. The team is still asked about
     * <em>first</em>, so that a creator can read the comments on a campaign the public
     * cannot see yet.
     *
     * @param viewerId the authenticated caller, or null. This endpoint is public. Whoever it
     *     names is not shown the comments of the accounts they blocked
     * @throws ProjectNotFoundException for a campaign that does not exist and for one
     *     that is not publicly visible, identically, to a caller not on its team
     */
    @Transactional(readOnly = true)
    public CommentPage list(UUID projectId, UUID viewerId, UUID cursor, Integer limit) {
        if (!isTeamMember(projectId, viewerId)) {
            publicProjects.requireVisible(projectId);
        }

        UUID reader = readerOf(viewerId);
        int pageSize = pageSizeOf(limit);
        List<Comment> roots = new ArrayList<>(comments.rootPage(
                projectId,
                cursor == null ? NEWEST_FIRST : cursor,
                reader,
                // One more than the page, so "is there another page" is answered by
                // the rows already read rather than by a count that could disagree.
                Limit.of(pageSize + 1)));

        UUID nextCursor = null;
        if (roots.size() > pageSize) {
            roots.removeLast();
            nextCursor = roots.getLast().getId();
        }
        boolean personal = !NOBODY.equals(reader);
        if (roots.isEmpty()) {
            // An empty IN list is not valid SQL, and there is nothing to ask about.
            return new CommentPage(List.of(), null, personal, Map.of());
        }
        return pageOf(projectId, withReplies(roots, reader), nextCursor, personal);
    }

    /**
     * One page of a single conversation's replies. {@code
     * GET /v1/projects/{id}/comments?thread=…}.
     *
     * <p>What the tab asks for when a conversation outgrew the preview
     * {@link #list} serves. A query parameter on the endpoint §10.2 names rather than a
     * route of its own, because it is the same read of the same resource with a
     * narrower question, and a second route would need a second cache policy and a
     * second security rule to keep in step with this one.
     *
     * @throws CommentNotFoundException when there is no such thread, when it is not on
     *     this campaign, and when the campaign is not one this caller may see
     */
    @Transactional(readOnly = true)
    public CommentPage thread(UUID projectId, UUID threadId, UUID viewerId, UUID cursor, Integer limit) {
        if (!isTeamMember(projectId, viewerId)) {
            publicProjects.requireVisible(projectId);
        }

        Comment root = comments.findById(threadId).orElseThrow(() -> new CommentNotFoundException(threadId));
        if (!root.isRoot() || !root.getProjectId().equals(projectId)) {
            // A reply is not a thread, and a comment under another campaign is not
            // this campaign's. Both are "no such thread here" rather than a redirect:
            // the second would confirm that the identifier names something somewhere.
            throw new CommentNotFoundException(threadId);
        }

        UUID reader = readerOf(viewerId);
        boolean personal = !NOBODY.equals(reader);
        if (personal && blocks.existsByBlockerIdAndBlockedId(reader, root.getAuthorId())) {
            // The tab leaves this conversation out for this reader, and opening it by
            // identifier answers the same: it is not there for them.
            throw new CommentNotFoundException(threadId);
        }

        int pageSize = pageSizeOf(limit);
        List<Comment> replies = new ArrayList<>(comments.threadPage(
                threadId, cursor == null ? OLDEST_FIRST : cursor, reader, Limit.of(pageSize + 1)));

        UUID nextReplyCursor = null;
        if (replies.size() > pageSize) {
            replies.removeLast();
            nextReplyCursor = replies.getLast().getId();
        }
        return pageOf(projectId, List.of(new CommentThread(root, replies, nextReplyCursor)), null, personal);
    }

    /** A page, with the names a stranger may see beside its comments (#255). */
    private CommentPage pageOf(UUID projectId, List<CommentThread> threads, UUID nextCursor, boolean personal) {
        List<Comment> all = new ArrayList<>();
        for (CommentThread thread : threads) {
            all.add(thread.root());
            all.addAll(thread.replies());
        }
        return new CommentPage(threads, nextCursor, personal, authors.on(projectId, all));
    }

    /**
     * Attaches each root's replies to it, from the single query that fetched them all.
     *
     * <p>{@code repliesPerThread + 1} are asked for per thread so that "there are more"
     * is answered by the rows in hand; the extra one is dropped here and its
     * predecessor becomes the cursor a client sends back to {@link #thread}.
     */
    private List<CommentThread> withReplies(List<Comment> roots, UUID reader) {
        int perThread = properties.comments().repliesPerThread();
        Map<UUID, List<Comment>> byThread = new LinkedHashMap<>();
        for (Comment root : roots) {
            byThread.put(root.getId(), new ArrayList<>());
        }
        for (Comment reply : comments.repliesOf(byThread.keySet(), perThread + 1, reader)) {
            byThread.get(reply.getThreadId()).add(reply);
        }

        List<CommentThread> threads = new ArrayList<>(roots.size());
        for (Comment root : roots) {
            List<Comment> replies = byThread.get(root.getId());
            UUID nextReplyCursor = null;
            if (replies.size() > perThread) {
                replies.removeLast();
                nextReplyCursor = replies.getLast().getId();
            }
            threads.add(new CommentThread(root, replies, nextReplyCursor));
        }
        return threads;
    }

    /**
     * Whose blocks the queries apply: this viewer's when they have blocked somebody, and
     * {@link #NOBODY} otherwise.
     *
     * <p>Asked once per read, so that a reader who has blocked nobody — nearly everybody — is
     * served exactly the page a visitor is, and keeps the public cache policy with it.
     */
    private UUID readerOf(UUID viewerId) {
        return viewerId != null && blocks.existsByBlockerId(viewerId) ? viewerId : NOBODY;
    }

    /**
     * Records that a comment was posted, in the transaction that wrote it — #91.
     *
     * <p>Through §8.3's outbox rather than an in-process event, for {@code Outbox}'s reason: a
     * comment that rolled back must not be one a page was told about, and a page told about a
     * comment that then vanished has no way to un-tell itself. The event and the row commit
     * together or neither does.
     *
     * <p><strong>Not audited, and the two are different questions.</strong>
     * {@link #post} says why a comment is not an audit row — it is the least privileged write on
     * the platform, and one row per comment would bury the entries an investigation is looking
     * for. This is not a record of who did what; it is a nudge to a page somebody is looking at,
     * and its only consumer is the realtime module.
     *
     * <p>Called on both write paths, so a reply moves the counter exactly as a root does — see
     * {@code CommentPostedEvent} for why they are not distinguished.
     */
    private Comment announce(Comment comment) {
        outbox.record(
                CommentPostedEvent.AGGREGATE_TYPE,
                comment.getProjectId(),
                CommentPostedEvent.EVENT_TYPE,
                CommentPostedEvent.of(comment));
        return comment;
    }

    /**
     * Whether this account is writing on the campaign's behalf — C-02's highlight.
     *
     * <p>The one place that is decided. {@link ProjectAccess} is the one place "who may
     * act on this campaign" is answered, and its refusals are turned into {@code false}
     * rather than propagated: on this path "you do not work here" is not an error, it
     * is the ordinary case that decides whether the comment is marked.
     */
    private boolean actingForTheCampaign(UUID projectId, UUID accountId) {
        if (accountId == null) {
            return false;
        }
        try {
            access.requireEditable(projectId, accountId);
            return true;
        } catch (ProjectNotFoundException | CapabilityNotGrantedException e) {
            // A stranger, a revoked collaborator, and a collaborator granted only
            // VIEW_FINANCES all land here and all comment as anybody else does.
            return false;
        }
    }

    /** The same question, named for the read paths where it decides visibility rather than a badge. */
    private boolean isTeamMember(UUID projectId, UUID accountId) {
        return actingForTheCampaign(projectId, accountId);
    }

    /**
     * Translates "you may not see that campaign" into "there is no such comment".
     *
     * <p>The caller asked about a comment, so the refusal has to be about a comment:
     * answering that the <em>campaign</em> is not visible would tell somebody holding a
     * guessed identifier that it names a comment on a campaign they cannot see, which
     * is the oracle {@code ProjectNotFoundException} exists to close.
     */
    private void requireVisibleOrNotFound(Comment comment) {
        try {
            publicProjects.requireVisible(comment.getProjectId());
        } catch (ProjectNotFoundException e) {
            throw new CommentNotFoundException(comment.getId());
        }
    }

    private int pageSizeOf(Integer limit) {
        CommunityProperties.Comments settings = properties.comments();
        if (limit == null || limit < 1) {
            return settings.defaultPageSize();
        }
        return Math.min(limit, settings.maxPageSize());
    }
}
