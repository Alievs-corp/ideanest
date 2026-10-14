package az.ideanest.user.application;

import az.ideanest.user.domain.ProfileVisibility;
import java.util.List;

/**
 * The profile as the person it belongs to edits it — §4.2's P-01 to P-03 (#276).
 *
 * <p><strong>A third projection of {@code users}, and the third audience.</strong>
 * {@link UserAccount} is what another module is told in order to act; {@link PublicProfile}
 * is what a stranger is shown. This is what the owner is shown so that they can change it,
 * and the rule that keeps it apart from both is one sentence: a field is here only if the
 * owner changes it on a profile screen — {@code PATCH /v1/me/profile}'s six and P-07's
 * {@link #profileVisibility()} — plus {@link #slug()}.
 *
 * <p>That rule is what makes the omissions deliberate rather than accidental. There is no
 * email address here — {@code GET /v1/me} carries it and the endpoint that changes it is
 * §4.1's A-12, which takes a confirmation through the new mailbox because moving an address
 * is the last step of taking an account over. And there is no {@code joinedAt}, because an
 * editor does not edit it and {@code GET /v1/me} already answers what the account is.
 *
 * <p><strong>{@code profileVisibility} is read here and written elsewhere</strong>, the one
 * asymmetry in the record (#270). P-07 keeps its own path for the reason
 * {@code ProfileVisibilityController} gives at length, so the write stays there. But a switch
 * has to show its position, and until this field the only read of it was its effect: both
 * clients asked {@code GET /v1/users/{slug}} anonymously and took 200 for public and 404 for
 * private — a second request on every visit to the privacy screen, and a disabled switch
 * whenever that request failed. The owner's own setting belongs on the owner's own read.
 *
 * @param name what the person calls themselves. Writable, 1 to 80 characters, and not
 *     clearable: {@code users.name} is {@code NOT NULL} and is rendered next to every
 *     campaign this account created, so "" there is a bug rather than a choice
 * @param slug <strong>readable and not writable, and this is the field that most looks like
 *     an oversight.</strong> {@code /u/{slug}} is the public address of this profile. It is
 *     linked from every campaign page this account has published, from every follow button,
 *     and from whatever anybody else has written down. Letting somebody change it would
 *     silently break every one of those links, and the thing that would make it safe — a
 *     redirect table mapping retired slugs to their accounts, with its own uniqueness rules
 *     and its own answer to somebody claiming a slug a previous owner vacated — is not in
 *     this issue and should not be smuggled into it. It is here because an editor has to be
 *     able to show somebody their own profile URL
 * @param bio §4.2's about tab. Clearable, and bounded at 2000 characters by
 *     {@code users_bio_length}
 * @param avatarUrl the address of an already-published image. Clearable. P-01's
 *     <em>upload and crop</em> is not built and waits on §13.1's media pipeline — see
 *     {@code OwnProfileResponse}, which states exactly what this server does and does not do
 *     with the value
 * @param websiteUrl the person's own site, https only. Clearable
 * @param location one of V16's eighteen places, or null. Clearable
 * @param socialLinks P-03, in the order the owner put them. Never null: an account with no
 *     links has an empty list, because a client that has to tell a missing key from an empty
 *     array will show a spinner in place of an empty state
 * @param profileVisibility P-07: whether {@code /u/{slug}} answers anybody. Read-only here —
 *     {@code PATCH /v1/me/profile-visibility} is its write
 */
public record OwnProfile(
        String name,
        String slug,
        String bio,
        String avatarUrl,
        String websiteUrl,
        ProfileLocation location,
        List<ProfileSocialLink> socialLinks,
        ProfileVisibility profileVisibility) {

    public OwnProfile {
        socialLinks = socialLinks == null ? List.of() : List.copyOf(socialLinks);
    }
}
