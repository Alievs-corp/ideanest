package az.ideanest.subscription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** {@code ideanest.subscription.reminders}: what an operator may set, and what stops the process (#450). */
class SubscriptionReminderPropertiesTests {

    @Test
    @DisplayName("defaults to a daily pass, three days and one day before the end, and a week's look-back")
    void defaults() {
        SubscriptionReminderProperties properties = new SubscriptionReminderProperties(null, null, null, 0);

        assertThat(properties.schedule()).isEqualTo("0 0 9 * * *");
        assertThat(properties.leads()).containsExactly(Duration.ofDays(3), Duration.ofDays(1));
        assertThat(properties.lapsedLookBack()).isEqualTo(Duration.ofDays(7));
        assertThat(properties.batchSize()).isEqualTo(500);
    }

    @Test
    @DisplayName("reads the leads largest first, whatever order they were written in")
    void leadsAreSortedLargestFirst() {
        SubscriptionReminderProperties properties = new SubscriptionReminderProperties(
                "-", List.of(Duration.ofDays(1), Duration.ofDays(7), Duration.ofHours(36)), Duration.ofDays(3), 10);

        assertThat(properties.leads()).containsExactly(Duration.ofDays(7), Duration.ofHours(36), Duration.ofDays(1));
    }

    @Test
    @DisplayName("refuses a lead that is not a positive whole number of hours, or one given twice")
    void refusesALeadTheClaimCannotKey() {
        assertThatThrownBy(() -> new SubscriptionReminderProperties(null, List.of(Duration.ZERO), null, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new SubscriptionReminderProperties(null, List.of(Duration.ofMinutes(90)), null, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new SubscriptionReminderProperties(
                        null, List.of(Duration.ofDays(1), Duration.ofHours(24)), null, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("refuses a look-back that is not positive")
    void refusesAnEmptyLookBack() {
        assertThatThrownBy(() -> new SubscriptionReminderProperties(null, null, Duration.ZERO, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
