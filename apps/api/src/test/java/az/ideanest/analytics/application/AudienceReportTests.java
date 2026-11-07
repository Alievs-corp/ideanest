package az.ideanest.analytics.application;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.analytics.domain.AudiencePeriod;
import az.ideanest.analytics.domain.AudienceWindow;
import az.ideanest.support.AbstractIntegrationTest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * #633's reads against the real table, at the edges a UTC calendar gets wrong.
 *
 * <p>Rows are written in 2019 and 2020, which no other test and no live event reaches,
 * and the windows are built for a fixed instant: 00:30 on 1 April 2020 in Baku, which is
 * still 31 March in UTC. Two rows sit either side of Baku midnight — 23:00 on 31 March
 * and 00:00 on 1 April, local — and must land in different days and different months.
 */
class AudienceReportTests extends AbstractIntegrationTest {

    private static final ZoneId BAKU = ZoneId.of("Asia/Baku");

    private static final Instant NOW = Instant.parse("2020-03-31T20:30:00Z");

    private static final Instant LAST_HOUR_OF_MARCH = Instant.parse("2020-03-31T19:00:00Z");

    private static final Instant FIRST_HOUR_OF_APRIL = Instant.parse("2020-03-31T20:00:00Z");

    /** 23:00 on 30 April 2019 in Baku: one hour before the year window opens. */
    private static final Instant BEFORE_THE_YEAR = Instant.parse("2019-04-30T19:00:00Z");

    /** 00:00 on 1 May 2019 in Baku: the year window's first hour. */
    private static final Instant FIRST_HOUR_OF_THE_YEAR = Instant.parse("2019-04-30T20:00:00Z");

    @Autowired
    private AudienceReports reports;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        new JdbcTemplate(dataSource).update("DELETE FROM audience_hourly WHERE hour < '2021-01-01'");
    }

    @Test
    @DisplayName("day: twenty-four hourly points from Baku midnight, the hour before it excluded")
    void dayIsTheBakuDay() {
        site(LAST_HOUR_OF_MARCH, 5, 9);
        site(FIRST_HOUR_OF_APRIL, 2, 3);

        PlatformAudience day = reports.platform(AudienceWindow.of(AudiencePeriod.DAY, NOW, BAKU), NOW);

        assertThat(day.series()).hasSize(24);
        assertThat(day.series().getFirst().start()).isEqualTo(FIRST_HOUR_OF_APRIL);
        assertThat(day.series().getFirst().visitors()).isEqualTo(2);
        assertThat(day.series().subList(1, 24)).allSatisfy(point -> assertThat(point.pageViews()).isZero());
        assertThat(day.totals().visitors()).isEqualTo(2);
        assertThat(day.totals().pageViews()).isEqualTo(3);
    }

    @Test
    @DisplayName("month: thirty daily points, zero-filled, split at Baku midnight rather than UTC's")
    void monthSplitsAtBakuMidnight() {
        site(LAST_HOUR_OF_MARCH, 5, 9);
        site(FIRST_HOUR_OF_APRIL, 2, 3);
        site(Instant.parse("2020-03-31T08:00:00Z"), 1, 1);

        PlatformAudience month = reports.platform(AudienceWindow.of(AudiencePeriod.MONTH, NOW, BAKU), NOW);

        List<PlatformAudience.Point> series = month.series();
        assertThat(series).hasSize(30);
        PlatformAudience.Point march31 = series.get(28);
        PlatformAudience.Point april1 = series.get(29);
        assertThat(march31.start()).isEqualTo(LocalDate.of(2020, 3, 31).atStartOfDay(BAKU).toInstant());
        assertThat(march31.visitors()).isEqualTo(6);
        assertThat(march31.pageViews()).isEqualTo(10);
        assertThat(april1.visitors()).isEqualTo(2);
        assertThat(series.subList(0, 28)).allSatisfy(point -> {
            assertThat(point.visitors()).isZero();
            assertThat(point.pageViews()).isZero();
        });
        assertThat(month.totals().visitors()).isEqualTo(8);
        assertThat(month.totals().pageViews()).isEqualTo(13);
    }

    @Test
    @DisplayName("year: twelve calendar months in Baku, the month edges on both ends exact")
    void yearSplitsAtBakuMonths() {
        site(BEFORE_THE_YEAR, 100, 100);
        site(FIRST_HOUR_OF_THE_YEAR, 1, 1);
        site(LAST_HOUR_OF_MARCH, 5, 9);
        site(FIRST_HOUR_OF_APRIL, 2, 3);

        PlatformAudience year = reports.platform(AudienceWindow.of(AudiencePeriod.YEAR, NOW, BAKU), NOW);

        List<PlatformAudience.Point> series = year.series();
        assertThat(series).hasSize(12);
        assertThat(series.getFirst().start()).isEqualTo(FIRST_HOUR_OF_THE_YEAR);
        assertThat(series.getFirst().visitors()).isEqualTo(1);
        assertThat(series.get(10).visitors()).as("March").isEqualTo(5);
        assertThat(series.get(11).visitors()).as("April").isEqualTo(2);
        assertThat(series.subList(1, 10)).allSatisfy(point -> assertThat(point.visitors()).isZero());
        assertThat(year.totals().visitors()).isEqualTo(8);
    }

    @Test
    @DisplayName("countries and platforms are site visitors, most first, unknown included")
    void breakdownsAreSorted() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        insert(jdbc, FIRST_HOUR_OF_APRIL, "AZ", "WEB", 3, 3);
        insert(jdbc, FIRST_HOUR_OF_APRIL, "ZZ", "ANDROID", 5, 6);
        insert(jdbc, FIRST_HOUR_OF_APRIL.plusSeconds(3_600), "AZ", "ANDROID", 4, 4);

        PlatformAudience day = reports.platform(AudienceWindow.of(AudiencePeriod.DAY, NOW, BAKU), NOW);

        assertThat(day.countries()).containsExactly(
                new PlatformAudience.Labelled("AZ", 7), new PlatformAudience.Labelled("ZZ", 5));
        assertThat(day.platforms()).containsExactly(
                new PlatformAudience.Labelled("ANDROID", 9), new PlatformAudience.Labelled("WEB", 3));
    }

    private void site(Instant hour, int visitors, int pageViews) {
        insert(new JdbcTemplate(dataSource), hour, "AZ", "WEB", visitors, pageViews);
    }

    private static void insert(JdbcTemplate jdbc, Instant hour, String country, String platform, int visitors, int pageViews) {
        jdbc.update(
                """
                INSERT INTO audience_hourly (hour, project_id, country, platform, visitors, page_views)
                VALUES (?, NULL, ?, ?, ?, ?)
                """,
                Timestamp.from(hour),
                country,
                platform,
                visitors,
                pageViews);
    }
}
