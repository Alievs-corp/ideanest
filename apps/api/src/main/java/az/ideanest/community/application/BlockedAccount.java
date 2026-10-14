package az.ideanest.community.application;

import az.ideanest.community.domain.Block;
import az.ideanest.user.application.UserAccount;
import java.time.Instant;
import java.util.UUID;

/**
 * One row of {@code GET /v1/me/blocks}: an account somebody blocked, and when.
 *
 * <p><strong>The identifier is here, unlike on a public profile.</strong> It is what
 * {@code DELETE /v1/me/blocks/{userId}} takes, and this is the blocker's own list — the same
 * trade {@link FollowedCreator} makes. No address, for §17.4's reason: this is a list of other
 * people.
 *
 * @param userId the blocked account
 * @param name their display name, as it is now
 * @param slug their public path, for a link to their profile
 * @param avatarUrl their picture, or null. Already public on their profile
 * @param blockedAt when the block was made, which orders the list
 */
public record BlockedAccount(UUID userId, String name, String slug, String avatarUrl, Instant blockedAt) {

    static BlockedAccount of(Block row, UserAccount account) {
        return new BlockedAccount(account.id(), account.name(), account.slug(), account.avatarUrl(), row.getCreatedAt());
    }
}
