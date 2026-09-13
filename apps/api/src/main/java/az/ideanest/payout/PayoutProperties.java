package az.ideanest.payout;

import java.math.BigDecimal;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * §9's hold and §4.11's dual approval, as numbers an operator can change — issue #69.
 *
 * @param hold how long after a campaign closes before its money may leave.
 *     <strong>Fourteen days by default</strong>, which is not arbitrary: a chargeback can
 *     be raised weeks after a charge, and a payout sent before the refunds and disputes
 *     have landed is money the platform has to chase a creator for. Longer is safer for
 *     the platform and worse for the creator, who is waiting to build the thing people
 *     paid for — this is the shortest window that covers the ordinary refund request
 * @param dualApprovalThreshold the amount above which a payout needs two signatures.
 *     Compared against the <em>net</em>, which is what actually leaves. Zero would mean
 *     every payout needs two people, which on a platform with one finance member of staff
 *     means none can ever be sent
 * @param approvalsAboveThreshold how many distinct approvers a payout above the threshold
 *     needs. Two by default. Configurable rather than hard-coded because the number is a
 *     policy and not a fact, and because a deployment that has grown may want three on the
 *     largest ones
 * @param currency what {@link #dualApprovalThreshold} is denominated in, and the currency
 *     a campaign with no settled charge reports zero in. §21.2 gives nothing to convert
 *     with, so a payout in another currency is compared against a threshold that does not
 *     apply — {@code PayoutService} takes the safe branch and requires the higher count
 */
@ConfigurationProperties(prefix = "ideanest.payout")
public record PayoutProperties(
        Duration hold,
        BigDecimal dualApprovalThreshold,
        short approvalsAboveThreshold,
        String currency,
        String destinationReminderSchedule) {

    private static final Duration DEFAULT_HOLD = Duration.ofDays(14);

    private static final BigDecimal DEFAULT_THRESHOLD = new BigDecimal("1000.00");

    private static final short DEFAULT_APPROVALS = 2;

    private static final String DEFAULT_CURRENCY = "AZN";

    public PayoutProperties {
        hold = hold == null ? DEFAULT_HOLD : hold;
        dualApprovalThreshold = dualApprovalThreshold == null ? DEFAULT_THRESHOLD : dualApprovalThreshold;
        approvalsAboveThreshold = approvalsAboveThreshold == 0 ? DEFAULT_APPROVALS : approvalsAboveThreshold;
        currency = currency == null ? DEFAULT_CURRENCY : currency;
        // IDN-EXT-01 (#41): the daily pass that reminds a creator, weekly, that their payout waits
        // for their VÖEN and business card.
        destinationReminderSchedule = destinationReminderSchedule == null || destinationReminderSchedule.isBlank()
                ? "0 0 9 * * *"
                : destinationReminderSchedule;

        if (hold.isNegative()) {
            // A negative hold is a payout that was payable before the campaign closed.
            throw new IllegalArgumentException("A payout hold does not run backwards");
        }
        if (dualApprovalThreshold.signum() < 0) {
            throw new IllegalArgumentException("A dual-approval threshold is not negative");
        }
        if (approvalsAboveThreshold < 1 || approvalsAboveThreshold > 3) {
            // V55's CHECK says the same. Asserted here too so that a bad value stops the
            // process at start-up rather than at the first payout above the threshold.
            throw new IllegalArgumentException("A payout takes between one and three signatures");
        }
    }
}
