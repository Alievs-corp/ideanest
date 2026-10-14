package az.ideanest.community.api;

import az.ideanest.community.CommunityProperties;
import az.ideanest.community.application.BlockService;
import az.ideanest.community.application.SignalCursor;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.shared.ratelimit.RateLimits;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Blocking another account — #324, and App Store Review Guideline 1.2.
 *
 * <p><strong>Two ways to name the account, because the two places the button lives hold
 * different things.</strong> A comment carries its author's identifier and nothing else, so the
 * button under a comment uses {@code /v1/me/blocks/{userId}}. A public profile deliberately
 * carries no identifier — {@code PublicProfileResponse} argues why — so the button on a profile
 * uses {@code /v1/users/{slug}/block}, as following and reporting an account already do. Both
 * reach the same {@link BlockService}. The list in settings unblocks by identifier, because it
 * is the caller's own list and carries the identifier for exactly that.
 *
 * <p><strong>Idempotent, and each write answers with the resulting state.</strong> Blocking
 * twice is one block; unblocking somebody who is not blocked succeeds. {@link
 * BlockStateResponse} says why the answer is the state rather than what the call did.
 *
 * <p><strong>None of this is in {@code SecurityConfiguration}</strong>, so every route falls
 * through to the catch-all and needs a bearer token from an account in good standing. The
 * writes share the save-and-follow budget rather than a counter of their own, for
 * {@code BackerSignalController}'s reason; the reads are neither limited nor cached — whom
 * somebody blocked is the most private list they keep here.
 */
@RestController
public class BlockController {

    private final BlockService blocks;
    private final RateLimiter rateLimiter;
    private final CommunityProperties properties;

    public BlockController(BlockService blocks, RateLimiter rateLimiter, CommunityProperties properties) {
        this.blocks = blocks;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    /** "Block this person", from under one of their comments. */
    @PostMapping("/v1/me/blocks/{userId}")
    public BlockStateResponse add(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID userId) {
        UUID callerId = callerOf(accessToken);
        limit(callerId);
        blocks.block(userId, callerId);
        return new BlockStateResponse(true);
    }

    /** "Unblock", from the list in privacy settings. Succeeds when there was nothing to lift. */
    @DeleteMapping("/v1/me/blocks/{userId}")
    public BlockStateResponse remove(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID userId) {
        UUID callerId = callerOf(accessToken);
        limit(callerId);
        blocks.unblock(userId, callerId);
        return new BlockStateResponse(false);
    }

    /**
     * The accounts the caller has blocked, most recent first.
     *
     * @param cursor the opaque value the previous page returned, or absent for the first page
     * @param size how many rows, clamped to the configured ceiling rather than refused
     */
    @GetMapping("/v1/me/blocks")
    public BlockListResponse list(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(name = "cursor", required = false) String cursor,
            @RequestParam(name = "size", required = false) Integer size) {

        return BlockListResponse.of(blocks.blocked(callerOf(accessToken), SignalCursor.decode(cursor), size));
    }

    /** Whether the caller has blocked the account behind this profile — what its control is drawn from. */
    @GetMapping("/v1/users/{slug}/block")
    public BlockStateResponse state(@AuthenticationPrincipal Jwt accessToken, @PathVariable String slug) {
        return new BlockStateResponse(blocks.hasBlocked(slug, callerOf(accessToken)));
    }

    /** "Block this person", from their profile. */
    @PostMapping("/v1/users/{slug}/block")
    public BlockStateResponse addBySlug(@AuthenticationPrincipal Jwt accessToken, @PathVariable String slug) {
        UUID callerId = callerOf(accessToken);
        limit(callerId);
        blocks.blockBySlug(slug, callerId);
        return new BlockStateResponse(true);
    }

    /** "Unblock", from their profile. */
    @DeleteMapping("/v1/users/{slug}/block")
    public BlockStateResponse removeBySlug(@AuthenticationPrincipal Jwt accessToken, @PathVariable String slug) {
        UUID callerId = callerOf(accessToken);
        limit(callerId);
        blocks.unblockBySlug(slug, callerId);
        return new BlockStateResponse(false);
    }

    private void limit(UUID accountId) {
        CommunityProperties.Signals limits = properties.signals();
        RateLimits.enforce(
                rateLimiter.recordAttempt("signal:account:" + accountId, limits.writesPerAccount(), limits.window()));
    }

    /** The account making the request, from our own signature and never from the request. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
