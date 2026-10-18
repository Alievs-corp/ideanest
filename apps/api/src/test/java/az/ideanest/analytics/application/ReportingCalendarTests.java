package az.ideanest.analytics.application;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.analytics.infrastructure.PlatformFiguresRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.assertj.core.api.Assertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The platform's day is named in three settings, and a deployment that set them apart would show
 * two totals for "the same" day on two screens. The service refuses to start instead.
 */
class ReportingCalendarTests {

    private static final ZoneId BAKU = ZoneId.of("Asia/Baku");

    @Test
    @DisplayName("three settings naming the same zone start")
    void oneZoneStarts() {
        assertThatCode(() -> PlatformAnalyticsService.requireOneCalendar(BAKU, BAKU, BAKU)).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a rollup zone that differs stops start-up and names every setting")
    void aDifferentRollupZoneFails() {
        assertThatThrownBy(() -> PlatformAnalyticsService.requireOneCalendar(BAKU, ZoneId.of("UTC"), BAKU))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("ideanest.analytics.aggregation.zone=UTC")
                .hasMessageContaining("ideanest.analytics.reporting.time-zone=Asia/Baku");
    }

    @Test
    @DisplayName("a fixed offset that matches today is still a different calendar")
    void anOffsetIsNotAZone() {
        assertThatThrownBy(() -> PlatformAnalyticsService.requireOneCalendar(ZoneId.of("+04:00"), BAKU, BAKU))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("the days between collected pledges are filled with zeros, in order")
    void everyDayIsFilled() {
        LocalDate first = LocalDate.of(2026, 10, 1);
        List<az.ideanest.analytics.application.PlatformAnalytics.DailyPoint> points = PlatformAnalyticsService.everyDay(
                first,
                first.plusDays(4),
                List.of(new PlatformFiguresRepository.DailyTotal(first.plusDays(2), 3, new BigDecimal("12.50"))),
                "AZN");

        Assertions.assertThat(points).extracting(PlatformAnalytics.DailyPoint::day)
                .containsExactly(first, first.plusDays(1), first.plusDays(2), first.plusDays(3), first.plusDays(4));
        Assertions.assertThat(points.get(2).pledgeCount()).isEqualTo(3);
        Assertions.assertThat(points.get(2).volume().amount()).isEqualByComparingTo("12.50");
        Assertions.assertThat(points.get(0).pledgeCount()).isZero();
        Assertions.assertThat(points.get(0).volume().currency()).isEqualTo("AZN");
    }
}
