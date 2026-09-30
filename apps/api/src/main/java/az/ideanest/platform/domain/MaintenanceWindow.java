package az.ideanest.platform.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * One maintenance window — V91's row, issue #214.
 *
 * <p><strong>The rules about time live here</strong>, for {@link FeatureFlag}'s reason:
 * "is this window in force" is asked by the servlet filter, the status endpoint, the job
 * runner and the auth module, and it has to be the same function every time. Each
 * predicate takes the instant to judge against rather than reading a clock, so the
 * cached snapshot can be re-judged on every request without being re-read.
 */
@Entity
@Table(name = "maintenance_windows")
public class MaintenanceWindow {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    @Column(name = "announce_from", nullable = false)
    private Instant announceFrom;

    @Column(name = "note")
    private String note;

    @Column(name = "created_by", updatable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    protected MaintenanceWindow() {
        // Hibernate.
    }

    public MaintenanceWindow(
            UUID id, Instant startsAt, Instant endsAt, Instant announceFrom, String note, UUID createdBy, Instant now) {
        this.id = Objects.requireNonNull(id, "id");
        this.startsAt = Objects.requireNonNull(startsAt, "startsAt");
        this.endsAt = endsAt;
        this.announceFrom = Objects.requireNonNull(announceFrom, "announceFrom");
        this.note = note;
        this.createdBy = createdBy;
        this.createdAt = Objects.requireNonNull(now, "now");
    }

    /** Where a window is, judged at one instant. */
    public enum State {
        /** Scheduled, and too far off for readers to be told yet. */
        SCHEDULED,
        /** Readers are being told: {@code announce_from <= now < starts_at}. */
        ANNOUNCED,
        /** In force: the platform is closed. */
        ACTIVE,
        /** Over — its announced end passed, or an operator ended it. */
        ENDED,
        /** Called off before it started. */
        CANCELLED
    }

    public State stateAt(Instant now) {
        if (cancelledAt != null) {
            return State.CANCELLED;
        }
        if (endedAt != null || (endsAt != null && !endsAt.isAfter(now))) {
            return State.ENDED;
        }
        if (!startsAt.isAfter(now)) {
            return State.ACTIVE;
        }
        return announceFrom.isAfter(now) ? State.SCHEDULED : State.ANNOUNCED;
    }

    public boolean isActiveAt(Instant now) {
        return stateAt(now) == State.ACTIVE;
    }

    public boolean isAnnouncedAt(Instant now) {
        return stateAt(now) == State.ANNOUNCED;
    }

    /** Opens the window now rather than at its scheduled start. */
    public void startAt(Instant now) {
        this.startsAt = now;
        if (announceFrom.isAfter(now)) {
            this.announceFrom = now;
        }
    }

    /** Closes the window now rather than at its announced end. */
    public void endAt(Instant now) {
        this.endedAt = now;
    }

    public void cancelAt(Instant now) {
        this.cancelledAt = now;
    }

    public void changeEnd(Instant endsAt) {
        this.endsAt = endsAt;
    }

    public void changeNote(String note) {
        this.note = note;
    }

    /**
     * The end that is actually in force: when it was ended, or when it was announced to
     * end, or null for "until further notice". What V91's exclusion constraint compares.
     */
    public Instant effectiveEnd() {
        return endedAt != null ? endedAt : endsAt;
    }

    /** Whether this window's span — announcement to effective end — overlaps another's. */
    public boolean overlaps(MaintenanceWindow other) {
        if (other.cancelledAt != null || cancelledAt != null) {
            return false;
        }
        Instant end = effectiveEnd();
        Instant otherEnd = other.effectiveEnd();
        boolean startsBeforeOtherEnds = otherEnd == null || announceFrom.isBefore(otherEnd);
        boolean otherStartsBeforeThisEnds = end == null || other.announceFrom.isBefore(end);
        return startsBeforeOtherEnds && otherStartsBeforeThisEnds;
    }

    public UUID id() {
        return id;
    }

    public Instant startsAt() {
        return startsAt;
    }

    public Instant endsAt() {
        return endsAt;
    }

    public Instant announceFrom() {
        return announceFrom;
    }

    public String note() {
        return note;
    }

    public UUID createdBy() {
        return createdBy;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public Instant endedAt() {
        return endedAt;
    }

    public Instant cancelledAt() {
        return cancelledAt;
    }

    /** One line for the audit trail's before/after. */
    public String describe() {
        return "startsAt=%s, endsAt=%s, announceFrom=%s, endedAt=%s, cancelledAt=%s, note=%s"
                .formatted(
                        startsAt,
                        endsAt,
                        announceFrom,
                        endedAt,
                        cancelledAt,
                        note == null ? "none" : "\"" + note + "\"");
    }
}
