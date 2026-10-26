package az.ideanest.user.api;

import az.ideanest.shared.Patched;
import az.ideanest.user.application.ProfileEdit;
import az.ideanest.user.application.ProfileSocialLink;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * A partial edit of the caller's own profile, with JSON Merge-Patch semantics (RFC 7396) —
 * §4.2's P-01 to P-03 (#276).
 *
 * <p>Every field is a {@link Patched}: one the client did not mention is left alone, and one
 * explicitly set to {@code null} is cleared. {@code ProjectPatchRequest} has the same shape
 * for the campaign editor, and {@link Patched} carries the argument — a profile form that
 * saved one field and let the absent keys read as "clear these" would delete somebody's
 * biography, their site and their links in a request that looks entirely ordinary in a log.
 *
 * <p>Bean validation annotations are deliberately absent, as on {@code ProjectPatchRequest}.
 * They cannot see inside a {@code Patched}, and a rule enforced here as well as in
 * {@code ProfileEditing} would be two rules that can disagree — with the service's version
 * being the one that also holds for every other caller. The lengths, the https rule and the
 * location vocabulary are checked there, and in the database beneath it.
 *
 * <p><strong>There is no {@code slug}, and no {@code email}, and no
 * {@code profileVisibility}.</strong> Each absence is a decision rather than a gap:
 * {@code OwnProfile.slug()} explains the first, §4.1's A-12 owns the second through a
 * confirmation sent to the new mailbox, and P-07 has its own path for the third. This is a
 * named endpoint over six fields, not the general {@code PATCH /v1/me} that
 * {@code ProfileVisibilityController} argues against.
 *
 * @param locationSlug one of V16's eighteen tokens — {@code baki}, {@code gence}. A slug
 *     rather than the name or an identifier: it is what the client already holds from the
 *     list it chose from, it is what {@code /discover?city=} takes, and one naming nothing is
 *     a 400 that says so rather than a field quietly dropped
 * @param socialLinks the whole list, or nothing. There is no add-one or remove-one — see
 *     {@code ProfileEdit}. An explicit {@code null} or an empty array removes every link
 */
public record ProfilePatchRequest(
        Patched<String> name,
        Patched<String> bio,
        Patched<String> avatarUrl,
        Patched<String> websiteUrl,
        Patched<String> locationSlug,
        Patched<@Size(max = 50) List<SocialLinkBody>> socialLinks) {

    public ProfilePatchRequest {
        // Absence is the neutral value, so a null component becomes absent rather than
        // "clear this field". See Patched: Jackson's absent hook already does this, and this
        // is the belt to its braces.
        name = Patched.orAbsent(name);
        bio = Patched.orAbsent(bio);
        avatarUrl = Patched.orAbsent(avatarUrl);
        websiteUrl = Patched.orAbsent(websiteUrl);
        locationSlug = Patched.orAbsent(locationSlug);
        socialLinks = Patched.orAbsent(socialLinks);
    }

    /**
     * The same edit, in the shape the application layer works in.
     *
     * <p>One conversion happens here: the wire's link records become the application's.
     * {@link Patched#map} preserves the difference between "absent" and "cleared", which is
     * what it exists for — mapping must never turn "remove my links" into "leave them alone",
     * because the person would then see a save that reported success and changed nothing.
     */
    public ProfileEdit toEdit() {
        return new ProfileEdit(
                name,
                bio,
                avatarUrl,
                websiteUrl,
                locationSlug,
                socialLinks.map(ProfilePatchRequest::toDomain));
    }

    /** A null element survives as a null, so that {@code ProfileEditing} refuses it by name. */
    private static List<ProfileSocialLink> toDomain(List<SocialLinkBody> links) {
        return links.stream()
                .map(link -> link == null ? null : link.toDomain())
                .toList();
    }
}
