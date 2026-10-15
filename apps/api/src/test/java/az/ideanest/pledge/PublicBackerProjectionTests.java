package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.pledge.application.PublicBacker;
import az.ideanest.pledge.application.PublicBackers;
import az.ideanest.pledge.domain.NewPledge;
import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeQuote;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.shared.EmailAddress;
import az.ideanest.user.application.UserAccount;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The two decisions this projection makes: which pledges a campaign counts, and what a
 * published backer may be.
 *
 * <p>No database and no Spring. Both are decisions rather than queries — the first is a
 * set, the second is a factory over a plain entity — and a suite that started a
 * PostgreSQL container to assert on them would make the whole build slower for no
 * coverage. The counting rule as the endpoint actually serves it is
 * {@code PublicBackerApiTests}.
 *
 * <p><strong>{@link PublicBacker} has no production consumer today</strong> — §4.4
 * publishes backer data only in aggregate and whether a campaign should list
 * individuals is #209, which is undecided. It is tested anyway, and for the reason its
 * own class comment gives: the guarantee has to exist before the author who would
 * otherwise have to reinvent it, and a type kept without tests is a type that has
 * quietly stopped working by the time somebody needs it.
 */
class PublicBackerProjectionTests {

    private static final Instant CONFIRMED_AT = Instant.parse("2026-01-01T12:00:00Z");

    // -----------------------------------------------------------------------
    // Which pledges count
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a public backing is an active pledge that is no longer a draft")
    void countedIsTheActiveSetWithoutDraft() {
        // Stated independently rather than derived from the same expression the
        // production code uses, which is the arrangement PledgeState.ACTIVE already has
        // against pledges_project_backer_active_key: two statements of one rule,
        // checked against each other, is worth more than one statement and a
        // derivation that cannot disagree because nobody reads it.
        assertThat(PublicBackers.COUNTED)
                .containsExactlyInAnyOrder(PledgeState.COLLECTED, PledgeState.FULFILLED);
    }

    @Test
    @DisplayName("the counted set is the active set and the one deliberate difference")
    void countedTracksTheActiveSet() {
        // The property that has to survive #56 and epic #59 adding transitions: a state
        // that becomes active must become a public backing too, unless somebody decides
        // otherwise here and says why. DRAFT is the only decision taken so far -- a
        // five-minute reservation is not a commitment.
        Set<PledgeState> expected = EnumSet.copyOf(PledgeState.ACTIVE);
        expected.remove(PledgeState.DRAFT);

        assertThat(PublicBackers.COUNTED).isEqualTo(expected);
        assertThat(PublicBackers.COUNTED).doesNotContain(PledgeState.DRAFT);
    }

    @Test
    @DisplayName("a pledge that has ended is not a backing")
    void endedPledgesAreNotCounted() {
        // The five states in which the commitment between this backer and this campaign
        // is over. A campaign that went on counting a refunded pledge would be
        // advertising money it gave back.
        assertThat(PublicBackers.COUNTED)
                .doesNotContain(
                        PledgeState.EXPIRED,
                        PledgeState.CANCELED_BY_BACKER,
                        PledgeState.CANCELED_BY_PROJECT,
                        PledgeState.REFUNDED,
                        PledgeState.CHARGEBACK);
    }

    @Test
    @DisplayName("the counted set cannot be edited by whoever reads it")
    void countedIsNotWritable() {
        // A public static Set that a caller could add to is a rule any bean could
        // change for the whole process at start-up.
        assertThatThrownBy(() -> PublicBackers.COUNTED.add(PledgeState.DRAFT))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    // -----------------------------------------------------------------------
    // What a published backer may be — §4.5's PL-12
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("an anonymous pledge yields no identity even when one is handed in")
    void anAnonymousPledgeIgnoresTheIdentityItIsGiven() {
        UserAccount identity = account("Ismet", "ismet");

        PublicBacker backer = PublicBacker.of(confirmedPledge(identity.id(), true), identity);

        // The account was resolved and passed in, and the projection still produced a
        // value with nowhere to put it. That is the difference between a rule enforced
        // by the shape and one enforced by the caller remembering not to look it up.
        assertThat(backer).isInstanceOf(PublicBacker.Anonymous.class);
        assertThat(backer.backedAt()).isEqualTo(CONFIRMED_AT);
    }

    @Test
    @DisplayName("a backer who did not ask to be hidden is named")
    void anOrdinaryPledgeIsNamed() {
        UserAccount identity = account("Ismet", "ismet");

        PublicBacker backer = PublicBacker.of(confirmedPledge(identity.id(), false), identity);

        assertThat(backer).isInstanceOf(PublicBacker.Named.class);
        PublicBacker.Named named = (PublicBacker.Named) backer;
        assertThat(named.id()).isEqualTo(identity.id());
        assertThat(named.name()).isEqualTo("Ismet");
        assertThat(named.slug()).isEqualTo("ismet");
        // Confirmation is what makes a pledge a backing, so that is what is published
        // rather than when the draft was opened.
        assertThat(named.backedAt()).isEqualTo(CONFIRMED_AT);
    }

    @Test
    @DisplayName("a backer whose account has been anonymised has no identity to publish")
    void anAnonymisedAccountHasNoIdentityToPublish() {
        // §17.4 keeps the pledge row and severs the identity, and the user module's
        // finders exclude a deleted account by construction -- so a consumer resolving
        // a page of backers gets nothing back for this one. Nobody designed for this
        // case; the sealed shape answers it correctly anyway, which is the argument for
        // the shape.
        PublicBacker backer = PublicBacker.of(confirmedPledge(UUID.randomUUID(), false), null);

        assertThat(backer).isInstanceOf(PublicBacker.Anonymous.class);
    }

    @Test
    @DisplayName("a named backer without a name is refused rather than published as a blank")
    void namedRequiresAnIdentity() {
        // The failure PL-12 exists to prevent, arriving by the other door: a client
        // that received {"isAnonymous": false, "name": null} would render a blank where
        // a person should be, and nothing would report it.
        assertThatThrownBy(() -> new PublicBacker.Named(UUID.randomUUID(), null, "somebody", CONFIRMED_AT))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> new PublicBacker.Named(null, "Somebody", "somebody", CONFIRMED_AT))
                .isInstanceOf(NullPointerException.class);
    }

    @Test
    @DisplayName("an anonymous backer has exactly one thing on it")
    void anonymousCarriesNothingIdentifying() {
        // Not an assertion about a null field -- an assertion that there is no field.
        // If a later change adds an identifier to this record, this is what fails, and
        // it fails before anything can serialise one. The account identifier in
        // particular is the join key to §4.2's profile, so carrying it would resolve
        // back to the name PL-12 withholds.
        assertThat(PublicBacker.Anonymous.class.getRecordComponents()).hasSize(1);
        assertThat(PublicBacker.Anonymous.class.getRecordComponents()[0].getName()).isEqualTo("backedAt");

        // And the hierarchy is closed, so a consumer switching over it can be
        // exhaustive rather than exhaustive-so-far.
        assertThat(PublicBacker.class.isSealed()).isTrue();
        assertThat(PublicBacker.class.getPermittedSubclasses())
                .containsExactlyInAnyOrder(PublicBacker.Named.class, PublicBacker.Anonymous.class);
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /**
     * A pledge that has been confirmed, built through the domain rather than mocked.
     *
     * <p>{@code confirm} is what stamps {@code confirmed_at}, and it is the transition
     * that makes a pledge one of {@link PublicBackers#COUNTED} — so a fixture that set
     * the field some other way would be testing the projection against a row the state
     * machine cannot produce.
     */
    private static Pledge confirmedPledge(UUID backerId, boolean anonymous) {
        PledgeQuote quote = new PledgeQuote(
                new BigDecimal("25.00"),
                BigDecimal.ZERO,
                BigDecimal.ZERO,
                BigDecimal.ZERO,
                BigDecimal.ZERO,
                new BigDecimal("25.00"),
                "AZN");

        Pledge pledge = Pledge.draft(new NewPledge(
                UUID.randomUUID(),
                backerId,
                null,
                quote,
                null,
                anonymous,
                null,
                null,
                CONFIRMED_AT.minus(Duration.ofMinutes(5))));
        pledge.paid(CONFIRMED_AT);
        return pledge;
    }

    private static UserAccount account(String name, String slug) {
        return new UserAccount(
                UUID.randomUUID(),
                EmailAddress.of(slug + "@example.com"),
                name,
                slug,
                true,
                null,
                null,
                "az",
                // §4.2's P-10 currency half (#327). The platform's own, which is what every
                // account holds until somebody chooses otherwise -- and nothing in a public
                // backer projection reads it.
                "AZN",
                null);
    }
}
