package az.ideanest.staff.application;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * {@code partnerVisibleValue = realValue x percentage / 100} — #205, part of #202.
 *
 * <p>The whole rule, in one place, so that "what does a partner see" has one answer a reviewer
 * can read and a test can pin. Exact arithmetic on {@link BigDecimal} until the last step, which
 * rounds once to two decimals with {@link RoundingMode#HALF_EVEN}: banker's rounding, because it
 * does not drift upwards across thousands of figures the way half-up does, and the platform's
 * money rule forbids the floating point that would make the question moot.
 *
 * <p><strong>Every displayed figure is scaled and rounded by itself.</strong> A total and the
 * parts it is made of are each {@code round(real x p / 100)}, so a displayed total may differ
 * from the sum of the displayed parts by up to half a cent per part. The alternative, adjusting
 * parts until they add up, would make a displayed figure differ from the formula, and the
 * formula is what the partner was promised. Counts are scaled the same way and may be
 * fractional: 7 subscriptions at 50% is 3.50.
 *
 * <p>Never called with a percentage above 100 or below zero: {@code partner_profiles} refuses
 * both. A super admin is scaled by exactly 100, which returns the real figure unchanged.
 */
public final class ShareScaling {

    private static final BigDecimal HUNDRED = new BigDecimal("100");

    private ShareScaling() {}

    /** An amount of money: {@code real x percentage / 100}, two decimals. Negative stays negative. */
    public static BigDecimal money(BigDecimal real, BigDecimal percentage) {
        return real.multiply(percentage).divide(HUNDRED, 2, RoundingMode.HALF_EVEN);
    }

    /** A count: {@code real x percentage / 100}, two decimals, so 7 at 50% is 3.50. */
    public static BigDecimal count(long real, BigDecimal percentage) {
        return money(BigDecimal.valueOf(real), percentage);
    }
}
