package az.ideanest.platform;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.platform.domain.MaintenanceWindow;
import az.ideanest.platform.domain.MaintenanceWindow.State;
import az.ideanest.shared.maintenance.ActiveMaintenance;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** When a window is active or upcoming, and what overlaps — issue #214. */
class MaintenanceWindowRulesTests {

    private static final Instant START = Instant.parse("2026-10-04T22:00:00Z");

    private static final Instant END = Instant.parse("2026-10-04T22:30:00Z");

    private static final Instant ANNOUNCED = START.minus(Duration.ofHours(24));

    @Test
    @DisplayName("scheduled, then announced, then active, then ended — by the clock alone")
    void aWindowMovesThroughItsStates() {
        MaintenanceWindow window = window(ANNOUNCED, START, END);

        assertThat(window.stateAt(ANNOUNCED.minusSeconds(1))).isEqualTo(State.SCHEDULED);
        assertThat(window.stateAt(ANNOUNCED)).isEqualTo(State.ANNOUNCED);
        assertThat(window.stateAt(START.minusSeconds(1))).isEqualTo(State.ANNOUNCED);
        assertThat(window.stateAt(START)).isEqualTo(State.ACTIVE);
        assertThat(window.stateAt(END.minusSeconds(1))).isEqualTo(State.ACTIVE);
        assertThat(window.stateAt(END)).isEqualTo(State.ENDED);
    }

    @Test
    @DisplayName("an open-ended window stays active until somebody ends it")
    void anOpenEndIsActiveUntilEnded() {
        MaintenanceWindow window = window(ANNOUNCED, START, null);

        assertThat(window.isActiveAt(START.plus(Duration.ofDays(3)))).isTrue();

        window.endAt(START.plus(Duration.ofHours(1)));
        assertThat(window.stateAt(START.plus(Duration.ofHours(1)))).isEqualTo(State.ENDED);
    }

    @Test
    @DisplayName("ended early and cancelled are not active whatever the times say")
    void endedAndCancelledAreOver() {
        MaintenanceWindow ended = window(ANNOUNCED, START, END);
        ended.endAt(START.plusSeconds(60));
        assertThat(ended.isActiveAt(START.plusSeconds(120))).isFalse();

        MaintenanceWindow cancelled = window(ANNOUNCED, START, END);
        cancelled.cancelAt(ANNOUNCED.plusSeconds(60));
        assertThat(cancelled.stateAt(START.plusSeconds(60))).isEqualTo(State.CANCELLED);
        assertThat(cancelled.isAnnouncedAt(ANNOUNCED.plusSeconds(120))).isFalse();
    }

    @Test
    @DisplayName("starting now moves the start and never leaves the announcement after it")
    void startingNow() {
        MaintenanceWindow window = window(START.minus(Duration.ofHours(1)), START, END);
        Instant now = START.minus(Duration.ofHours(3));

        window.startAt(now);

        assertThat(window.startsAt()).isEqualTo(now);
        assertThat(window.announceFrom()).isEqualTo(now);
        assertThat(window.isActiveAt(now)).isTrue();
    }

    @Test
    @DisplayName("spans overlap from announcement to effective end; touching is not overlapping")
    void overlaps() {
        MaintenanceWindow first = window(ANNOUNCED, START, END);

        assertThat(first.overlaps(window(END.minusSeconds(1), END.plusSeconds(60), null))).isTrue();
        assertThat(first.overlaps(window(END, END.plusSeconds(60), END.plusSeconds(120)))).isFalse();
        assertThat(window(ANNOUNCED, START, null).overlaps(window(END.plus(Duration.ofDays(30)),
                        END.plus(Duration.ofDays(31)), null)))
                .as("an open end runs into everything after it")
                .isTrue();

        MaintenanceWindow endedEarly = window(ANNOUNCED, START, END);
        endedEarly.endAt(START.plusSeconds(60));
        assertThat(endedEarly.overlaps(window(START.plusSeconds(60), START.plusSeconds(120), null)))
                .as("ended early frees the rest of its span")
                .isFalse();

        MaintenanceWindow cancelled = window(ANNOUNCED, START, END);
        cancelled.cancelAt(ANNOUNCED);
        assertThat(cancelled.overlaps(first)).isFalse();
    }

    @Test
    @DisplayName("Retry-After: seconds to the end, rounded up, clamped to 30 s – 1 h, 300 without an end")
    void retryAfter() {
        Instant now = START.plusSeconds(60);

        assertThat(new ActiveMaintenance(START, null).retryAfterSeconds(now)).isEqualTo(300);
        assertThat(new ActiveMaintenance(START, now.plusSeconds(600)).retryAfterSeconds(now)).isEqualTo(600);
        assertThat(new ActiveMaintenance(START, now.plusMillis(600_400)).retryAfterSeconds(now)).isEqualTo(601);
        assertThat(new ActiveMaintenance(START, now.plusSeconds(10)).retryAfterSeconds(now)).isEqualTo(30);
        assertThat(new ActiveMaintenance(START, now.plus(Duration.ofHours(5))).retryAfterSeconds(now))
                .isEqualTo(3600);
    }

    private static MaintenanceWindow window(Instant announceFrom, Instant startsAt, Instant endsAt) {
        return new MaintenanceWindow(
                UUID.randomUUID(), startsAt, endsAt, announceFrom, null, UUID.randomUUID(), announceFrom);
    }
}
