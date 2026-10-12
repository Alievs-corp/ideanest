package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.shared.Identifiers;
import az.ideanest.support.AbstractIntegrationTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * What the database refuses about a campaign.
 *
 * <p>Every rule here is also enforced in Java. That is not duplication, for the
 * reason {@code IdentitySchemaTests} gives: an application check is enforced by
 * whichever code path remembered to call it, and a constraint is enforced against a
 * migration, a support query, a bulk import, and a bug. These tables decide whether
 * a campaign can take money, and the state column decides which of §5.1's two
 * outcomes applies.
 *
 * <p>Deliberately not {@code @Transactional}: a statement that violates a constraint
 * aborts the surrounding transaction, so each of these needs its own. A
 * {@link JdbcTemplate} against an auto-committing connection gives exactly that.
 */
class ProjectSchemaTests extends AbstractIntegrationTest {

    /**
     * Distinguishes the accounts these tests create.
     *
     * <p>A counter rather than a slice of the identifier: UUID version 7 begins with
     * a millisecond timestamp, so two accounts created in the same millisecond share
     * their leading digits — and the test would fail on the unique email index for a
     * reason that has nothing to do with what it is checking.
     */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    private JdbcTemplate jdbc() {
        if (jdbc == null) {
            jdbc = new JdbcTemplate(dataSource);
        }
        return jdbc;
    }

    @AfterEach
    void clearProjects() {
        // Transitions cascade from projects, which this also exercises. The users
        // are left for the identity tests' own cleanup; projects reference them and
        // deliberately do not cascade.
        jdbc().update("DELETE FROM project_state_transitions");
        jdbc().update("DELETE FROM projects");
    }

    private UUID insertUser() {
        UUID id = Identifiers.newIdentifier();
        String marker = "schema-" + SEQUENCE.incrementAndGet();
        jdbc().update(
                        "INSERT INTO users (id, email, name, slug) VALUES (?, ?::citext, ?, ?)",
                        id,
                        marker + "@example.com",
                        "Test Creator",
                        marker);
        return id;
    }

    private UUID insertProject(UUID creatorId, String slug) {
        UUID id = Identifiers.newIdentifier();
        jdbc().update("INSERT INTO projects (id, creator_id, slug, title) VALUES (?, ?, ?, ?)", id, creatorId, slug,
                "A campaign");
        return id;
    }

    private UUID categoryId(String slug) {
        return jdbc().queryForObject("SELECT id FROM categories WHERE slug = ?", UUID.class, slug);
    }

    private UUID subcategoryId(String categorySlug, String slug) {
        return jdbc().queryForObject(
                        "SELECT s.id FROM subcategories s JOIN categories c ON c.id = s.parent_id"
                                + " WHERE c.slug = ? AND s.slug = ?",
                        UUID.class,
                        categorySlug,
                        slug);
    }

    // -----------------------------------------------------------------------
    // The seeded taxonomy
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the migration seeded a taxonomy with both names")
    void theTaxonomyIsSeeded() {
        // The editor cannot offer a category selector against an empty table, and
        // §5.3 makes a category a submission requirement.
        Integer categories = jdbc().queryForObject("SELECT count(*) FROM categories", Integer.class);
        Integer subcategories = jdbc().queryForObject("SELECT count(*) FROM subcategories", Integer.class);
        assertThat(categories).isNotNull().isPositive();
        assertThat(subcategories).isNotNull().isPositive();

        // §11.3 treats Azerbaijani and English as the two languages the platform is
        // written in. A missing name renders as a key in the navigation.
        List<String> blank = jdbc().queryForList(
                        "SELECT slug FROM categories WHERE btrim(name_az) = '' OR btrim(name_en) = ''", String.class);
        assertThat(blank).isEmpty();
    }

    @Test
    @DisplayName("a subcategory slug is unique within its parent and not globally")
    void subcategorySlugsAreScopedToTheirParent() {
        UUID games = categoryId("games");
        UUID art = categoryId("art");

        jdbc().update(
                        "INSERT INTO subcategories (id, parent_id, slug, name_az, name_en) VALUES (?, ?, 'other', 'Digər', 'Other')",
                        Identifiers.newIdentifier(),
                        games);

        // The path is /discover/{category}/{sub}, so two parents may both have an
        // "other" without either being ambiguous. Forcing global uniqueness would
        // produce slugs like "games-other" and leak them into URLs.
        assertThatCode(() -> jdbc().update(
                        "INSERT INTO subcategories (id, parent_id, slug, name_az, name_en) VALUES (?, ?, 'other', 'Digər', 'Other')",
                        Identifiers.newIdentifier(),
                        art))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> jdbc().update(
                        "INSERT INTO subcategories (id, parent_id, slug, name_az, name_en) VALUES (?, ?, 'other', 'Digər', 'Other')",
                        Identifiers.newIdentifier(),
                        games))
                .isInstanceOf(DataIntegrityViolationException.class);

        jdbc().update("DELETE FROM subcategories WHERE slug = 'other'");
    }

    // -----------------------------------------------------------------------
    // projects
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a project starts in DRAFT and an invented state is refused")
    void theStateIsFromTheKnownSet() {
        UUID projectId = insertProject(insertUser(), "a-campaign");

        assertThat(jdbc().queryForObject("SELECT state FROM projects WHERE id = ?", String.class, projectId))
                .isEqualTo("DRAFT");

        // The sixteen states of §6.1. A state nobody implemented would be a campaign
        // no transition can move and no page can render.
        assertThatThrownBy(() ->
                        jdbc().update("UPDATE projects SET state = 'PUBLISHED' WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("one creator cannot have two campaigns under one slug")
    void slugsAreUniquePerCreator() {
        UUID creator = insertUser();
        UUID other = insertUser();
        insertProject(creator, "coffee-table-book");

        // Two rows would make /projects/{creatorSlug}/{projectSlug} resolve to
        // whichever one the planner found first.
        assertThatThrownBy(() -> insertProject(creator, "coffee-table-book"))
                .isInstanceOf(DataIntegrityViolationException.class);

        // A different creator with the same idea is not a conflict.
        assertThatCode(() -> insertProject(other, "coffee-table-book")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a title outside 1-60 characters is refused")
    void titleLengthIsEnforced() {
        UUID projectId = insertProject(insertUser(), "a-campaign");

        // §5.3. Trimmed, so a title of nothing but spaces is not a title.
        assertThatThrownBy(() -> jdbc().update("UPDATE projects SET title = '   ' WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE projects SET title = ? WHERE id = ?", "t".repeat(61), projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a summary is either absent or 1-135 characters, never empty")
    void blurbLengthIsEnforced() {
        UUID projectId = insertProject(insertUser(), "a-campaign");

        // Null is a draft that has not written one. Empty is not a summary, and is
        // almost always a client sending "" for "unset".
        assertThatCode(() -> jdbc().update("UPDATE projects SET blurb = NULL WHERE id = ?", projectId))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> jdbc().update("UPDATE projects SET blurb = '' WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE projects SET blurb = ? WHERE id = ?", "b".repeat(136), projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("money is exact and a goal is more than nothing")
    void theGoalIsExactAndPositive() {
        UUID projectId = insertProject(insertUser(), "a-campaign");

        jdbc().update("UPDATE projects SET goal_amount = 5000.00 WHERE id = ?", projectId);
        BigDecimal goal =
                jdbc().queryForObject("SELECT goal_amount FROM projects WHERE id = ?", BigDecimal.class, projectId);

        // numeric(14,2), not a float. The scale comes back as it was stored, which
        // is what lets a response say "5000.00" and mean it.
        assertThat(goal).isEqualTo(new BigDecimal("5000.00"));

        // A goal of zero is met before it is announced.
        assertThatThrownBy(() -> jdbc().update("UPDATE projects SET goal_amount = 0 WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc().update("UPDATE projects SET goal_amount = -1 WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a duration outside 1-60 days is refused")
    void durationIsWithinRange() {
        UUID projectId = insertProject(insertUser(), "a-campaign");

        // The constraint keeps 1-60 days. §5.3 asks for 30-60 since #390, which the
        // application enforces: campaigns submitted earlier hold shorter durations.
        assertThatCode(() -> jdbc().update("UPDATE projects SET duration_days = 60 WHERE id = ?", projectId))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> jdbc().update("UPDATE projects SET duration_days = 61 WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc().update("UPDATE projects SET duration_days = 0 WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a subcategory has to belong to the campaign's category")
    void theSubcategoryMatchesTheCategory() {
        UUID projectId = insertProject(insertUser(), "a-campaign");
        UUID games = categoryId("games");
        UUID technology = categoryId("technology");
        UUID tabletop = subcategoryId("games", "tabletop");

        assertThatCode(() -> jdbc().update(
                        "UPDATE projects SET category_id = ?, subcategory_id = ? WHERE id = ?",
                        games,
                        tabletop,
                        projectId))
                .doesNotThrowAnyException();

        // "Tabletop games" under "Technology" would file the campaign in a facet
        // nobody browsing that category expects to find it in.
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE projects SET category_id = ?, subcategory_id = ? WHERE id = ?",
                        technology,
                        tabletop,
                        projectId))
                .isInstanceOf(DataIntegrityViolationException.class);

        // And a subcategory with no category at all is half a filing.
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE projects SET category_id = NULL, subcategory_id = ? WHERE id = ?",
                        tabletop,
                        projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a cover image is three columns or none")
    void theCoverImageIsComplete() {
        UUID projectId = insertProject(insertUser(), "a-campaign");

        assertThatCode(() -> jdbc().update(
                        "UPDATE projects SET cover_image_url = 'https://cdn.example.com/a.jpg',"
                                + " cover_image_width = 1600, cover_image_height = 900 WHERE id = ?",
                        projectId))
                .doesNotThrowAnyException();

        // Two of three set means an upload half recorded, and the checklist would
        // then read "cover image present" from a row it cannot check the size of.
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE projects SET cover_image_height = NULL WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE projects SET cover_image_width = 0 WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a campaign cannot be live without a goal, a duration, and a deadline")
    void publicStatesAreFullySpecified() {
        UUID projectId = insertProject(insertUser(), "a-campaign");

        // §5.1 resolves a campaign by comparing its total against its goal at its
        // deadline. A LIVE row missing either cannot be resolved at all, which is a
        // campaign that takes money and can never be settled.
        assertThatThrownBy(() -> jdbc().update("UPDATE projects SET state = 'LIVE' WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);

        assertThatCode(() -> jdbc().update(
                        "UPDATE projects SET state = 'LIVE', goal_amount = 5000, duration_days = 30,"
                                + " launched_at = now(), deadline = now() + interval '30 days' WHERE id = ?",
                        projectId))
                .doesNotThrowAnyException();

        // And it stays true afterwards: the goal cannot be removed from under a live
        // campaign. ProjectEditLocks refuses that with a 409 before it gets here, and
        // this is the constraint that holds against everything that is not a request.
        assertThatThrownBy(() -> jdbc().update("UPDATE projects SET goal_amount = NULL WHERE id = ?", projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a deadline cannot precede the launch")
    void theDeadlineFollowsTheLaunch() {
        UUID projectId = insertProject(insertUser(), "a-campaign");

        // Otherwise every "is this campaign still open" comparison answers no.
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE projects SET launched_at = now(), deadline = now() - interval '1 day' WHERE id = ?",
                        projectId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("updated_at moves on update and created_at does not")
    void updatedAtIsMaintainedByTheDatabase() {
        UUID projectId = insertProject(insertUser(), "a-campaign");
        Instant createdAt = timestamp("created_at", projectId);
        Instant before = timestamp("updated_at", projectId);

        jdbc().update("UPDATE projects SET risks = 'A sentence' WHERE id = ?", projectId);

        // The application never sets updated_at, so it cannot forget to — and the
        // editor's "last saved" reading is the database's, not a client's clock.
        assertThat(timestamp("updated_at", projectId)).isAfterOrEqualTo(before);
        assertThat(timestamp("created_at", projectId)).isEqualTo(createdAt);
    }

    // -----------------------------------------------------------------------
    // project_state_transitions
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a transition names a known state and actually changes something")
    void transitionsAreWellFormed() {
        UUID creator = insertUser();
        UUID projectId = insertProject(creator, "a-campaign");

        assertThatCode(() -> insertTransition(projectId, null, "DRAFT", "CREATOR", creator))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> insertTransition(projectId, "DRAFT", "PUBLISHED", "CREATOR", creator))
                .isInstanceOf(DataIntegrityViolationException.class);

        // A transition from a state to itself would record a change that did not
        // happen, and the history would stop reading as a sequence of events.
        assertThatThrownBy(() -> insertTransition(projectId, "DRAFT", "DRAFT", "CREATOR", creator))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("only the system may act without naming an actor")
    void humanDecisionsNameTheActor() {
        UUID creator = insertUser();
        UUID projectId = insertProject(creator, "a-campaign");

        // A moderation decision recorded without saying whose it was is not an audit
        // trail. This is the constraint that catches a code path which lost the
        // caller, rather than letting it write an anonymous approval.
        assertThatThrownBy(() -> insertTransition(projectId, "SUBMITTED", "APPROVED", "MODERATOR", null))
                .isInstanceOf(DataIntegrityViolationException.class);

        assertThatCode(() -> insertTransition(projectId, "LIVE", "SUCCESSFUL", "SYSTEM", null))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> insertTransition(projectId, "DRAFT", "SUBMITTED", "OWNER", creator))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("deleting a campaign takes its history with it and leaves the creator alone")
    void historyCascadesFromTheProject() {
        UUID creator = insertUser();
        UUID projectId = insertProject(creator, "a-campaign");
        insertTransition(projectId, null, "DRAFT", "CREATOR", creator);

        jdbc().update("DELETE FROM projects WHERE id = ?", projectId);

        assertThat(jdbc().queryForObject(
                        "SELECT count(*) FROM project_state_transitions WHERE project_id = ?",
                        Integer.class,
                        projectId))
                .isZero();
        // The creator is untouched: a campaign is deleted, a person is not.
        assertThat(jdbc().queryForObject("SELECT count(*) FROM users WHERE id = ?", Integer.class, creator))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("a creator with a campaign cannot be hard-deleted out from under it")
    void projectsOutliveTheirCreatorsAccount() {
        UUID creator = insertUser();
        insertProject(creator, "a-campaign");

        // Deliberate: a campaign is a financial record with other people's pledges
        // attached, and §17.4 closes an account by anonymising the person in place
        // rather than by removing the row. A cascade here would delete the campaign
        // and everything hanging off it.
        assertThatThrownBy(() -> jdbc().update("DELETE FROM users WHERE id = ?", creator))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private Instant timestamp(String column, UUID projectId) {
        return jdbc().queryForObject(
                        "SELECT " + column + " FROM projects WHERE id = ?", Instant.class, projectId);
    }

    private void insertTransition(UUID projectId, String from, String to, String role, UUID actorId) {
        jdbc().update(
                        "INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_role, actor_id)"
                                + " VALUES (?, ?, ?, ?, ?, ?)",
                        Identifiers.newIdentifier(),
                        projectId,
                        from,
                        to,
                        role,
                        actorId);
    }
}
