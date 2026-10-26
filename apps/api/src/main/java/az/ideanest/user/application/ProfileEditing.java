package az.ideanest.user.application;

import az.ideanest.shared.HttpsAddresses;
import az.ideanest.user.domain.SocialLink;
import az.ideanest.user.domain.SocialPlatform;
import az.ideanest.user.domain.User;
import az.ideanest.user.infrastructure.ProfileLocations;
import az.ideanest.user.infrastructure.SocialLinkRepository;
import az.ideanest.user.infrastructure.UserRepository;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reading and writing the owner's own profile — §4.2's P-01 to P-03 (#276).
 *
 * <p><strong>The write §4.2 said did not exist.</strong> {@code users.name}, {@code bio} and
 * {@code avatar_url} have been columns since V2 and nothing ever wrote one:
 * {@code User.setAvatarUrl} had no callers, and the only assignment to {@code bio} anywhere
 * was the {@code = null} inside {@code User.anonymise}. That absence is what §4.2's block
 * quote names as the reason the account navigation has no profile entry, and this class
 * removes it.
 *
 * <h2>Named paths, not a general account PATCH</h2>
 *
 * <p>{@code ProfileVisibilityController} argues at length against {@code PATCH /v1/me} — "a
 * PATCH over the whole account is a surface every future field joins by default, and the
 * first one added without thinking becomes writable by anybody holding a token" — and that
 * argument is honoured here rather than quietly overturned by the first feature that would
 * have found it convenient. {@code /v1/me/profile} is a <em>second named path</em>, not the
 * general endpoint: what it writes is the six fields on {@link ProfileEdit}, and a column
 * added to {@code users} tomorrow joins this surface only if somebody puts it there on
 * purpose. The address is not writable here — §4.1's A-12 owns it and takes a confirmation
 * through the new mailbox, because moving an address is the last step of taking an account
 * over. The visibility is not writable here — P-07 has its own path. Neither is the slug,
 * and {@link OwnProfile#slug()} says why at length.
 *
 * <h2>No audit row</h2>
 *
 * <p>{@code AuditLog} records privileged actions taken <em>over</em> an account, and this is
 * an account's owner editing their own page — the same position {@link PublicProfiles} takes
 * about P-07's switch and for the same reason: nothing here is destroyed on a schedule, and
 * everything is reversible by the person who did it, in the same request they did it with.
 * The deletion endpoints beside this one are audited because an appeal has to be readable
 * afterwards, and there is no appeal against having changed your own biography.
 *
 * <h2>What is refused, and why nothing is quietly fixed up</h2>
 *
 * <p>{@link ProfileFieldRejectedException} carries that argument. Every rule below is also a
 * constraint in V2 or V46; enforcing it here is what turns the answer into a 400 that names
 * the field instead of a constraint violation surfacing as a 500.
 *
 * <p><strong>A refusal anywhere in an edit undoes all of it</strong>, because the whole
 * method is one transaction and {@link ProfileFieldRejectedException} is unchecked. That
 * matters more than it looks: the alternative — validate everything first, then write — reads
 * tidier and would still have to be a transaction, since the social links are rows in another
 * table. A partial save is the outcome neither design may produce, and the transaction is what
 * actually prevents it.
 */
@Service
public class ProfileEditing {

    /**
     * §4.2's P-03 cap, per account.
     *
     * <p><strong>Here rather than as a CHECK constraint, deliberately.</strong> V46 states
     * the split: what the table enforces structurally is one row per platform, which already
     * bounds an account at the size of the vocabulary. Five is the product decision — a
     * profile listing nine channels reads as a link farm rather than as a person — and it is
     * the sort of number that changes when somebody looks at the page, which a CHECK
     * constraint would make a migration to change. The database holds the invariant that must
     * never be violated; this holds the number somebody chose.
     */
    public static final int MAX_SOCIAL_LINKS = 5;

    /** {@code users_name_length}, restated so that the refusal is a 400 rather than a 500. */
    private static final int NAME_MAX = 80;

    /** {@code users_bio_length}. V46 argues the number. */
    private static final int BIO_MAX = 2000;

    /**
     * {@code users_website_url_length} and {@code user_social_links_url_length}.
     *
     * <p>512 rather than the browser's de-facto 2048: two kilobytes of query string is a
     * payload rather than a link somebody typed, and these are rendered on to a page that has
     * to fit on a phone.
     */
    private static final int URL_MAX = 512;

    /** {@code https://} plus at least a host. Anything shorter is not an address. */
    private static final int URL_MIN = 12;

    private final UserRepository users;
    private final SocialLinkRepository socialLinks;
    private final ProfileLocations locations;

    public ProfileEditing(UserRepository users, SocialLinkRepository socialLinks, ProfileLocations locations) {
        this.users = users;
        this.socialLinks = socialLinks;
        this.locations = locations;
    }

    /**
     * The caller's own profile, in the shape they edit it.
     *
     * @throws AccountNotFoundException for a genuine token whose account is no longer there —
     *     deleted between issue and use. The token is ours and the account is not, which is
     *     404 rather than 401, the same answer {@code GET /v1/me} gives
     */
    @Transactional(readOnly = true)
    public OwnProfile forOwner(UUID accountId) {
        return toProfile(require(accountId));
    }

    /**
     * Applies a partial edit and answers the profile as it now stands.
     *
     * <p><strong>The result rather than 204</strong>, unlike P-07's switch beside it, and the
     * difference is whether the client can infer the outcome from what it sent. A visibility
     * flip ends in exactly the state the request named; this does not — the location comes
     * back as a slug <em>and</em> a resolved name, strings come back trimmed, and an absent
     * key means a stored value the client may never have held. Answering 204 would make a
     * second GET mandatory after every save.
     *
     * <p>An empty body is a successful no-op that returns the current profile. It is what a
     * form with nothing changed sends, and refusing it would make "save" fail for a reason
     * nobody could act on.
     *
     * @throws AccountNotFoundException as {@link #forOwner}
     * @throws ProfileFieldRejectedException for a value V2 or V46 would refuse one layer
     *     down, and for a {@code locationSlug} naming nothing
     */
    @Transactional
    public OwnProfile apply(UUID accountId, ProfileEdit edit) {
        User account = require(accountId);

        // Through the entity's setters rather than an UPDATE, so that the checks above are
        // the ones that run. The same reason PublicProfiles.setVisibility gives.
        edit.name().ifPresent(name -> account.setName(requiredName(name)));
        edit.bio().ifPresent(bio -> account.setBio(optionalText("bio", bio, BIO_MAX)));
        edit.avatarUrl().ifPresent(url -> account.setAvatarUrl(optionalHttpsUrl("avatarUrl", url)));
        edit.websiteUrl().ifPresent(url -> account.setWebsiteUrl(optionalHttpsUrl("websiteUrl", url)));
        edit.locationSlug().ifPresent(slug -> account.setLocationId(resolveLocation(slug)));
        edit.socialLinks().ifPresent(links -> replaceSocialLinks(accountId, links));

        return toProfile(account);
    }

    private User require(UUID accountId) {
        return users.findByIdAndDeletedAtIsNull(accountId)
                .orElseThrow(() -> new AccountNotFoundException(accountId));
    }

    private OwnProfile toProfile(User account) {
        return new OwnProfile(
                account.getName(),
                account.getSlug(),
                account.getBio(),
                account.getAvatarUrl(),
                account.getWebsiteUrl(),
                locations.findById(account.getLocationId()).orElse(null),
                socialLinksOf(account.getId()),
                account.getProfileVisibility());
    }

    /** Every link this account has, in the order its owner put them. Never null. */
    List<ProfileSocialLink> socialLinksOf(UUID accountId) {
        return socialLinks.findByUserIdOrderByPositionAsc(accountId).stream()
                .map(link -> new ProfileSocialLink(link.getPlatform(), link.getUrl()))
                .toList();
    }

    // -----------------------------------------------------------------------
    // The rules
    // -----------------------------------------------------------------------

    /**
     * §4.2's P-03, rewritten whole.
     *
     * <p>Delete-then-insert rather than a reconciliation, which is what
     * {@link ProfileEdit#socialLinks()} promises the client and what V46 argues on the table:
     * the list is at most five rows, it always arrives complete, and positions are dense, so
     * reconciling would be more code to produce the same rows. The delete is a bulk statement
     * that runs immediately rather than a load-and-remove, because Hibernate orders inserts
     * before deletes at flush and {@code user_social_links_account_platform_key} would refuse
     * a list whose platforms overlap the one being replaced — which is every ordinary edit.
     */
    private void replaceSocialLinks(UUID accountId, List<ProfileSocialLink> requested) {
        socialLinks.deleteByUserId(accountId);
        if (requested == null || requested.isEmpty()) {
            // An explicit null and an empty array both mean "I have no links". Two spellings
            // of one intention, and refusing either would be refusing a form somebody emptied.
            return;
        }
        if (requested.size() > MAX_SOCIAL_LINKS) {
            throw new ProfileFieldRejectedException(
                    "socialLinks", "A profile carries at most " + MAX_SOCIAL_LINKS + " links.");
        }

        Set<SocialPlatform> seen = EnumSet.noneOf(SocialPlatform.class);
        List<SocialLink> rows = new ArrayList<>(requested.size());
        for (int position = 0; position < requested.size(); position++) {
            ProfileSocialLink link = requested.get(position);
            if (link == null || link.platform() == null) {
                throw new ProfileFieldRejectedException("socialLinks", "Every link names a platform.");
            }
            if (!seen.add(link.platform())) {
                // The unique index refuses the same thing one layer down. Refused here so it
                // is a sentence rather than a 500, and because "two Instagram links" is a
                // mistake under every reading of it.
                throw new ProfileFieldRejectedException(
                        "socialLinks", "One link per platform. " + link.platform() + " appears twice.");
            }
            rows.add(SocialLink.of(accountId, link.platform(), requiredHttpsUrl("socialLinks", link.url()), position));
        }
        // Flushed here rather than at commit, so that the read below this method sees the new
        // rows and so that a constraint this class failed to restate surfaces inside the
        // transaction that caused it.
        socialLinks.saveAllAndFlush(rows);
    }

    /**
     * @throws ProfileFieldRejectedException when the slug names no place. Refused rather than
     *     ignored: a save that silently dropped the field would report success and leave the
     *     person to discover it on their own page later
     */
    private UUID resolveLocation(String slug) {
        if (slug == null || slug.isBlank()) {
            return null;
        }
        return locations.findBySlug(slug.trim())
                .map(ProfileLocation::id)
                .orElseThrow(() -> new ProfileFieldRejectedException(
                        "locationSlug", "There is no place called " + slug.trim() + "."));
    }

    /** {@code users.name} is {@code NOT NULL}, so this is the one field a patch cannot clear. */
    private static String requiredName(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (trimmed.isEmpty() || trimmed.length() > NAME_MAX) {
            throw new ProfileFieldRejectedException(
                    "name", "A name is between 1 and " + NAME_MAX + " characters.");
        }
        return trimmed;
    }

    /** Null, or trimmed text within the column's bound. Blank clears, as an emptied form field. */
    private static String optionalText(String field, String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() > max) {
            throw new ProfileFieldRejectedException(field, "This is longer than " + max + " characters.");
        }
        return trimmed;
    }

    /** Null, or an https address. Blank clears, for the reason above. */
    private static String optionalHttpsUrl(String field, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return requiredHttpsUrl(field, value);
    }

    /**
     * An https address, or a refusal.
     *
     * <p><strong>The scheme is the whole of one exploit.</strong> A {@code javascript:} URL
     * rendered into an {@code href} on a public profile is stored cross-site scripting, and a
     * {@code data:} one is the same trick with a different spelling. Refusing everything but
     * https closes both, and it makes the second hazard — a profile link is the cheapest spam
     * surface a platform has, because it is a free backlink on an indexable page — at least an
     * ordinary link. {@code users_website_url_is_https} and
     * {@code user_social_links_url_is_https} refuse the same values one layer down.
     *
     * <p>What is <em>not</em> checked is whether the address resolves, or is reachable, or is
     * what it claims to be. This server never fetches it — see {@code OwnProfileResponse} —
     * so the shape is the only thing that can honestly be checked, and pretending otherwise
     * would be worse than declining to.
     */
    private static String requiredHttpsUrl(String field, String value) {
        String trimmed = value == null ? "" : value.trim();
        if (!HttpsAddresses.isHttps(trimmed)) {
            throw new ProfileFieldRejectedException(field, "A link has to start with https:// and hold no spaces.");
        }
        if (trimmed.length() < URL_MIN || trimmed.length() > URL_MAX) {
            throw new ProfileFieldRejectedException(
                    field, "A link is between " + URL_MIN + " and " + URL_MAX + " characters.");
        }
        return trimmed;
    }
}
