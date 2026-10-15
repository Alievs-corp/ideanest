package az.ideanest.pledgemanager;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.shared.Identifiers;
import az.ideanest.support.AbstractIntegrationTest;
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
 * What the database refuses about a parcel — V38.
 *
 * <p>Every rule here is also enforced in {@code Fulfilment} and {@code Tracking}. That
 * is not duplication, for {@code CommentSchemaTests}' reason: an application check is
 * enforced by whichever code path remembered to call it, and a constraint is enforced
 * against a migration, a support query, a bulk import, and a bug.
 *
 * <p><strong>The one that matters most is
 * {@link #aDeliveryInstantCannotOutliveTheDelivery()}.</strong> The two timestamps are
 * facts about the status rather than a second opinion about it, and the row the
 * constraint refuses — still being packed, delivered on Tuesday — is one a backer would
 * read as a delivery that did not happen.
 *
 * <p>Deliberately not {@code @Transactional}: a statement that violates a constraint
 * aborts the surrounding transaction, so each of these needs its own.
 */
class FulfilmentSchemaTests extends AbstractIntegrationTest {

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
    void clear() {
        jdbc().update("DELETE FROM fulfilments");
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM projects");
    }

    @Test
    @DisplayName("a parcel that has not shipped has no shipping instant")
    void aPreparingParcelHasNotLeft() {
        UUID pledge = pledge();

        assertThatThrownBy(() -> insert(pledge, project(pledge), "PREPARING", null, null, "now()", null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fulfilments_shipped_at_matches_status");
    }

    @Test
    @DisplayName("a shipped parcel has one")
    void aShippedParcelHasLeft() {
        UUID pledge = pledge();

        assertThatThrownBy(() -> insert(pledge, project(pledge), "SHIPPED", "DHL", "DH1", null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fulfilments_shipped_at_matches_status");
    }

    @Test
    @DisplayName("a delivery instant cannot outlive the delivery")
    void aDeliveryInstantCannotOutliveTheDelivery() {
        UUID pledge = pledge();

        assertThatThrownBy(() -> insert(pledge, project(pledge), "SHIPPED", "DHL", "DH1", "now()", "now()"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fulfilments_delivered_at_matches_status");
    }

    @Test
    @DisplayName("a tracking number cannot stand without the carrier it belongs to")
    void aTrackingNumberNamesItsCarrier() {
        UUID pledge = pledge();

        assertThatThrownBy(() -> insert(pledge, project(pledge), "SHIPPED", null, "DH1", "now()", null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fulfilments_tracking_number_names_a_carrier");
    }

    @Test
    @DisplayName("a parcel cannot be filed under a campaign that is not the pledge's")
    void aParcelBelongsToThePledgesCampaign() {
        UUID pledge = pledge();
        UUID otherCampaign = project(pledge());

        // The denormalised `project_id` is what the creator's list reads, so a row
        // able to name a different campaign than the pledge does would put one
        // campaign's parcels on another campaign's screen.
        assertThatThrownBy(() -> insert(pledge, otherCampaign, "PREPARING", null, null, null, null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fulfilments_pledge_project_fkey");
    }

    @Test
    @DisplayName("an unknown status is refused")
    void anUnknownStatusIsRefused() {
        UUID pledge = pledge();

        assertThatThrownBy(() -> insert(pledge, project(pledge), "LOST_IN_TRANSIT", null, null, "now()", null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fulfilments_status_is_known");
    }

    @Test
    @DisplayName("an http tracking link is refused")
    void anInsecureTrackingLinkIsRefused() {
        UUID pledge = pledge();

        assertThatThrownBy(() -> jdbc().update(
                        """
                        INSERT INTO fulfilments (pledge_id, project_id, status, carrier, tracking_number,
                                                 tracking_url, shipped_at)
                        VALUES (?, ?, 'SHIPPED', 'DHL', 'DH1', 'http://track.example.com/DH1', now())
                        """,
                        pledge,
                        project(pledge)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fulfilments_tracking_url_shape");
    }

    @Test
    @DisplayName("a parcel goes when its pledge does")
    void aParcelCascadesWithItsPledge() {
        UUID pledge = pledge();
        insert(pledge, project(pledge), "SHIPPED", "DHL", "DH1", "now()", null);

        assertThatCode(() -> jdbc().update("DELETE FROM pledges WHERE id = ?", pledge))
                .doesNotThrowAnyException();
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    private UUID insertUser() {
        UUID id = Identifiers.newIdentifier();
        String marker = "fulfilment-schema-" + SEQUENCE.incrementAndGet();
        jdbc().update(
                        "INSERT INTO users (id, email, name, slug) VALUES (?, ?::citext, ?, ?)",
                        id,
                        marker + "@example.com",
                        "Test Person",
                        marker);
        return id;
    }

    private UUID insertProject(UUID creatorId) {
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        "INSERT INTO projects (id, creator_id, slug, title) VALUES (?, ?, ?, ?)",
                        id,
                        creatorId,
                        "campaign-" + SEQUENCE.incrementAndGet(),
                        "A campaign");
        return id;
    }

    private UUID pledge() {
        UUID backer = insertUser();
        UUID project = insertProject(insertUser());
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, confirmed_at)
                        VALUES (?, ?, ?, 'COLLECTED', 25.00, now())
                        """,
                        id,
                        project,
                        backer);
        return id;
    }

    private UUID project(UUID pledgeId) {
        return jdbc().queryForObject("SELECT project_id FROM pledges WHERE id = ?", UUID.class, pledgeId);
    }

    private int insert(
            UUID pledgeId,
            UUID projectId,
            String status,
            String carrier,
            String trackingNumber,
            String shippedAt,
            String deliveredAt) {

        return jdbc().update(
                        """
                        INSERT INTO fulfilments (pledge_id, project_id, status, carrier, tracking_number,
                                                 shipped_at, delivered_at)
                        VALUES (?, ?, ?, ?, ?, %s, %s)
                        """
                                .formatted(shippedAt == null ? "NULL" : shippedAt, deliveredAt == null ? "NULL" : deliveredAt),
                        pledgeId,
                        projectId,
                        status,
                        carrier,
                        trackingNumber);
    }
}
