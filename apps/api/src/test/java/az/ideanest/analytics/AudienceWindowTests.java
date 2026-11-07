package az.ideanest.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.analytics.domain.AudienceBucket;
import az.ideanest.analytics.domain.AudiencePeriod;
import az.ideanest.analytics.domain.AudienceWindow;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * #633's four periods as instants, in Asia/Baku, at the edges where a UTC calendar and
 * a Baku one disagree: the four hours after Baku midnight are still "yesterday" in UTC.
 */
class AudienceWindowTests {

    private static final ZoneId BAKU = ZoneId.of("Asia/Baku");

    /** 00:30 on 1 April 2026 in Baku, which is 20:30 on 31 March in UTC. */
    private static final Instant JUST_AFTER_BAKU_MIDNIGHT = Instant.parse("2026-03-31T20:30:00Z");

    @Test
    @DisplayName("day is today in Baku, by the hour, all twenty-four of them")
    void dayIsTodayInBaku() {
        AudienceWindow window = AudienceWindow.of(AudiencePeriod.DAY, JUST_AFTER_BAKU_MIDNIGHT, BAKU);

        assertThat(window.bucket()).isEqualTo(AudienceBucket.HOUR);
        assertThat(window.from()).isEqualTo(Instant.parse("2026-03-31T20:00:00Z"));
        assertThat(window.to()).isEqualTo(Instant.parse("2026-04-01T20:00:00Z"));
        assertThat(window.starts()).hasSize(24);
        assertThat(window.starts().getLast()).isEqualTo(Instant.parse("2026-04-01T19:00:00Z"));
    }

    @Test
    @DisplayName("week and month are the last seven and thirty Baku days, today included")
    void weekAndMonthCountBakuDays() {
        AudienceWindow week = AudienceWindow.of(AudiencePeriod.WEEK, JUST_AFTER_BAKU_MIDNIGHT, BAKU);
        AudienceWindow month = AudienceWindow.of(AudiencePeriod.MONTH, JUST_AFTER_BAKU_MIDNIGHT, BAKU);

        assertThat(week.bucket()).isEqualTo(AudienceBucket.DAY);
        assertThat(week.starts()).hasSize(7);
        assertThat(week.from()).isEqualTo(LocalDate.of(2026, 3, 26).atStartOfDay(BAKU).toInstant());
        assertThat(week.starts().getLast()).isEqualTo(LocalDate.of(2026, 4, 1).atStartOfDay(BAKU).toInstant());
        assertThat(week.to()).isEqualTo(LocalDate.of(2026, 4, 2).atStartOfDay(BAKU).toInstant());

        assertThat(month.starts()).hasSize(30);
        assertThat(month.from()).isEqualTo(LocalDate.of(2026, 3, 3).atStartOfDay(BAKU).toInstant());
        assertThat(month.to()).isEqualTo(week.to());
    }

    @Test
    @DisplayName("year is twelve calendar months, this one included, starting on the first")
    void yearIsTwelveCalendarMonths() {
        AudienceWindow year = AudienceWindow.of(AudiencePeriod.YEAR, JUST_AFTER_BAKU_MIDNIGHT, BAKU);

        assertThat(year.bucket()).isEqualTo(AudienceBucket.MONTH);
        assertThat(year.starts()).hasSize(12);
        // April in Baku, although it is still March in UTC.
        assertThat(year.starts().getLast()).isEqualTo(LocalDate.of(2026, 4, 1).atStartOfDay(BAKU).toInstant());
        assertThat(year.from()).isEqualTo(LocalDate.of(2025, 5, 1).atStartOfDay(BAKU).toInstant());
        assertThat(year.to()).isEqualTo(LocalDate.of(2026, 5, 1).atStartOfDay(BAKU).toInstant());
    }

    @Test
    @DisplayName("an hour belongs to the Baku day and month it starts in, and the edges are half-open")
    void bucketsFollowTheBakuCalendar() {
        AudienceWindow month = AudienceWindow.of(AudiencePeriod.MONTH, JUST_AFTER_BAKU_MIDNIGHT, BAKU);
        AudienceWindow year = AudienceWindow.of(AudiencePeriod.YEAR, JUST_AFTER_BAKU_MIDNIGHT, BAKU);

        Instant lastHourOfMarch = Instant.parse("2026-03-31T19:00:00Z");
        Instant firstHourOfApril = Instant.parse("2026-03-31T20:00:00Z");

        assertThat(month.bucketOf(lastHourOfMarch)).isEqualTo(LocalDate.of(2026, 3, 31).atStartOfDay(BAKU).toInstant());
        assertThat(month.bucketOf(firstHourOfApril)).isEqualTo(LocalDate.of(2026, 4, 1).atStartOfDay(BAKU).toInstant());
        assertThat(year.bucketOf(lastHourOfMarch)).isEqualTo(LocalDate.of(2026, 3, 1).atStartOfDay(BAKU).toInstant());
        assertThat(year.bucketOf(firstHourOfApril)).isEqualTo(LocalDate.of(2026, 4, 1).atStartOfDay(BAKU).toInstant());

        assertThat(month.bucketOf(month.from())).isEqualTo(month.from());
        assertThat(month.bucketOf(month.from().minusSeconds(1))).isNull();
        assertThat(month.bucketOf(month.to())).isNull();
    }

    @Test
    @DisplayName("every bucket start is the end of the one before it, so the series has no gaps")
    void bucketsAreContiguous() {
        for (AudiencePeriod period : AudiencePeriod.values()) {
            AudienceWindow window = AudienceWindow.of(period, JUST_AFTER_BAKU_MIDNIGHT, BAKU);
            List<Instant> starts = window.starts();
            for (int i = 0; i < starts.size(); i++) {
                assertThat(window.bucketOf(starts.get(i))).as("%s bucket %d", period, i).isEqualTo(starts.get(i));
                if (i > 0) {
                    assertThat(window.bucketOf(starts.get(i).minusSeconds(1))).isEqualTo(starts.get(i - 1));
                }
            }
        }
    }

    @Test
    @DisplayName("the wire names are lower-case and nothing else parses")
    void periodsParseOnlyTheirWireNames() {
        assertThat(AudiencePeriod.fromWire("week")).contains(AudiencePeriod.WEEK);
        assertThat(AudiencePeriod.fromWire("WEEK")).isEmpty();
        assertThat(AudiencePeriod.fromWire("quarter")).isEmpty();
        assertThat(AudiencePeriod.fromWire(null)).isEmpty();
    }

    @Test
    @DisplayName("a window must start at its first bucket")
    void aWindowIsConsistent() {
        Instant start = Instant.parse("2026-01-01T00:00:00Z");
        assertThatThrownBy(() -> new AudienceWindow(AudiencePeriod.DAY, BAKU, start, start.plusSeconds(60), List.of()))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
