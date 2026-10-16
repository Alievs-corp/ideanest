package az.ideanest.fee.api;

import az.ideanest.fee.application.DefaultFeeTerms;
import az.ideanest.fee.domain.FeeSchedule;
import az.ideanest.fee.domain.FeeScope;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * AD-11's screen, as the service describes it — #311.
 */
public final class FeeScheduleResponses {

    private FeeScheduleResponses() {
    }

    /**
     * One set of terms.
     *
     * <p><strong>The rates travel as strings.</strong> §10.3 requires it of money and the
     * same argument applies here for a sharper reason: a rate is multiplied by money, and
     * a JSON number is an IEEE 754 double in every mainstream parser — so
     * {@code 0.05} would arrive in the browser as {@code 0.05000000000000000277…} and the
     * fee the screen previews would differ in the last place from the fee the service
     * charges. {@code BigDecimal.toPlainString} is what the browser then hands to
     * {@code decimal.js}, which is what CLAUDE.md requires of the frontend.
     *
     * @param open whether these are the terms currently in force. Derivable from a null
     *     {@code effectiveTo} and sent anyway, because it is the field the screen sorts
     *     and badges on, and a client deriving it is a client that will eventually get
     *     the boundary wrong
     */
    public record Schedule(
            UUID id,
            FeeScope scope,
            UUID scopeRef,
            String platformRate,
            String processingRate,
            String processingFixed,
            String currency,
            Instant effectiveFrom,
            Instant effectiveTo,
            boolean open,
            String note,
            Instant createdAt,
            UUID createdBy) {

        public static Schedule of(FeeSchedule schedule) {
            return new Schedule(
                    schedule.id(),
                    schedule.scope(),
                    schedule.scopeRef(),
                    plain(schedule.platformRate()),
                    plain(schedule.processingRate()),
                    plain(schedule.processingFixed()),
                    schedule.currency(),
                    schedule.effectiveFrom(),
                    schedule.effectiveTo(),
                    schedule.effectiveTo() == null,
                    schedule.note(),
                    schedule.createdAt(),
                    schedule.createdBy());
        }

        private static String plain(BigDecimal value) {
            // toPlainString rather than toString: the latter switches to scientific
            // notation for small values, and 1E-5 is a rate no browser should have to
            // parse twice.
            return value.toPlainString();
        }
    }

    /**
     * The terms a payout is priced at when no platform schedule is open — §5.2's default, from
     * {@code ideanest.fee}. Sent beside the history so the console starts a new platform schedule from
     * what is actually charged today, and so its empty state can say what that is rather than "nothing".
     */
    public record Defaults(String platformRate, String processingRate, String currency) {

        public static Defaults of(DefaultFeeTerms terms) {
            return new Defaults(
                    terms.platformRate().toPlainString(), terms.processingRate().toPlainString(), terms.currency());
        }
    }

    /** Every window ever written. Unpaged — see {@code FeeScheduleRepository.history}. */
    public record History(List<Schedule> schedules, Defaults defaults) {

        public static History of(List<FeeSchedule> schedules, DefaultFeeTerms defaults) {
            return new History(schedules.stream().map(Schedule::of).toList(), Defaults.of(defaults));
        }
    }
}
