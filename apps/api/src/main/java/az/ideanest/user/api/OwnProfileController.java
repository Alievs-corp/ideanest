package az.ideanest.user.api;

import az.ideanest.user.application.ProfileEditing;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The profile editor's endpoints — §4.2's P-01 to P-03 (#276).
 *
 * <p><strong>Two named paths, and emphatically not {@code PATCH /v1/me}.</strong>
 * {@link ProfileVisibilityController} argues against a general account PATCH — "a PATCH over
 * the whole account is a surface every future field joins by default, and the first one added
 * without thinking becomes writable by anybody holding a token" — and this endpoint honours
 * that argument rather than being the feature that quietly overturns it.
 * {@code /v1/me/profile} names one thing and can only ever change that thing: the six fields
 * on {@link ProfilePatchRequest}. A column added to {@code users} next month is writable here
 * only if somebody adds it to that record on purpose.
 *
 * <p>That leaves this module with three controllers over one table plus the two account ones,
 * which is the file layout {@link PublicProfileController} defends: a public projection, an
 * owner's projection and a write do not share a class, so a public endpoint cannot acquire an
 * authenticated one's shape by being added next to it. This file is the owner's projection
 * <em>and</em> its write, together, because they are the same six fields in two directions —
 * {@code PublicProfiles} makes the same call about {@code requireVisible} and
 * {@code setVisibility} and gives the reason: a rule and the only surface that consults it
 * belong in one place.
 *
 * <h2>Authentication, and who is excluded by it</h2>
 *
 * <p>Neither path is named in {@code SecurityConfiguration}. Both therefore fall through to
 * its catch-all, which requires an authenticated caller <em>and</em> the standing an account
 * inside §17.4's deletion grace period does not have. That is the right answer and worth
 * stating, because a read looks at first like something such an account should keep: the three
 * paths a closing account may use are listed rather than derived — {@code /v1/me},
 * {@code /v1/me/export} and {@code /v1/me/deletion} — precisely so that adding an endpoint
 * never quietly adds a permission, and what a closing account would do with this one is edit a
 * page that is about to be anonymised.
 *
 * <h2>Caching</h2>
 *
 * <p>{@code no-store} on both, and no validator. This is one person's own data behind a bearer
 * token, so there is no shared cache to serve and nothing here should be written to disk by an
 * intermediary — the same policy {@code /v1/me/export} and the backer's own archive carry, for
 * the same reason. The public profile's {@code public, no-cache} is the opposite choice and
 * {@link PublicProfileController} explains why it can afford to be.
 */
@RestController
public class OwnProfileController {

    private final ProfileEditing profiles;

    public OwnProfileController(ProfileEditing profiles) {
        this.profiles = profiles;
    }

    /**
     * The caller's profile, as the editor loads it.
     *
     * @param accessToken the caller. The account is taken from our own signature and never
     *     from the path or the body, as everywhere else on this service: an endpoint that took
     *     it from the request would let anybody read — and, below, rewrite — somebody else's
     *     profile
     */
    @GetMapping("/v1/me/profile")
    public ResponseEntity<OwnProfileResponse> profile(@AuthenticationPrincipal Jwt accessToken) {
        UUID accountId = UUID.fromString(accessToken.getSubject());
        return noStore().body(OwnProfileResponse.of(profiles.forOwner(accountId)));
    }

    /**
     * Writes what the person changed, and answers the profile as it now stands.
     *
     * <p><strong>The result rather than 204</strong>, unlike P-07's switch, and
     * {@code ProfileEditing.apply} gives the difference: a visibility flip ends in exactly the
     * state the request named, and this does not — the location comes back as a slug and a
     * resolved name, text comes back trimmed, and every key the request omitted comes back
     * holding a value this client may never have seen. A 204 would make a second GET mandatory
     * after every save.
     *
     * <p>No {@code @Valid}. {@link ProfilePatchRequest} carries no constraint annotations
     * because they cannot see inside a {@code Patched}; every rule is in
     * {@code ProfileEditing}, where it also holds for callers that never came through here.
     */
    @PatchMapping("/v1/me/profile")
    public ResponseEntity<OwnProfileResponse> edit(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody ProfilePatchRequest request) {

        UUID accountId = UUID.fromString(accessToken.getSubject());
        return noStore().body(OwnProfileResponse.of(profiles.apply(accountId, request.toEdit())));
    }

    /** One policy, written once, so the read and the write cannot come to disagree about it. */
    private static ResponseEntity.BodyBuilder noStore() {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store");
    }
}
