package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.pledge.domain.PledgeState;
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
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * What the database refuses about pledges.
 *
 * <p>Two of these carry the design. {@link #onlyOneActivePledgePerBackerPerCampaign()}
 * checks the partial unique index against {@link PledgeState#ACTIVE} rather than
 * against a copy of it, because the set in the index and the set in the enum
 * disagreeing is a bug with no symptom until a backer is either blocked from a
 * campaign they never backed or allowed to back one twice. And
 * {@link #aDraftAlwaysKnowsWhenItLapses()} is what makes "time-bounded" a property
 * of the data: a draft written without an expiry is a place held for ever, and the
 * sweep would never see it.
 *
 * <p>Every rule here is also enforced in Java. That is not duplication, for the
 * reason {@code RewardSchemaTests} gives: an application check is enforced by
 * whichever code path remembered to call it, and a constraint is enforced against a
 * migration, a support query, a bulk import, and a bug.
 *
 * <p>Deliberately not {@code @Transactional}: a statement that violates a constraint
 * aborts the surrounding transaction, so each of these needs its own. A
 * {@link JdbcTemplate} against an auto-committing connection gives exactly that,
 * which also means the {@code DEFERRABLE} reference to {@code reward_tiers} is
 * checked at the end of each statement's own implicit transaction.
 */
class PledgeSchemaTests extends AbstractIntegrationTest {

    /**
     * Distinguishes the accounts these tests create. A counter rather than a slice
     * of the identifier: UUID version 7 begins with a millisecond timestamp, so two
     * accounts created in the same millisecond would collide on the unique email
     * index for a reason that has nothing to do with what is being checked.
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
    void clearPledges() {
        // In dependency order rather than by cascade, because these tests deliberately
        // leave rows in states a cascade is being asked about elsewhere. The users are
        // left for the identity tests' own cleanup; projects reference them and
        // deliberately do not cascade.
        jdbc().update("DELETE FROM pledges");
        jdbc().update("DELETE FROM reward_tiers");
        jdbc().update("DELETE FROM project_state_transitions");
        jdbc().update("DELETE FROM projects");
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    private UUID insertUser() {
        UUID id = Identifiers.newIdentifier();
        String marker = "pledge-schema-" + SEQUENCE.incrementAndGet();
        jdbc().update(
                        "INSERT INTO users (id, email, name, slug) VALUES (?, ?::citext, ?, ?)",
                        id,
                        marker + "@example.com",
                        "Test Backer",
                        marker);
        return id;
    }

    private UUID insertProject() {
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        "INSERT INTO projects (id, creator_id, slug, title) VALUES (?, ?, ?, ?)",
                        id,
                        insertUser(),
                        "a-campaign-" + SEQUENCE.incrementAndGet(),
                        "A campaign");
        return id;
    }

    private UUID insertTier(UUID projectId) {
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        "INSERT INTO reward_tiers (id, project_id, title, amount) VALUES (?, ?, ?, ?)",
                        id,
                        projectId,
                        "A reward",
                        new BigDecimal("19.99"));
        return id;
    }

    /** A draft holding a place, expiring five minutes from now. */
    private UUID insertDraft(UUID projectId, UUID backerId, UUID rewardTierId) {
        UUID id = Identifiers.newIdentifier();
        jdbc().update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, reward_tier_id, state,
                                             base_amount, reservation_expires_at)
                        VALUES (?, ?, ?, CAST(? AS uuid), 'DRAFT', 19.99, now() + interval '5 minutes')
                        """,
                        id,
                        projectId,
                        backerId,
                        rewardTierId == null ? null : rewardTierId.toString());
        return id;
    }

    /**
     * Moves a pledge to another state, leaving its expiry alone. Clearing it would
     * fall foul of {@code pledges_drafts_are_time_bounded} on the way back through
     * DRAFT, which is a rule this fixture is not the place to argue with.
     */
    private void setState(UUID pledgeId, PledgeState state) {
        jdbc().update("UPDATE pledges SET state = ? WHERE id = ?", state.name(), pledgeId);
    }

    private int count(String table, String column, UUID value) {
        Integer count = jdbc().queryForObject(
                        "SELECT count(*) FROM " + table + " WHERE " + column + " = ?", Integer.class, value);
        return count == null ? 0 : count;
    }

    // -----------------------------------------------------------------------
    // The rules this migration exists for
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("§7.2: one pledge per backer per campaign, and only while it is active")
    void onlyOneActivePledgePerBackerPerCampaign() {
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId);
        UUID backerId = insertUser();

        UUID first = insertDraft(projectId, backerId, tierId);

        // A second live pledge would be two commitments from one person to one
        // campaign, and on a limited tier it would be two places held by somebody who
        // can only take one.
        assertThatThrownBy(() -> insertDraft(projectId, backerId, tierId))
                .isInstanceOf(DataIntegrityViolationException.class);

        // Every state, against PledgeState.ACTIVE rather than against a copy of the
        // list in the index. The two disagreeing is the failure with no symptom: a
        // backer either blocked from a campaign they never backed, or allowed to back
        // one twice.
        for (PledgeState state : PledgeState.values()) {
            setState(first, state);

            if (state.isActive()) {
                assertThatThrownBy(() -> insertDraft(projectId, backerId, tierId))
                        .withFailMessage("A second pledge was allowed while the first was %s", state)
                        .isInstanceOf(DataIntegrityViolationException.class);
            } else {
                // The commitment ended -- the reservation lapsed, somebody canceled,
                // the money went back. Blocking a second pledge after that would mean
                // an abandoned checkout costs somebody the campaign for ever.
                UUID second = insertDraft(projectId, backerId, tierId);
                jdbc().update("DELETE FROM pledges WHERE id = ?", second);
            }
        }

        // And the rule is per campaign, not per backer: the same person backing two
        // campaigns is the ordinary case.
        UUID elsewhere = insertProject();
        assertThatCode(() -> insertDraft(elsewhere, backerId, insertTier(elsewhere)))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a draft always knows when it lapses")
    void aDraftAlwaysKnowsWhenItLapses() {
        UUID projectId = insertProject();
        UUID backerId = insertUser();

        // Without this the sweep's `reservation_expires_at <= now()` would never match
        // the row, and the place it holds would be held for ever -- silently, on the
        // one kind of tier where that matters.
        assertThatThrownBy(() -> jdbc().update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount)
                        VALUES (?, ?, ?, 'DRAFT', 19.99)
                        """,
                        Identifiers.newIdentifier(),
                        projectId,
                        backerId))
                .isInstanceOf(DataIntegrityViolationException.class);

        // A pledge that has moved on keeps whatever window it had. It is a true
        // statement about the time the backer was given, and requiring every
        // transition to clear it would be a rule with no reader.
        UUID draft = insertDraft(projectId, backerId, null);
        assertThatCode(() -> jdbc().update("UPDATE pledges SET state = 'COLLECTED' WHERE id = ?", draft))
                .doesNotThrowAnyException();
        assertThat(jdbc().queryForObject(
                        "SELECT reservation_expires_at FROM pledges WHERE id = ?", Instant.class, draft))
                .isNotNull();
    }

    @Test
    @DisplayName("§6.2: the state is one of the eight, and nothing else")
    void theStateIsFromSixTwosVocabulary() {
        UUID projectId = insertProject();
        UUID pledgeId = insertDraft(projectId, insertUser(), null);

        for (PledgeState state : PledgeState.values()) {
            assertThatCode(() -> setState(pledgeId, state))
                    .withFailMessage("§6.2's %s was refused by the database", state)
                    .doesNotThrowAnyException();
        }

        // A state outside §6.2 is a pledge nothing in the platform knows how to
        // collect, refund, or fulfil. The stored-card states left with V107.
        for (String retired : List.of("PAID", "CONFIRMED", "CHARGE_PENDING", "CHARGE_FAILED", "DROPPED")) {
            assertThatThrownBy(() -> jdbc().update("UPDATE pledges SET state = ? WHERE id = ?", retired, pledgeId))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }
    }

    // -----------------------------------------------------------------------
    // Money
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the total is the sum of its parts, computed by the database")
    void theTotalIsGenerated() {
        UUID projectId = insertProject();
        UUID pledgeId = insertDraft(projectId, insertUser(), null);

        jdbc().update(
                        """
                        UPDATE pledges
                           SET base_amount = 19.99, addons_amount = 5.00, bonus_amount = 0.01,
                               shipping_amount = 7.50, tax_amount = 1.25
                         WHERE id = ?
                        """,
                        pledgeId);

        // numeric(14,2), not a float. 19.99 + 5.00 + 0.01 + 7.50 + 1.25 is exactly
        // 33.75 here, which is the arithmetic a double gets wrong and a card is
        // charged for.
        assertThat(total(pledgeId)).isEqualTo(new BigDecimal("33.75"));

        // The total follows its parts, so it cannot be left describing a receipt
        // nobody would recognise.
        jdbc().update("UPDATE pledges SET shipping_amount = 0 WHERE id = ?", pledgeId);
        assertThat(total(pledgeId)).isEqualTo(new BigDecimal("26.25"));

        // And it cannot be written directly, which is what stops it from ever
        // disagreeing with the lines it is made of.
        assertThatThrownBy(() -> jdbc().update("UPDATE pledges SET total_amount = 1.00 WHERE id = ?", pledgeId))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    @DisplayName("no line of a pledge is negative")
    void moneyIsNeverNegative() {
        UUID projectId = insertProject();
        UUID pledgeId = insertDraft(projectId, insertUser(), null);

        // A discount expressed as a negative shipping charge is a total the backer
        // cannot reconcile with their receipt, and a negative bonus is somebody
        // paying less than the reward's price for it.
        for (String column : new String[] {
            "base_amount", "addons_amount", "bonus_amount", "shipping_amount", "tax_amount"
        }) {
            assertThatThrownBy(() -> jdbc().update(
                            "UPDATE pledges SET " + column + " = -0.01 WHERE id = ?", pledgeId))
                    .withFailMessage("%s accepted a negative amount", column)
                    .isInstanceOf(DataIntegrityViolationException.class);
        }
    }

    @Test
    @DisplayName("a currency is three letters and a destination is two")
    void codesAreWellFormed() {
        UUID projectId = insertProject();
        UUID pledgeId = insertDraft(projectId, insertUser(), null);

        assertThatThrownBy(() -> jdbc().update("UPDATE pledges SET currency = 'azn' WHERE id = ?", pledgeId))
                .isInstanceOf(DataIntegrityViolationException.class);
        // Alpha-2, because that is what an address form, a carrier, and a shipping
        // rule all speak -- shipping_rules.country_code is matched against this.
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE pledges SET shipping_country = 'AZE' WHERE id = ?", pledgeId))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatCode(() -> jdbc().update("UPDATE pledges SET shipping_country = 'AZ' WHERE id = ?", pledgeId))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("§10.3: one pledge per idempotency key, per backer")
    void idempotencyKeysAreUniquePerBacker() {
        UUID backerId = insertUser();
        UUID firstProject = insertProject();
        UUID secondProject = insertProject();

        UUID first = insertDraft(firstProject, backerId, null);
        // A second campaign, because §7.2 gives this backer one active pledge per
        // campaign and the rule being checked here is a different one.
        UUID second = insertDraft(secondProject, backerId, null);

        jdbc().update("UPDATE pledges SET idempotency_key = 'a-client-generated-key' WHERE id = ?", first);

        // The whole guarantee: a retried POST /v1/pledges/draft finds the pledge it
        // already made rather than making a second one. #52 sends the header and
        // records the response in `idempotency_keys`; this index is the second line
        // under it, so that even a failure of that machinery cannot produce two
        // pledges from one backer's one key.
        assertThatThrownBy(() -> jdbc().update(
                        "UPDATE pledges SET idempotency_key = 'a-client-generated-key' WHERE id = ?", second))
                .isInstanceOf(DataIntegrityViolationException.class);

        // **And it is per backer**, which V18 widened it to be. A key is minted by a
        // client and belongs to the account that minted it -- `idempotency_keys` is
        // unique over (account_id, idempotency_key) for that reason -- so two backers
        // who happen to generate the same UUID are two requests, not a collision. The
        // two indexes disagreeing would mean one of them refusing a request the other
        // considers ordinary.
        UUID somebodyElse = insertDraft(insertProject(), insertUser(), null);
        assertThatCode(() -> jdbc().update(
                        "UPDATE pledges SET idempotency_key = 'a-client-generated-key' WHERE id = ?", somebodyElse))
                .doesNotThrowAnyException();

        // Null is not a value, so the pledges without a key do not collide with each
        // other -- which is every pledge made before #52.
        assertThat(count("pledges", "project_id", secondProject)).isEqualTo(1);
    }

    // -----------------------------------------------------------------------
    // References
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a pledge cannot name another campaign's reward tier")
    void aPledgeCannotCrossCampaigns() {
        UUID projectId = insertProject();
        UUID backerId = insertUser();
        UUID theirTier = insertTier(insertProject());

        // A backer buying one campaign's reward on another campaign's page. The
        // composite foreign key is what refuses it; no single-column reference could.
        assertThatThrownBy(() -> insertDraft(projectId, backerId, theirTier))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a tier somebody is checking out on cannot be deleted")
    void aReservedTierCannotBeDeleted() {
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId);
        insertDraft(projectId, insertUser(), tierId);

        // RewardService refuses this before it reaches here, but only for a tier with
        // claimed backers -- a reservation in flight is not one of those yet. This is
        // what holds when the caller is a support query, and what stops a place being
        // deleted out from under somebody entering their card details.
        assertThatThrownBy(() -> jdbc().update("DELETE FROM reward_tiers WHERE id = ?", tierId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("deleting a campaign takes its pledges and their tiers together")
    void everythingCascadesFromTheCampaign() {
        UUID projectId = insertProject();
        UUID tierId = insertTier(projectId);
        insertDraft(projectId, insertUser(), tierId);

        // The reason the tier reference is DEFERRABLE and not plain NO ACTION. This
        // one statement removes the tier and the pledge that names it, and a check
        // performed the moment the tier row went would refuse it on the strength of a
        // row the same statement was about to delete.
        assertThatCode(() -> jdbc().update("DELETE FROM projects WHERE id = ?", projectId))
                .doesNotThrowAnyException();

        assertThat(count("pledges", "project_id", projectId)).isZero();
        assertThat(count("reward_tiers", "project_id", projectId)).isZero();
    }

    @Test
    @DisplayName("a backer's account cannot be deleted out from under their pledge")
    void theBackerSurvivesTheirPledge() {
        UUID projectId = insertProject();
        UUID backerId = insertUser();
        insertDraft(projectId, backerId, null);

        // §17.4 anonymises an account rather than deleting it, precisely so that what
        // it did survives it. A pledge is a financial obligation, and deleting the
        // person does not undo the charge.
        assertThatThrownBy(() -> jdbc().update("DELETE FROM users WHERE id = ?", backerId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private BigDecimal total(UUID pledgeId) {
        return jdbc().queryForObject("SELECT total_amount FROM pledges WHERE id = ?", BigDecimal.class, pledgeId);
    }

    @Test
    @DisplayName("updated_at moves on update and created_at does not")
    void updatedAtIsMaintainedByTheDatabase() {
        UUID projectId = insertProject();
        UUID pledgeId = insertDraft(projectId, insertUser(), null);

        Instant createdAt = timestamp("created_at", pledgeId);
        Instant before = timestamp("updated_at", pledgeId);

        jdbc().update("UPDATE pledges SET referrer_code = 'a-newsletter' WHERE id = ?", pledgeId);

        // The application never sets updated_at, so it cannot forget to.
        assertThat(timestamp("updated_at", pledgeId)).isAfterOrEqualTo(before);
        assertThat(timestamp("created_at", pledgeId)).isEqualTo(createdAt);
    }

    private Instant timestamp(String column, UUID pledgeId) {
        return jdbc().queryForObject("SELECT " + column + " FROM pledges WHERE id = ?", Instant.class, pledgeId);
    }
}
