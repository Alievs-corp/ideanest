package az.ideanest.staff;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.staff.application.ShareScaling;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@code partnerVisibleValue = realValue x percentage / 100}, pinned — #205, part of #202.
 *
 * <p>The first two tests are the owner's own examples, word for word: a platform that took
 * $10,000 shows a 50% partner $5,000, and ten subscriptions show them five. They come first
 * because if a refactor ever makes them fail, the rest of this file is arguing about rounding
 * in a formula that no longer does what was promised.
 */
class ShareScalingTests {

    private static BigDecimal pct(String value) {
        return new BigDecimal(value);
    }

    @Test
    @DisplayName("$10,000 of revenue is $5,000 to a 50% partner")
    void theOwnersMoneyExample() {
        assertThat(ShareScaling.money(new BigDecimal("10000.00"), pct("50.00"))).isEqualTo(new BigDecimal("5000.00"));
    }

    @Test
    @DisplayName("ten subscriptions are five to a 50% partner")
    void theOwnersCountExample() {
        assertThat(ShareScaling.count(10, pct("50.00"))).isEqualTo(new BigDecimal("5.00"));
    }

    @Test
    @DisplayName("a count that does not divide is shown as a fraction, not rounded away")
    void countsMayBeFractional() {
        assertThat(ShareScaling.count(7, pct("50.00"))).isEqualTo(new BigDecimal("3.50"));
        assertThat(ShareScaling.count(1, pct("33.33"))).isEqualTo(new BigDecimal("0.33"));
    }

    @Test
    @DisplayName("today and this month, from the owner's example: $1,000 and $20,000 at 50%")
    void theOwnersPeriodExamples() {
        assertThat(ShareScaling.money(new BigDecimal("1000.00"), pct("50.00"))).isEqualTo(new BigDecimal("500.00"));
        assertThat(ShareScaling.money(new BigDecimal("20000.00"), pct("50.00"))).isEqualTo(new BigDecimal("10000.00"));
    }

    @Test
    @DisplayName("a super admin is scaled by exactly 100 and sees the real figure unchanged")
    void aHundredPercentIsTheIdentity() {
        for (String real : new String[] {"0.00", "0.01", "49.00", "12345.67", "-49.00"}) {
            assertThat(ShareScaling.money(new BigDecimal(real), pct("100.00")))
                    .isEqualByComparingTo(real);
        }
        assertThat(ShareScaling.count(7, pct("100.00"))).isEqualByComparingTo("7");
    }

    @Test
    @DisplayName("rounding is half-even, applied once, to two decimals")
    void roundingIsHalfEven() {
        // 0.25 x 50% = 0.125 and 0.35 x 50% = 0.175: each sits exactly on a half. Half-even sends
        // the first down to 0.12 and the second up to 0.18, so a long column of them does not
        // drift in one direction the way half-up would.
        assertThat(ShareScaling.money(new BigDecimal("0.25"), pct("50.00"))).isEqualTo(new BigDecimal("0.12"));
        assertThat(ShareScaling.money(new BigDecimal("0.35"), pct("50.00"))).isEqualTo(new BigDecimal("0.18"));
        // 33.33% of 10.00 is 3.333: below the half, so it rounds down.
        assertThat(ShareScaling.money(new BigDecimal("10.00"), pct("33.33"))).isEqualTo(new BigDecimal("3.33"));
    }

    @Test
    @DisplayName("a reversal stays negative and scales the same way")
    void reversalsScaleSymmetrically() {
        assertThat(ShareScaling.money(new BigDecimal("-49.00"), pct("50.00"))).isEqualTo(new BigDecimal("-24.50"));
    }

    @Test
    @DisplayName("every result has exactly two decimals, so nothing is a binary fraction on the wire")
    void theScaleIsAlwaysTwo() {
        for (String percentage : new String[] {"0.01", "33.33", "50.00", "99.99", "100.00"}) {
            assertThat(ShareScaling.money(new BigDecimal("123.45"), pct(percentage)).scale()).isEqualTo(2);
            assertThat(ShareScaling.count(3, pct(percentage)).scale()).isEqualTo(2);
        }
    }

    @Test
    @DisplayName("a partner never sees more than the real figure, at any percentage up to 100")
    void aShareIsNeverMoreThanTheWhole() {
        BigDecimal real = new BigDecimal("98765.43");
        for (int hundredths = 1; hundredths <= 10_000; hundredths += 37) {
            BigDecimal percentage = BigDecimal.valueOf(hundredths, 2);

            BigDecimal visible = ShareScaling.money(real, percentage);

            assertThat(visible).as("at %s", percentage).isLessThanOrEqualTo(real);
            assertThat(visible).as("at %s", percentage).isGreaterThanOrEqualTo(BigDecimal.ZERO);
        }
    }

    @Test
    @DisplayName("two partners at 50% between them see exactly the real total when it divides")
    void twoHalvesMakeTheWhole() {
        BigDecimal real = new BigDecimal("500.00");

        BigDecimal first = ShareScaling.money(real, pct("50.00"));
        BigDecimal second = ShareScaling.money(real, pct("50.00"));

        assertThat(first.add(second)).isEqualByComparingTo(real);
    }
}
