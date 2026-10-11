package az.ideanest.shared.cache;

import az.ideanest.shared.project.ProjectSummary;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * The names the web client files its cached public pages under — issue #127.
 *
 * <p>This is one half of a contract with two spellings, and the other half is
 * {@code apps/web/src/lib/cache/tags.ts}. There is no way to share it: the two live in
 * different languages in different processes, and generating one from the other would be a
 * build-time dependency between a Spring service and a Next application for six string
 * templates. So it is duplicated on purpose, the way {@code LedgerAccount} duplicates V41's
 * check constraint, and for the same reason — the rule is enforced on the far side, and this
 * is how the near side refuses to produce something the far side would reject.
 *
 * <p><strong>The web client refuses a tag it does not recognise and says which.</strong> That
 * is what makes the duplication safe to have: a tag misspelled here comes back as a 400 naming
 * it, in a log line, rather than as a page that quietly never refreshes.
 *
 * <h2>Two names for one campaign, and both are needed</h2>
 *
 * <p>The campaign's public page is read by its address, before the client knows the identifier
 * behind it, so {@code campaign:{creatorSlug}/{projectSlug}} is the only tag that read can
 * carry. Everything hanging off the campaign — its rewards, updates, comments and questions —
 * is read by identifier and carries {@code project:{id}}. An event knows the identifier, so
 * {@link #forCampaign} composes both and needs the slugs from
 * {@link az.ideanest.shared.project.ProjectSummaries} to do it.
 */
public final class CacheTags {

    /** Everything the discovery feed and the search page read. */
    public static final String DISCOVERY = "discovery";

    /** Every public legal page. Publishing a version changes the whole set at once. */
    public static final String LEGAL = "legal";

    private CacheTags() {}

    /** One campaign's dependent reads, by the identifier this service knows it as. */
    public static String project(UUID projectId) {
        return "project:" + projectId.toString().toLowerCase(Locale.ROOT);
    }

    /**
     * The campaign's public page, by the address a reader asks for it at.
     *
     * @throws IllegalArgumentException when either slug is absent. A half address is not a
     *     shorter address; it is a tag naming a page nobody has
     */
    public static String campaign(String creatorSlug, String projectSlug) {
        if (creatorSlug == null || creatorSlug.isBlank() || projectSlug == null || projectSlug.isBlank()) {
            throw new IllegalArgumentException("A campaign tag needs both slugs");
        }
        return "campaign:" + creatorSlug + "/" + projectSlug;
    }

    /**
     * Everything that goes stale when this campaign changes.
     *
     * <p>The identifier always, and the address when the summary has one. A campaign whose
     * creator row could not be joined has no public page to invalidate — {@link
     * ProjectSummary#hasPublicPath()} states that invariant — so the address is omitted rather
     * than assembled out of a null.
     *
     * <p><strong>{@link #DISCOVERY} is deliberately not in here.</strong> A pledge changes the
     * amount raised, which changes the ordering of a feed sorted by momentum, so on paper every
     * pledge on the platform invalidates every feed page — a cache that is empty at any
     * interesting traffic level, bought with a reader seeing a slightly older ordering of
     * campaigns they have not chosen yet. The feed keeps the sixty-second window both sides
     * already hold, and callers add {@code DISCOVERY} for the events that change what is
     * <em>in</em> it rather than what order it is in.
     */
    public static List<String> forCampaign(UUID projectId, ProjectSummary summary) {
        LinkedHashSet<String> tags = new LinkedHashSet<>();
        tags.add(project(projectId));

        if (summary != null && summary.hasPublicPath()) {
            tags.add(campaign(summary.creatorSlug(), summary.slug()));
        }
        return List.copyOf(tags);
    }
}
