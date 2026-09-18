package az.ideanest.discovery.application;

import az.ideanest.discovery.domain.RankingTerm;
import az.ideanest.discovery.infrastructure.RankingWeightRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.staff.application.NotAModeratorException;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Tuning the ranking: the only way {@code ranking_weights} is ever written.
 *
 * <h2>Who may</h2>
 *
 * <p><strong>Changing a weight is a privileged action, and by a wider margin than
 * curating.</strong> §3.2 makes applying an editorial badge a moderator action because
 * it directs the platform's attention at one campaign. A weight directs it at every
 * campaign, in every feed, for every reader, at once — moving {@code w4} from 0.15 to
 * 1.5 promotes the platform's own picks above everything else on it without touching a
 * single collection. CLAUDE.md requires every privileged action to be audited, and this
 * is the one where the question "who changed it, when, and why" is most likely to be
 * asked by somebody who is not on the team.
 *
 * <p>The check is {@link PlatformStaff} — since #295 a role model rather than the list the
 * moderation endpoints and {@link CurationService} use, empty by default, failing
 * closed. Reused rather than reinvented for the reason {@code CurationService} gives: a
 * second directory is a second thing epic #100 has to find and delete, and a deployment
 * could configure one and forget the other. The cost is the same and is the same
 * distinction §3.2 does not draw either.
 *
 * <p>The check runs before anything is read, so a caller who is not staff learns nothing
 * about how the platform is tuned. That matters more here than it does for collections:
 * the weights are a description of how to rank highly, and a campaign that knew them
 * would know what to optimise.
 *
 * <h2>What is recorded</h2>
 *
 * <p>Every change writes exactly one {@code ranking_weight_changes} row, in the same
 * transaction, carrying the value before as well as the value after. A change that made
 * no difference — the same weight and the same flag — writes nothing and is not an
 * error: an audit trail that records attempts rather than decisions is one nobody can
 * read, which is {@code CurationService}'s rule and the same one.
 *
 * <p>The note is required on every change. Not decoration: §11.2's purpose is that
 * ranking be measured rather than argued about, and a weight moved with no stated
 * hypothesis is unmeasurable by construction — a year later the row is the only place
 * the reason still exists.
 */
@Service
public class RankingService {

    /**
     * The role every row is written under, until there is a role model.
     *
     * <p>{@code MODERATOR} rather than {@code ADMIN}, for the reason
     * {@code CurationService} gives: the interim directory is a list of addresses and
     * cannot tell the two apart, and claiming the higher of two roles in an audit trail
     * on no evidence is worse than claiming the lower.
     */
    private static final String ACTOR_ROLE = "MODERATOR";

    private final RankingWeightRepository weights;
    private final RankingWeightStore store;
    private final RankingDiagnostics diagnostics;
    private final PlatformStaff moderators;

    public RankingService(
            RankingWeightRepository weights,
            RankingWeightStore store,
            RankingDiagnostics diagnostics,
            PlatformStaff moderators) {
        this.weights = weights;
        this.store = store;
        this.diagnostics = diagnostics;
        this.moderators = moderators;
    }

    /**
     * Every term, its weight, whether it is live, and what is blocking it if it is not.
     *
     * <p>Read through the store rather than the repository, so that what a curator is
     * shown is what the feed is actually scoring with — including, during the staleness
     * window, a value that is up to a minute behind the table. Showing the table instead
     * would be showing a number that is true and is not yet in force, which is the
     * harder of the two things to reason about.
     */
    @Transactional(readOnly = true)
    public RankingWeights list(UUID curatorId) {
        requireCurator(curatorId);
        return store.current();
    }

    /**
     * Sets one term's weight and whether it counts.
     *
     * <p>Refreshes this instance's snapshot before returning, so the caller's next
     * request is scored with what they just set. Every other instance picks it up within
     * {@link RankingWeightStore#STALENESS_WINDOW}; nothing here promises sooner.
     *
     * @param weight non-negative and at most ten. The sign of a term belongs to the term
     *     — §11.2 subtracts the spam signal — so a negative weight is refused rather than
     *     silently inverting a term
     * @param active whether the term is in the sum. Refused for a term nothing computes,
     *     because switching one on is a change that looks like it did something and did
     *     not
     * @param note why. Required, and stored
     */
    @Transactional
    public RankingWeights update(RankingTerm term, BigDecimal weight, boolean active, String note, UUID curatorId) {
        requireCurator(curatorId);
        requireNote(note);
        requireWeight(weight);

        RankingWeight before = weights.find(term)
                .orElseThrow(() -> new RankingRejectedException(
                        "term", "There is no weight row for " + term.wireValue() + "."));

        if (active && !term.isComputable()) {
            // The same rule as V15's ranking_weights_inert_terms_are_not_active, checked
            // here so the answer is a 400 naming the field rather than a constraint
            // violation arriving as a 500 — the reason V6 gives for validating a title's
            // length in Java as well as in a CHECK.
            throw new RankingRejectedException(
                    "active",
                    "Nothing computes " + term.wireValue() + " yet: it needs " + term.blockedBy()
                            + ". Switching it on would change nothing and look like it had.");
        }

        if (before.weight().compareTo(weight) == 0 && before.active() == active) {
            // A change that changes nothing. Not an error — a client re-sending the
            // current state is doing something reasonable — and not an audit row either.
            return store.current();
        }

        weights.update(term, weight, active, curatorId);
        weights.record(term, before, weight, active, curatorId, ACTOR_ROLE, note);
        return store.refresh();
    }

    /**
     * Why one campaign scores what it scores.
     *
     * <p>Moderator-only, like everything else here, and for a reason beyond consistency:
     * the breakdown is a specification of how to rank highly on this platform, term by
     * term, and publishing it would turn tuning into an arms race with whoever read it
     * fastest.
     *
     * @param text the query to score the text term against, or null
     * @throws RankingRejectedException when no publicly visible campaign has that slug
     */
    @Transactional(readOnly = true)
    public RankingExplanation explain(String slug, String text, UUID curatorId) {
        requireCurator(curatorId);
        return diagnostics.explain(slug, text, store.current())
                .orElseThrow(() -> new RankingRejectedException(
                        "slug", "There is no publicly visible campaign with that slug."));
    }

    /**
     * CURATE, and not merely staff — the rail hides what a reader may not open.
     *
     * <p>This asked whether the caller worked here, which made the ranking weights behind every feed everybody's to edit: a
     * moderator clearing a report queue held the same authority over the front page as
     * {@code StaffRole.CURATOR}, whose whole definition is that one capability.
     *
     * <p>{@code requireCapability} keeps both refusals rather than replacing one with the
     * other. A stranger still gets {@link NotAModeratorException} — "you do not work here" —
     * and a colleague gets the capability they are short of, which is the one an administrator
     * can grant. Collapsing them would send a moderator looking for a bug.
     */
    private void requireCurator(UUID accountId) {
        moderators.requireCapability(accountId, StaffCapability.CURATE);
    }

    private static void requireNote(String note) {
        if (note == null || note.isBlank()) {
            throw new RankingRejectedException(
                    "note",
                    "Say why: a weight change moves every campaign in every feed, and this row is the "
                            + "only record of the reason.");
        }
    }

    /**
     * The bounds V15 puts on the column, checked here so a bad value is a 400.
     *
     * <p>The upper bound is ten, and it is not arbitrary: a weight multiplies a term
     * that is normalised into {@code [0, 1]}, so a hundred is not a stronger opinion —
     * it is a term that has silently become the only term.
     */
    private static void requireWeight(BigDecimal weight) {
        if (weight == null || weight.signum() < 0) {
            throw new RankingRejectedException(
                    "weight",
                    "A weight is not negative. §11.2 subtracts the spam term itself, so the sign belongs "
                            + "to the term rather than to the number.");
        }
        if (weight.compareTo(BigDecimal.TEN) > 0) {
            throw new RankingRejectedException(
                    "weight", "A weight is at most 10; every term it multiplies is already inside [0, 1].");
        }
    }
}
