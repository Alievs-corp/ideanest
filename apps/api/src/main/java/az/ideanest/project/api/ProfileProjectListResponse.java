package az.ideanest.project.api;

import az.ideanest.project.application.ProfileCampaign;
import az.ideanest.project.application.ProfileCampaigns;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * One page of the campaigns on somebody's profile — §10.2's
 * {@code GET /v1/users/{slug}/projects}.
 *
 * <p><strong>{@code nextCursor} is null on the last page rather than absent or
 * empty.</strong> {@code SavedListResponse} gives the reason and it is the platform's
 * convention: a client tests one thing — is there a cursor — and the three-way distinction
 * between null, missing and {@code ""} is exactly what gets handled two ways in two
 * clients.
 *
 * <p><strong>No total.</strong> §4.2 shows a count beside each tab and this response does
 * not carry one, which is a decision rather than an oversight: {@code PublicProfiles}
 * argues it in full, and the short form is that a count over a second predicate is a number
 * that can disagree with the list underneath it, and the profile's backed tab has two
 * reasons — a suspended campaign, an anonymous pledge — for it to.
 *
 * <p><strong>Declared here and reused by the pledge module</strong>, like
 * {@link ProfileProjectCard} itself: the backed tab beside this one serves the identical
 * shape, and two records for one grid is the drift {@code SavedListResponse} and
 * {@code FollowingListResponse} were content to accept because they render different things.
 * These render the same thing.
 *
 * @param projects the cards, newest first
 * @param nextCursor the opaque value to pass back as {@code ?cursor=}, or null at the end
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProfileProjectListResponse(List<ProfileProjectCard> projects, String nextCursor) {

    /** ASCII unit separator. Cannot occur in a uuid, a slug, an amount or an instant. */
    private static final char FIELD_SEPARATOR = (char) 0x1f;

    /** ASCII record separator, so that a row boundary is not a field boundary. */
    private static final char ROW_SEPARATOR = (char) 0x1e;

    public static ProfileProjectListResponse of(ProfileCampaigns.Page page) {
        return new ProfileProjectListResponse(
                page.campaigns().stream().map(ProfileProjectCard::of).toList(),
                page.next() == null ? null : page.next().encode());
    }

    /**
     * The same shape from a list that has no cursor of its own.
     *
     * <p>The backed tab pages over {@code pledges} rather than over {@code projects}, so
     * the module that owns it builds its own cursor and hands the cards in with it. Two
     * factories rather than one that takes a nullable cursor, because the two callers are
     * paging different tables and a shared signature would hide that.
     */
    public static ProfileProjectListResponse of(List<ProfileCampaign> campaigns, String nextCursor) {
        return new ProfileProjectListResponse(
                campaigns.stream().map(ProfileProjectCard::of).toList(), nextCursor);
    }

    /**
     * A validator for this exact page, per §10.3.
     *
     * <p>Field by field, following {@code discovery.api.PublicReads}, which hashes the same
     * kind of thing: a feed of small cards, where a canonical form written beside the fields
     * is cheaper than a second serialisation and is checked by being read.
     *
     * <p><strong>{@code nextCursor} is in the digest.</strong> It has to be: two adjacent
     * pages can hold identical cards — a creator with two campaigns of the same shape, or,
     * more plainly, a reader who reloads while the list is being appended to — and a tag
     * that covered only the rows would tell one of them 304 about the other.
     *
     * <p>A digest and never {@code hashCode()}: a tag has to mean the same thing on every
     * instance and after a restart, and nothing guarantees a record's hash does.
     */
    public String etag() {
        StringBuilder canonical = new StringBuilder();
        for (ProfileProjectCard card : projects) {
            append(canonical, card.id().toString(), card.slug(), card.creatorSlug(), card.title(), card.blurb());
            append(
                    canonical,
                    card.state(),
                    card.goal() == null ? null : card.goal().amount().toPlainString(),
                    card.goal() == null ? null : card.goal().currency(),
                    card.pledged() == null ? null : card.pledged().amount().toPlainString(),
                    card.pledged() == null ? null : card.pledged().currency(),
                    String.valueOf(card.backersCount()),
                    String.valueOf(card.launchedAt()),
                    String.valueOf(card.deadline()));
            append(
                    canonical,
                    card.coverImage() == null ? null : card.coverImage().url(),
                    card.coverImage() == null ? null : String.valueOf(card.coverImage().width()),
                    card.coverImage() == null ? null : String.valueOf(card.coverImage().height()));
            append(
                    canonical,
                    card.video() == null ? null : card.video().url(),
                    card.video() == null ? null : card.video().posterUrl(),
                    card.video() == null ? null : String.valueOf(card.video().width()),
                    card.video() == null ? null : String.valueOf(card.video().height()));
        }
        append(canonical, nextCursor);

        MessageDigest sha256;
        try {
            sha256 = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            // Every JVM ships SHA-256. Reaching here is not a runtime condition.
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
        byte[] digest = sha256.digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
        return "\"" + HexFormat.of().formatHex(digest, 0, 8) + "\"";
    }

    private static void append(StringBuilder canonical, String... fields) {
        for (String field : fields) {
            canonical.append(field).append(FIELD_SEPARATOR);
        }
        canonical.append(ROW_SEPARATOR);
    }
}
