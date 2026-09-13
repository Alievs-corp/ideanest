package az.ideanest.fee.application;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.fee.domain.FeeSchedule;
import az.ideanest.fee.domain.FeeScope;
import az.ideanest.shared.Identifiers;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * What a fee schedule does to a sum of money — §9, issue #311.
 *
 * <p><strong>CLAUDE.md makes this suite non-optional:</strong> "money arithmetic, state
 * transitions, idempotency and stock reservation are not optional to test — they fail
 * silently and expensively". A fee is the multiplication that stands between what a backer
 * paid and what a creator receives, and it is wrong in ways nobody notices until a creator
 * adds their statement up by hand.
 *
 * <p><strong>In the package it tests</strong>, because {@code FeeSchedules.apply} is
 * package-private: the arithmetic is separated from {@code priceOf} so that it can be
 * checked without a database, and widening it to public purely to be testable would
 * publish a method whose contract is "you have already resolved the schedule".
 *
 * <p>Deliberately a plain unit test with no container. {@code FeeSchedules.apply} takes an
 * entity and a {@link Money} and returns a breakdown; none of the rules being checked here
 * are about persistence, and a test that needed PostgreSQL to assert that three numbers add
 * up is a test people stop running.
 */
class FeeArithmeticTests {

    /** Five percent platform, 2.9% + 0.30 processing. The shape §9 describes. */
    private static FeeSchedule schedule(String platformRate, String processingRate, String fixed) {
        return new FeeSchedule(
                Identifiers.newIdentifier(),
                FeeScope.PLATFORM,
                null,
                new BigDecimal(platformRate),
                new BigDecimal(processingRate),
                new BigDecimal(fixed),
                "AZN",
                Instant.parse("2026-01-01T00:00:00Z"),
                "for the tests",
                UUID.randomUUID());
    }

    /**
     * The service with no collaborators, for the arithmetic alone.
     *
     * <p>{@code apply} touches none of them — it takes the schedule it is handed — so nulls
     * are honest here in a way they would not be if this were testing {@code priceOf}.
     */
    private static final FeeSchedules FEES =
            new FeeSchedules(null, null, null, null, null, new az.ideanest.fee.FeeProperties(null, null, null));

    @Test
    @DisplayName("the parts add up to the whole")
    void breakdownBalances() {
        FeeBreakdown breakdown = FEES.apply(Money.of(new BigDecimal("100.00"), "AZN"),
                schedule("0.05000", "0.02900", "0.30"));

        // The invariant the record exists for. Gross must equal net plus both fees exactly,
        // with no minor unit appearing or disappearing in the rounding.
        assertThat(breakdown.balances()).isTrue();
        assertThat(breakdown.platformFee()).isEqualTo(Money.of(new BigDecimal("5.00"), "AZN"));
        assertThat(breakdown.processingFee()).isEqualTo(Money.of(new BigDecimal("3.20"), "AZN"));
        assertThat(breakdown.net()).isEqualTo(Money.of(new BigDecimal("91.80"), "AZN"));
    }

    /**
     * The rounding cases.
     *
     * <p>Every one of these is an amount whose fee does not land on a whole minor unit, which
     * is where a naive implementation loses a qəpik — and where computing the net as a third
     * multiplication rather than as the remainder would make the three numbers disagree.
     */
    @ParameterizedTest
    @DisplayName("no minor unit is invented or lost, whatever the amount")
    @CsvSource({
        "0.01", "0.05", "0.99", "1.00", "3.33", "7.77", "9.99", "10.01",
        "33.33", "99.99", "100.01", "1234.56", "99999.99",
    })
    void roundingNeverDrifts(String amount) {
        Money gross = Money.of(new BigDecimal(amount), "AZN");
        FeeBreakdown breakdown = FEES.apply(gross, schedule("0.05000", "0.02900", "0.30"));

        assertThat(breakdown.balances())
                .withFailMessage(
                        "%s split into %s + %s + %s, which does not add back",
                        gross, breakdown.net(), breakdown.platformFee(), breakdown.processingFee())
                .isTrue();
        assertThat(breakdown.net().isNegative()).isFalse();
    }

    @Test
    @DisplayName("fees that would exceed the collection are clamped rather than going negative")
    void feesNeverExceedTheGross() {
        // A tiny pledge against a fixed processing amount larger than it. V55 refuses a
        // negative net by constraint, and this is what stops the service ever writing one --
        // it fails towards paying a creator nothing rather than towards a payout run that
        // stops with an exception for every campaign.
        FeeBreakdown breakdown = FEES.apply(Money.of(new BigDecimal("0.10"), "AZN"),
                schedule("0.05000", "0.02900", "5.00"));

        assertThat(breakdown.net().isNegative()).isFalse();
        assertThat(breakdown.net()).isEqualTo(Money.zero("AZN"));
        assertThat(breakdown.balances()).isTrue();
    }

    @Test
    @DisplayName("a zero-rate schedule takes nothing and still balances")
    void zeroRatesTakeNothing() {
        FeeBreakdown breakdown = FEES.apply(Money.of(new BigDecimal("42.00"), "AZN"),
                schedule("0.00000", "0.00000", "0.00"));

        assertThat(breakdown.totalFees()).isEqualTo(Money.zero("AZN"));
        assertThat(breakdown.net()).isEqualTo(Money.of(new BigDecimal("42.00"), "AZN"));
        assertThat(breakdown.balances()).isTrue();
    }

    @Test
    @DisplayName("IDN-EXT-01: with no schedule a withdrawal pays 15%, the bank inside it, and the creator receives 85%")
    void theDefaultIsFifteenPercent() {
        FeeBreakdown breakdown = FEES.applyDefault(Money.of(new BigDecimal("1000.00"), "AZN"));

        assertThat(breakdown.platformFee()).isEqualTo(Money.of(new BigDecimal("150.00"), "AZN"));
        assertThat(breakdown.processingFee()).isEqualTo(Money.zero("AZN"));
        assertThat(breakdown.net()).isEqualTo(Money.of(new BigDecimal("850.00"), "AZN"));
        assertThat(breakdown.balances()).isTrue();
        assertThat(breakdown.scheduleId()).isNull();
    }

    @Test
    @DisplayName("a free breakdown still balances, for a caller that has decided to charge nothing")
    void unconfiguredIsFree() {
        // The decision FeeSchedules argues at length: the payout run is a scheduled job over
        // every campaign that closed, so an exception there means nobody is paid rather than
        // one figure being wrong. Overpaying a creator is visible on the payout screen before
        // anybody approves it.
        FeeBreakdown breakdown = FeeBreakdown.free(Money.of(new BigDecimal("100.00"), "AZN"));

        assertThat(breakdown.net()).isEqualTo(Money.of(new BigDecimal("100.00"), "AZN"));
        assertThat(breakdown.scheduleId()).isNull();
        assertThat(breakdown.balances()).isTrue();
    }

    @Test
    @DisplayName("a schedule covers its own window and nothing outside it")
    void windowsAreHalfOpen() {
        FeeSchedule open = schedule("0.05000", "0.02900", "0.30");

        assertThat(open.coversInstant(Instant.parse("2026-01-01T00:00:00Z"))).isTrue();
        assertThat(open.coversInstant(Instant.parse("2025-12-31T23:59:59Z"))).isFalse();
        assertThat(open.coversInstant(Instant.parse("2030-01-01T00:00:00Z"))).isTrue();

        open.close(Instant.parse("2026-06-01T00:00:00Z"));

        // Half-open: the closing instant belongs to the successor, so no instant is priced
        // by two schedules and none falls between them.
        assertThat(open.coversInstant(Instant.parse("2026-05-31T23:59:59Z"))).isTrue();
        assertThat(open.coversInstant(Instant.parse("2026-06-01T00:00:00Z"))).isFalse();
    }
}
