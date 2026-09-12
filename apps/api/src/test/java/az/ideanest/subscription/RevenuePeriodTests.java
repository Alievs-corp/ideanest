package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.subscription.application.InvalidRevenuePeriodException;
import az.ideanest.subscription.application.RevenuePeriod;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What a revenue period means when somebody does not say — #23.
 *
 * <p>A pure function, so no container: {@code AbstractIntegrationTest}'s own header says a
 * test that needs no database should not start one.
 *
 * <p><strong>The test that carries the design is {@link #thisMonthIsBakusMonth()}.</strong>
 * Baku is UTC+4, and a default computed in UTC would put the evening of the 30th into the
 * next month — which is the figure an operator checks against a bank statement, and the one
 * place a four-hour discrepancy is a wrong number rather than a rounding.
 */
class RevenuePeriodTests {

    @Test
    @DisplayName("no period means the current month in Baku, not in UTC")
    void thisMonthIsBakusMonth() {
        // 21:30 UTC on 30 September is 01:30 on 1 October in Baku. A UTC default would
        // answer September here, and everything paid in the last four hours of the local
        // month would be reported in the wrong one.
        Clock clock = Clock.fixed(Instant.parse("2026-09-30T21:30:00Z"), ZoneOffset.UTC);

        RevenuePeriod period = RevenuePeriod.of(null, null, clock);

        assertThat(period.from()).isEqualTo(Instant.parse("2026-09-30T20:00:00Z"));
        assertThat(period.to()).isEqualTo(Instant.parse("2026-10-31T20:00:00Z"));
    }

    @Test
    @DisplayName("one bound given means that bound's month, never everything since")
    void oneBoundIsAMonthNotAnOpenEnd() {
        Clock clock = Clock.fixed(Instant.parse("2026-12-15T12:00:00Z"), ZoneOffset.UTC);

        // "From 10 March" is March. The open-ended reading is the expensive query, and
        // nobody asks for it by leaving a field empty.
        RevenuePeriod fromOnly = RevenuePeriod.of(Instant.parse("2026-03-10T08:00:00Z"), null, clock);
        assertThat(fromOnly.from()).isEqualTo(Instant.parse("2026-03-10T08:00:00Z"));
        assertThat(fromOnly.to()).isEqualTo(Instant.parse("2026-03-31T20:00:00Z"));

        RevenuePeriod toOnly = RevenuePeriod.of(null, Instant.parse("2026-03-10T08:00:00Z"), clock);
        assertThat(toOnly.from()).isEqualTo(Instant.parse("2026-02-28T20:00:00Z"));
        assertThat(toOnly.to()).isEqualTo(Instant.parse("2026-03-10T08:00:00Z"));
    }

    @Test
    @DisplayName("an explicit pair is taken as given, and not moved into Baku's calendar")
    void explicitBoundsAreNotReinterpreted() {
        Instant from = Instant.parse("2026-05-02T03:04:05Z");
        Instant to = Instant.parse("2026-05-09T00:00:00Z");

        RevenuePeriod period = RevenuePeriod.of(from, to, Clock.systemUTC());

        assertThat(period.from()).isEqualTo(from);
        assertThat(period.to()).isEqualTo(to);
    }

    @Test
    @DisplayName("ends the wrong way round, or equal, are refused rather than swapped")
    void backwardsIsRefused() {
        Instant instant = Instant.parse("2026-05-02T00:00:00Z");

        assertThatThrownBy(() -> RevenuePeriod.of(instant, instant.minusSeconds(1), Clock.systemUTC()))
                .isInstanceOf(InvalidRevenuePeriodException.class);

        // Equal ends describe an empty half-open window, which a screen would draw as a
        // month of zeroes for what was a mistyped date.
        assertThatThrownBy(() -> RevenuePeriod.of(instant, instant, Clock.systemUTC()))
                .isInstanceOf(InvalidRevenuePeriodException.class);
    }

    @Test
    @DisplayName("more than the maximum window is refused rather than clamped")
    void aWindowTooLongIsRefused() {
        Instant from = Instant.parse("2024-01-01T00:00:00Z");

        assertThat(RevenuePeriod.of(from, from.plus(RevenuePeriod.MAX_DAYS, ChronoUnit.DAYS), Clock.systemUTC()))
                .isNotNull();

        // A clamped window would return a figure for a period nobody asked about.
        assertThatThrownBy(() -> RevenuePeriod.of(
                        from, from.plus(RevenuePeriod.MAX_DAYS + 1, ChronoUnit.DAYS), Clock.systemUTC()))
                .isInstanceOf(InvalidRevenuePeriodException.class);
    }

    @Test
    @DisplayName("a month's label names its last day, not the exclusive bound after it")
    void theLabelNamesTheDaysCovered() {
        RevenuePeriod september = RevenuePeriod.monthOf(Instant.parse("2026-09-12T10:00:00Z"));

        // Ending "2026-10-01" would file September's export under October.
        assertThat(september.label()).isEqualTo("2026-09-01_2026-09-30");
    }
}
