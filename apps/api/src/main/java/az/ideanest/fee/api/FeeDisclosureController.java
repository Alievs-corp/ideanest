package az.ideanest.fee.api;

import az.ideanest.fee.application.DefaultFeeTerms;
import az.ideanest.fee.application.FeeSchedules;
import az.ideanest.fee.domain.FeeSchedule;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * §22.3's "clear fee disclosure", derived from {@code fee_schedules} — issue #439.
 *
 * <h2>The requirement this closes, and why it was the one still open</h2>
 *
 * <p>§22.3 lists six product requirements. Five were built. The sixth — fee disclosure — was a
 * sentence in a message catalogue saying that the platform charges nothing, which is <em>true
 * today</em> because no schedule is seeded and <strong>becomes false the day one is</strong>. It
 * would become false silently, because nothing checks a catalogue against a table.
 *
 * <p>So the disclosure is derived. A number a creator can check against the payout they get is a
 * disclosure; a sentence about the platform's intentions is not.
 *
 * <h2>Two fees, kept distinguishable</h2>
 *
 * <p>§5.2's platform fee and the payment provider's fee are separate numbers on this response and
 * are never summed for the reader here. #439 says why: "a creator reading '5%' and receiving 94.2%
 * will ask, and the answer needs to already be on the page." A single {@code totalRate} would be
 * the version of this response that produces that question.
 *
 * <h2>Public, cacheable, and honest about having nothing to say</h2>
 *
 * <p>The audience is a backer deciding whether to pledge and a creator deciding whether to launch,
 * neither of whom has necessarily signed in. Nothing in the answer belongs to a person and a
 * schedule changes a handful of times a year, which is the shape a shared cache is correct for.
 *
 * <p><strong>{@code configured: false} rather than zeros when no schedule is in force.</strong>
 * The two are not the same statement: zeros are a commitment to charge nothing, and the absence of
 * a schedule is the platform not having decided. {@code FeeSchedules.priceOf} treats the absence
 * as zero fees because a payout run must not stop over it; a page has the opposite obligation, and
 * a client that read zeros here would print "0% platform fee" on the strength of an empty table.
 */
@RestController
public class FeeDisclosureController {

    /**
     * An hour, matching the legal documents.
     *
     * <p>The lag matters in one direction only — a schedule opened this morning should be what
     * somebody pledging this afternoon is shown — and the collection run reads the table on every
     * charge, so a stale page can never produce a wrongly priced payout.
     */
    private static final Duration CACHE_FOR = Duration.ofHours(1);

    private final FeeSchedules fees;

    public FeeDisclosureController(FeeSchedules fees) {
        this.fees = fees;
    }

    /** The platform-wide terms: what the pricing page and the creator's own pages disclose. */
    @GetMapping(path = "/v1/fees/disclosure", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Disclosure> platform() {
        return disclosure(null);
    }

    /**
     * The terms this campaign is actually priced under.
     *
     * <p>Most-specific-wins, exactly as a collection resolves — a campaign with its own schedule
     * discloses its own. Quoting the platform rate to somebody backing a campaign on different
     * terms would be the disclosure §22.3 exists to prevent.
     */
    @GetMapping(path = "/v1/projects/{projectId}/fee-disclosure", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Disclosure> forProject(@PathVariable UUID projectId) {
        return disclosure(projectId);
    }

    private ResponseEntity<Disclosure> disclosure(UUID projectId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(CACHE_FOR).cachePublic())
                // IDN-EXT-01 (#42): with no schedule the default terms are what applies, so they are
                // what is disclosed — a page may not say "nothing to disclose" while charging 15%.
                .body(fees.inForceFor(projectId)
                        .map(Disclosure::of)
                        .orElseGet(() -> Disclosure.ofDefault(fees.defaultTerms())));
    }

    /**
     * What a backer's pledge is subject to, and what a creator will actually receive.
     *
     * <p><strong>Every rate is a string</strong>, for {@code FeeScheduleResponses.Schedule}'s
     * reason and with more force here: this response reaches a page that multiplies it by
     * somebody's pledge, and a JSON number is an IEEE 754 double in every mainstream parser. The
     * client hands these to {@code decimal.js}, which is what CLAUDE.md requires of the frontend.
     *
     * @param configured whether the platform has committed to any terms at all. False is a real
     *     answer and not an error: see the class comment on why it is not zeros
     * @param platformRate §5.2's fee, as a fraction — {@code "0.05000"} is five percent
     * @param processingRate the payment provider's, kept separate from the platform's on purpose
     * @param processingFixed the provider's per-transaction amount, in {@code currency}
     * @param creatorReceivesRate what a creator keeps of every manat pledged, before the fixed
     *     amount. Computed here rather than left to the client, because it is the number a creator
     *     checks their payout against and three clients deriving it would round it three ways
     */
    public record Disclosure(
            boolean configured,
            String platformRate,
            String processingRate,
            String processingFixed,
            String creatorReceivesRate,
            String currency,
            java.time.Instant effectiveFrom) {

        static Disclosure ofDefault(DefaultFeeTerms terms) {
            BigDecimal keeps = BigDecimal.ONE
                    .subtract(terms.platformRate())
                    .subtract(terms.processingRate())
                    .max(BigDecimal.ZERO)
                    .setScale(5, RoundingMode.DOWN);
            return new Disclosure(
                    true,
                    terms.platformRate().toPlainString(),
                    terms.processingRate().toPlainString(),
                    "0",
                    keeps.toPlainString(),
                    terms.currency(),
                    null);
        }

        static Disclosure of(FeeSchedule schedule) {
            BigDecimal keeps = BigDecimal.ONE
                    .subtract(schedule.platformRate())
                    .subtract(schedule.processingRate())
                    // Never below zero. A schedule whose rates exceed one is misconfigured and
                    // FeeSchedules clamps the arithmetic; a disclosure that printed a negative
                    // share would be the page reporting the misconfiguration as a promise.
                    .max(BigDecimal.ZERO)
                    .setScale(5, RoundingMode.DOWN);

            return new Disclosure(
                    true,
                    schedule.platformRate().toPlainString(),
                    schedule.processingRate().toPlainString(),
                    schedule.processingFixed().toPlainString(),
                    keeps.toPlainString(),
                    schedule.currency(),
                    schedule.effectiveFrom());
        }

        /**
         * No schedule is in force.
         *
         * <p>Nulls rather than zeros, so that a client cannot accidentally render a rate the
         * platform has not committed to — {@code configured} is what a page branches on, and a
         * null is what stops the branch being optional.
         */
        static Disclosure unconfigured() {
            return new Disclosure(false, null, null, null, null, null, null);
        }
    }
}
