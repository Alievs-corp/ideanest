package az.ideanest.discovery.application;

import az.ideanest.discovery.domain.CurationAction;
import az.ideanest.discovery.infrastructure.CollectionRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.project.application.Taxonomy;
import java.time.Clock;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Curating: the only way anything in {@code collections} is ever written.
 *
 * <h2>Who may</h2>
 *
 * <p>§3.2 grants "apply an editorial badge" to moderators and admins and to nobody
 * else, and every method here is that action or a step towards it — adding a campaign
 * to a badge-granting list <em>is</em> applying a badge. There is still no role model
 * in the schema or in the access token (§10.2 says so, and epic #100 owns it), so the
 * check is {@link PlatformStaff}, which #295 turned from one configured list of addresses into
 * moderation endpoints use, empty by default, failing closed.
 *
 * <p><strong>Reused rather than reinvented.</strong> A second directory — a
 * {@code ideanest.discovery.curation.curator-emails} beside the moderation one — would
 * be a second thing epic #100 has to find and delete, and a deployment could configure
 * one and forget the other. The cost is that a deployment cannot yet let somebody
 * curate without also letting them moderate, which is a distinction §3.2 does not draw
 * either: both actions belong to the same two roles.
 *
 * <p>The check runs before anything is loaded, so a caller who is not staff learns
 * nothing about which collections exist — the same shape, and the same reasoning, as
 * {@code ProjectAccess.requireModeratable}.
 *
 * <h2>What is recorded</h2>
 *
 * <p>Every method that changes anything writes exactly one {@code curation_events}
 * row, in the same transaction as the change. That is CLAUDE.md's audit rule and it is
 * why the repository's mutations and its {@link CollectionRepository#record} are only
 * ever called from here: a write that succeeded while its audit row was rolled back
 * would be an editorial decision with nobody's name on it.
 *
 * <p>An action that changes nothing writes nothing. Adding a campaign that is already
 * in the list and removing one that is not are both no-ops, and an audit trail that
 * records attempts rather than decisions is one nobody can read.
 */
@Service
public class CurationService {

    /**
     * The role every row is written under, until there is a role model.
     *
     * <p>{@code MODERATOR} rather than {@code ADMIN}, because the interim directory is
     * a list of addresses and cannot tell the two apart, and claiming the higher of
     * two roles in an audit trail on no evidence is worse than claiming the lower.
     * V14's CHECK accepts both so that recording the distinction is an INSERT rather
     * than a migration on the day epic #100 can draw it.
     */
    private static final String ACTOR_ROLE = "MODERATOR";

    /** §5.3's shape for every slug in the schema, checked here so a bad one is a 400. */
    private static final String SLUG_SHAPE = "^[a-z0-9]+(-[a-z0-9]+)*$";

    private final CollectionRepository collections;
    private final PlatformStaff moderators;
    private final Clock clock;

    public CurationService(CollectionRepository collections, PlatformStaff moderators, Clock clock) {
        this.collections = collections;
        this.moderators = moderators;
        this.clock = clock;
    }

    // ---------------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<AdminCollection> list(UUID curatorId) {
        requireCurator(curatorId);
        return collections.findAll();
    }

    @Transactional(readOnly = true)
    public AdminCollection read(String slug, UUID curatorId) {
        requireCurator(curatorId);
        return load(slug);
    }

    // ---------------------------------------------------------------------------
    // The list itself
    // ---------------------------------------------------------------------------

    /**
     * A new, unpublished collection.
     *
     * <p>Unpublished whatever the request said, and there is no way to ask otherwise.
     * A list is assembled before it is shown, and a create call that could publish
     * would put an empty page on the platform in the same request that invented it.
     */
    @Transactional
    public AdminCollection create(String slug, CollectionDraft draft, UUID curatorId) {
        requireCurator(curatorId);
        requireSlug(slug);
        requireDraft(draft);
        if (collections.existsBySlug(slug)) {
            throw new CollectionSlugTakenException(slug);
        }
        UUID id = collections.insert(slug, draft, curatorId);
        collections.record(id, null, CurationAction.COLLECTION_CREATED, curatorId, ACTOR_ROLE, null);
        return load(slug);
    }

    /**
     * Replaces everything about the list except its slug and its publication.
     *
     * <p>See {@link CollectionDraft}: this is a {@code PUT}, so an absent window is no
     * window and an absent locale is a translation that has been removed.
     */
    @Transactional
    public AdminCollection replace(String slug, CollectionDraft draft, UUID curatorId) {
        requireCurator(curatorId);
        requireDraft(draft);
        AdminCollection existing = load(slug);
        collections.replace(existing.id(), draft);
        collections.record(existing.id(), null, CurationAction.COLLECTION_UPDATED, curatorId, ACTOR_ROLE, null);
        return load(slug);
    }

    /**
     * Makes the list visible to the public, or withdraws it.
     *
     * <p>The note is required in both directions — {@link CurationAction#requiresANote}
     * — because both are the moment the platform's own attention starts or stops being
     * directed at somebody's campaign, and a year later this row is the only place the
     * reason still exists.
     *
     * @param published true to publish, false to withdraw
     */
    @Transactional
    public AdminCollection setPublished(String slug, boolean published, String note, UUID curatorId) {
        requireCurator(curatorId);
        CurationAction action =
                published ? CurationAction.COLLECTION_PUBLISHED : CurationAction.COLLECTION_UNPUBLISHED;
        requireNote(action, note);
        AdminCollection existing = load(slug);
        if (published && existing.copy().isEmpty()) {
            // A published collection with no copy renders its slug as its heading to
            // every reader. The az rule below already guarantees copy exists on any
            // draft this service wrote, so reaching here means a row edited by hand.
            throw new CurationRejectedException("copy", "A collection cannot be published without a title.");
        }
        collections.setPublished(existing.id(), published ? clock.instant() : null);
        collections.record(existing.id(), null, action, curatorId, ACTOR_ROLE, note);
        return load(slug);
    }

    // ---------------------------------------------------------------------------
    // Membership
    // ---------------------------------------------------------------------------

    /**
     * Curates a campaign into the list, at the end of it.
     *
     * <p>At the end rather than at a caller-chosen position: a curator who wants it
     * higher reorders, which is one call that states the whole sequence and cannot
     * leave the list in an order nobody chose. The positions are sparse so that a
     * future "insert at" is one UPDATE if it is ever wanted.
     *
     * <p><strong>Any campaign may be added, including one the public cannot see.</strong>
     * A curator preparing next month's theme picks campaigns that are still in
     * moderation, and refusing them would make the feature unusable a week before every
     * launch. What protects the reader is the read, which filters by
     * {@code DiscoveryStatus.LISTED_STATES} — see {@code PostgresCuratedCollections}.
     */
    @Transactional
    public AdminCollection addProject(String slug, UUID projectId, String note, UUID curatorId) {
        requireCurator(curatorId);
        requireNote(CurationAction.PROJECT_ADDED, note);
        AdminCollection existing = load(slug);
        if (!collections.projectExists(projectId)) {
            // Named rather than left to the foreign key: a constraint violation reaches
            // the client as a 500, and a curator who pasted the wrong identifier needs
            // to be told which field is wrong.
            throw new CurationRejectedException("projectId", "There is no campaign with that identifier.");
        }
        if (collections.addProject(existing.id(), projectId, curatorId)) {
            collections.record(
                    existing.id(), projectId, CurationAction.PROJECT_ADDED, curatorId, ACTOR_ROLE, note);
        }
        return load(slug);
    }

    /** Takes a campaign out, and its badge with it if the list grants one. */
    @Transactional
    public AdminCollection removeProject(String slug, UUID projectId, String note, UUID curatorId) {
        requireCurator(curatorId);
        requireNote(CurationAction.PROJECT_REMOVED, note);
        AdminCollection existing = load(slug);
        if (collections.removeProject(existing.id(), projectId)) {
            collections.record(
                    existing.id(), projectId, CurationAction.PROJECT_REMOVED, curatorId, ACTOR_ROLE, note);
        }
        return load(slug);
    }

    /**
     * Restates the whole sequence.
     *
     * <p>The whole of it, deliberately. A "move this one to third" call has to decide
     * what happens to everything between the old position and the new one, and every
     * answer to that is a rule a curator has to learn; sending the order that is on
     * screen is the operation the interface actually performs.
     *
     * @param order every campaign currently in the collection, exactly once
     */
    @Transactional
    public AdminCollection reorder(String slug, List<UUID> order, UUID curatorId) {
        requireCurator(curatorId);
        AdminCollection existing = load(slug);

        Set<UUID> requested = new LinkedHashSet<>(order);
        if (requested.size() != order.size()) {
            throw new CurationRejectedException("projectIds", "A campaign cannot appear twice in one order.");
        }
        Set<UUID> members = new LinkedHashSet<>();
        for (AdminCollection.Member member : existing.projects()) {
            members.add(member.projectId());
        }
        if (!requested.equals(members)) {
            // A partial order would leave the campaigns it did not mention wherever
            // they happened to be, which is an order nobody chose and which differs
            // depending on what the list looked like when the screen was loaded.
            throw new CurationRejectedException(
                    "projectIds", "A reorder names every campaign in the collection, exactly once.");
        }

        collections.reposition(existing.id(), order);
        collections.record(existing.id(), null, CurationAction.PROJECTS_REORDERED, curatorId, ACTOR_ROLE, null);
        return load(slug);
    }

    // ---------------------------------------------------------------------------

    private void requireCurator(UUID accountId) {
        if (!moderators.isStaff(accountId)) {
            throw new NotAModeratorException(accountId);
        }
    }

    private AdminCollection load(String slug) {
        return collections.findBySlug(slug).orElseThrow(() -> new CollectionNotFoundException(slug));
    }

    private static void requireSlug(String slug) {
        if (slug == null || !slug.matches(SLUG_SHAPE) || slug.length() < 2 || slug.length() > 80) {
            throw new CurationRejectedException(
                    "slug", "A slug is 2 to 80 characters of lower-case letters, digits, and hyphens.");
        }
    }

    private static void requireNote(CurationAction action, String note) {
        if (action.requiresANote() && (note == null || note.isBlank())) {
            throw new CurationRejectedException(
                    "note", "Say why: " + action.name().toLowerCase(Locale.ROOT) + " changes what the "
                            + "public sees, and the note is the only record of the reason.");
        }
    }

    /**
     * The invariants V14 could not express as constraints.
     *
     * <p>The {@code az} rule is the one that matters. §21.1 makes Azerbaijani the
     * primary language, and a collection with no Azerbaijani title renders its slug as
     * a heading to the platform's largest audience. No CHECK can require that a sibling
     * row exists — V11 sets out the three ways of trying and why none of them works —
     * so it is enforced here, at the request that would violate it, which is earlier
     * and more useful than a trigger: the curator is told which field to fill in.
     */
    private static void requireDraft(CollectionDraft draft) {
        if (draft.kind() == null) {
            throw new CurationRejectedException("kind", "A collection is a staff selection, a theme, or an open call.");
        }
        if (draft.opensAt() != null && draft.closesAt() != null && !draft.closesAt().isAfter(draft.opensAt())) {
            throw new CurationRejectedException(
                    "closesAt", "A collection that closes before it opens is shown to nobody.");
        }
        for (Map.Entry<String, CollectionDraft.Copy> entry : draft.copy().entrySet()) {
            if (!Taxonomy.SUPPORTED_LOCALES.contains(entry.getKey())) {
                throw new CurationRejectedException(
                        "copy." + entry.getKey(),
                        "The platform ships " + String.join(", ", Taxonomy.SUPPORTED_LOCALES) + ".");
            }
            String title = entry.getValue() == null ? null : entry.getValue().title();
            if (title == null || title.isBlank()) {
                throw new CurationRejectedException("copy." + entry.getKey() + ".title", "A title cannot be blank.");
            }
        }
        if (!draft.copy().containsKey(Taxonomy.PRIMARY_LOCALE)) {
            throw new CurationRejectedException(
                    "copy." + Taxonomy.PRIMARY_LOCALE,
                    "Azerbaijani is the primary language (§21.1); every collection needs an az title.");
        }
    }
}
