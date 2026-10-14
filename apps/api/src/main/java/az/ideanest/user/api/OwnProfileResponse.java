package az.ideanest.user.api;

import az.ideanest.user.application.OwnProfile;
import az.ideanest.user.domain.ProfileVisibility;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * The caller's own profile, on the wire — {@code GET /v1/me/profile} and the body
 * {@code PATCH /v1/me/profile} answers with (#276).
 *
 * <p><strong>Not {@link PublicProfileResponse}, and the difference is not the audience this
 * time.</strong> Everything here but {@code profileVisibility} is also on the public page, and
 * that one decides whether there is a public page at all. What differs is what the record is
 * <em>for</em>: this one feeds a form, so it carries the values as they are stored rather
 * than as they are rendered, and it omits {@code joinedAt} because an editor does not edit it.
 * Keeping them apart is what stops the editor's shape from deciding the public page's, which
 * is the failure {@code PublicProfile} describes from the other direction.
 *
 * <p>Nulls are written out, as on the public response and for its reason: a form that cannot
 * tell an empty field from a missing key renders a spinner where an empty input belongs.
 *
 * <h2>{@code slug} is here and is not writable</h2>
 *
 * <p>It is returned so that an editor can show somebody their own profile URL, and there is no
 * {@code slug} on {@link ProfilePatchRequest}. {@code OwnProfile.slug()} carries the argument:
 * {@code /u/{slug}} is the public address of this profile, it is linked from every campaign
 * page this account has published and from whatever anybody else has written down, and the
 * redirect table that would make changing it safe is not in this issue.
 *
 * <h2>{@code avatarUrl} is an address, and this server has never seen the image</h2>
 *
 * <p><strong>P-01 is "avatar upload and crop", and this is not that.</strong> There is no
 * uploader, no object storage and no {@code media} table — §13.1's pipeline is a different
 * epic — so what is stored here is what {@code projects.cover_image_url} already stores: the
 * address of an image that is already published somewhere else. The server does not fetch it,
 * does not measure it, does not check that it is an image, and does not check that it still
 * exists. {@code CoverImageBody} and {@code CoverImage} say the same thing about the same
 * interim, and the honest description is the one they use: this is named as a gap rather than
 * presented as a check.
 *
 * <p>The upload and the crop arrive with §13.1, at which point this becomes a reference to a
 * {@code media} row and the column is dropped in a later release.
 *
 * <h2>The URLs are user-supplied</h2>
 *
 * <p>{@link #websiteUrl} and every {@link #socialLinks} address were typed into a form by the
 * account's owner, and https is the only thing the server guarantees about them.
 * {@link PublicProfileResponse} carries the rendering contract in full —
 * {@code rel="nofollow ugc noopener noreferrer"} — and it applies here as well: a preview
 * inside the editor is a page that publishes the link too.
 *
 * @param location null for an account that has not said where it is. A patch sends
 *     {@code locationSlug}, not this record — {@link LocationBody} says why
 * @param socialLinks in the order their owner put them, empty rather than null
 * @param profileVisibility P-07's position, so the privacy screen's switch can show it without
 *     asking the public endpoint what a stranger is answered (#270). Not writable through
 *     {@code PATCH /v1/me/profile}; {@code PATCH /v1/me/profile-visibility} is its write
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record OwnProfileResponse(
        String name,
        String slug,
        String bio,
        String avatarUrl,
        String websiteUrl,
        LocationBody location,
        List<SocialLinkBody> socialLinks,
        ProfileVisibility profileVisibility) {

    public static OwnProfileResponse of(OwnProfile profile) {
        return new OwnProfileResponse(
                profile.name(),
                profile.slug(),
                profile.bio(),
                profile.avatarUrl(),
                profile.websiteUrl(),
                LocationBody.of(profile.location()),
                profile.socialLinks().stream().map(SocialLinkBody::of).toList(),
                profile.profileVisibility());
    }
}
