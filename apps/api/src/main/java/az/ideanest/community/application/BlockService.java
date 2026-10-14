package az.ideanest.community.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.community.CommunityProperties;
import az.ideanest.community.domain.Block;
import az.ideanest.community.infrastructure.BlockRepository;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One person blocking another — #324, and App Store Review Guideline 1.2, which asks an app
 * with user-generated content for a way to block abusive users as well as to report them.
 *
 * <h2>What a block does</h2>
 *
 * <p><strong>It is about conversation, and only conversation.</strong> Once somebody blocks an
 * account:
 *
 * <ul>
 *   <li>that account's comments and replies are left out of every comment read the blocker
 *       makes — {@code CommentRepository} filters them inside the query, and a conversation the
 *       blocked account started is left out whole;
 *   <li>that account can no longer reply to the blocker's comments — {@code CommentService#reply}
 *       refuses with a 403 that does not say why.
 * </ul>
 *
 * <p>There is no mention feature on the platform, so there is no mention to refuse. Whoever
 * adds one adds the same check to it.
 *
 * <h2>What a block deliberately does not do</h2>
 *
 * <p><strong>Campaigns stay in discovery.</strong> A campaign is a public commercial listing
 * with backers' money behind it. Hiding a blocked creator's campaign would let a block distort
 * what somebody sees about a campaign they may already have pledged to — its progress, its
 * updates, whether it is in trouble — and the platform withholding facts about somebody's own
 * money is not a safety feature. Reporting stays the path for an abusive campaign.
 *
 * <p><strong>Updates stay visible</strong> on the blocked creator's own campaign, for the same
 * reason and one more: the blocker chose to open that campaign, and an update is the creator
 * accounting to backers rather than talking to anybody in particular. Campaign messages to
 * backers ({@code CampaignMessageService}) are left alone on the same grounds.
 *
 * <h2>Who may be blocked</h2>
 *
 * <p>Any account that exists and is not closed, except two. <strong>Yourself</strong>, which
 * means nothing. <strong>Platform staff</strong> — {@link PlatformStaff} distinguishes them —
 * because a moderator explaining a removal or support answering in a thread is the platform
 * speaking, and blocking them would be opting out of moderation. {@link
 * CannotBlockStaffException} says what that refusal reveals and why it is accepted.
 *
 * <h2>Private, idempotent, audited</h2>
 *
 * <p><strong>Private.</strong> The blocked account is never told: no event, no notification,
 * and nothing about a block is served to anybody but the blocker. A block that announced itself
 * would invite the retaliation it exists to stop.
 *
 * <p><strong>Idempotent</strong>, as {@link BackerSignalService}'s follow is: the insert is
 * {@code ON CONFLICT DO NOTHING}, unblocking deletes, and the endpoints answer with the
 * resulting state rather than with what this call did.
 *
 * <p><strong>Audited</strong>, which a follow is not. A block changes what another person is
 * allowed to do on the platform, and "who had blocked this account, and since when" is a
 * question a harassment complaint asks — from either side. Only the call that changed something
 * writes a row, as {@code CommentService#delete} does, so a double tap is one entry. The entity
 * is the blocked account: the trail of what has happened to an account is where an
 * investigation starts.
 */
@Service
public class BlockService {

    private final BlockRepository blocks;
    private final UserAccounts users;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final CommunityProperties properties;

    public BlockService(
            BlockRepository blocks,
            UserAccounts users,
            PlatformStaff staff,
            AuditLog audit,
            CommunityProperties properties) {

        this.blocks = blocks;
        this.users = users;
        this.staff = staff;
        this.audit = audit;
        this.properties = properties;
    }

    /**
     * Blocks an account by its identifier — what a comment carries.
     *
     * @param blockerId the authenticated caller, never a value from a request body
     * @throws BlockTargetNotFoundException when there is no such account, or it has been closed
     * @throws CannotBlockYourselfException when the identifier is the caller's
     * @throws CannotBlockStaffException when the account works for the platform
     */
    @Transactional
    public void block(UUID blockedId, UUID blockerId) {
        UserAccount target = users.findById(blockedId).orElseThrow(BlockTargetNotFoundException::new);
        blockAccount(target.id(), blockerId);
    }

    /** Blocks an account by its public slug — what a profile carries. Otherwise {@link #block}. */
    @Transactional
    public void blockBySlug(String slug, UUID blockerId) {
        blockAccount(resolve(slug), blockerId);
    }

    /**
     * Unblocks by identifier. Does nothing when the account was not blocked, which is the state
     * the caller asked for.
     *
     * <p><strong>No lookup of the account first</strong>, unlike {@link #block}: a closed
     * account is exactly one somebody may want off their list, and refusing would leave a row
     * only an administrator could remove — {@code BackerSignalService#unsave}'s argument.
     */
    @Transactional
    public void unblock(UUID blockedId, UUID blockerId) {
        if (blocks.delete(blockerId, blockedId) == 1) {
            audit.record(AuditAction.ACCOUNT_UNBLOCKED, blockedId, AuditActor.user(blockerId), AuditOutcome.SUCCEEDED);
        }
    }

    /** Unblocks by public slug. The slug has to resolve: a profile that no longer exists has no button. */
    @Transactional
    public void unblockBySlug(String slug, UUID blockerId) {
        unblock(resolve(slug), blockerId);
    }

    /** Whether this account has blocked the one at that slug — what a profile's control is drawn from. */
    @Transactional(readOnly = true)
    public boolean hasBlocked(String slug, UUID blockerId) {
        return blocks.existsByBlockerIdAndBlockedId(blockerId, resolve(slug));
    }

    /**
     * One page of the accounts this account has blocked, most recent first — {@code
     * GET /v1/me/blocks}.
     *
     * <p>One batch lookup for the names, through {@link UserAccounts#findAllById}, rather than
     * one per row. A closed account is absent from that answer and its row is left off the page;
     * the cursor still advances past it, so a closed account on a page boundary cannot stall the
     * list — {@code BackerSignalService#saved}'s rule.
     */
    @Transactional(readOnly = true)
    public BlockedAccountPage blocked(UUID blockerId, SignalCursor cursor, Integer requestedSize) {
        int size = properties.signals().pageSize(requestedSize);

        PageRequest limit = PageRequest.ofSize(size + 1);
        List<Block> rows = cursor == null
                ? blocks.page(blockerId, limit)
                : blocks.pageBefore(blockerId, cursor.at(), cursor.id(), limit);

        boolean more = rows.size() > size;
        List<Block> page = more ? rows.subList(0, size) : rows;

        Map<UUID, UserAccount> accounts = users.findAllById(page.stream().map(Block::getBlockedId).toList());
        List<BlockedAccount> items = page.stream()
                .map(row -> {
                    UserAccount account = accounts.get(row.getBlockedId());
                    return account == null ? null : BlockedAccount.of(row, account);
                })
                .filter(Objects::nonNull)
                .toList();

        Block last = page.isEmpty() ? null : page.get(page.size() - 1);
        return new BlockedAccountPage(
                items, more && last != null ? new SignalCursor(last.getCreatedAt(), last.getId()) : null);
    }

    private void blockAccount(UUID blockedId, UUID blockerId) {
        if (blockedId.equals(blockerId)) {
            throw new CannotBlockYourselfException();
        }
        if (staff.isStaff(blockedId)) {
            throw new CannotBlockStaffException();
        }
        if (blocks.insertIfAbsent(Identifiers.newIdentifier(), blockerId, blockedId) == 1) {
            // The identifiers and nothing else, as every other row in the trail: no reason was
            // asked for, and the names are on the accounts where they can be corrected.
            audit.record(AuditAction.ACCOUNT_BLOCKED, blockedId, AuditActor.user(blockerId), AuditOutcome.SUCCEEDED);
        }
    }

    /**
     * The account behind a public slug, or a 404.
     *
     * <p>Through {@link UserAccounts}, the user module's published surface, exactly as a follow
     * resolves one.
     */
    private UUID resolve(String slug) {
        return users.findBySlug(slug).map(UserAccount::id).orElseThrow(BlockTargetNotFoundException::new);
    }
}
