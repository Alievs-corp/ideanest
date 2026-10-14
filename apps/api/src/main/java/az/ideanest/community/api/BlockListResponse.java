package az.ideanest.community.api;

import az.ideanest.community.application.BlockedAccountPage;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code GET /v1/me/blocks}: one page of the accounts the caller has blocked, for the list in
 * privacy settings with its unblock buttons.
 *
 * <p>The shape of {@link FollowingListResponse}, including its rule about {@code nextCursor}.
 *
 * @param items the accounts, most recently blocked first
 * @param nextCursor the opaque value to pass back, or null at the end of the list
 */
public record BlockListResponse(List<BlockedAccount> items, String nextCursor) {

    public static BlockListResponse of(BlockedAccountPage page) {
        return new BlockListResponse(
                page.items().stream().map(BlockedAccount::of).toList(),
                page.next() == null ? null : page.next().encode());
    }

    /**
     * One blocked account.
     *
     * <p><strong>Named for what it is rather than {@code Item}</strong>, which two other list
     * responses already use: the contract names a schema by the record's simple name, and a
     * third {@code Item} would be described by whichever of the three the generator met first.
     *
     * <p><strong>Nulls are written out</strong>, for {@code CommentResponse}'s reason: an account
     * with no picture answers {@code "avatarUrl": null} rather than leaving a client to tell a
     * missing key from an empty one.
     *
     * @param userId what {@code DELETE /v1/me/blocks/{userId}} takes
     * @param name the display name, as it is now
     * @param slug the public path, for a link to the profile
     * @param avatarUrl the picture, or null for an account without one
     * @param blockedAt when the block was made
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record BlockedAccount(UUID userId, String name, String slug, String avatarUrl, Instant blockedAt) {

        static BlockedAccount of(az.ideanest.community.application.BlockedAccount account) {
            return new BlockedAccount(
                    account.userId(), account.name(), account.slug(), account.avatarUrl(), account.blockedAt());
        }
    }
}
