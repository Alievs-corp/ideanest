package az.ideanest.pledge.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * One line of a {@link PledgeRaise} — #171, V83's {@code pledge_raise_lines}.
 *
 * <p>Two kinds in one table, because both are "a tier and a number" belonging to the same attempt:
 * an {@link Kind#ADDON} line is part of the selection the pledge will carry once the raise is paid
 * for, and a {@link Kind#HOLD} line is places reserved on a tier while the raise is pending. The hold
 * is stored rather than recomputed from the pledge, because by the time it is given back the pledge
 * may no longer be the one it was computed from.
 */
@Entity
@Table(name = "pledge_raise_lines")
public class PledgeRaiseLine {

    /** What a line is for. */
    public enum Kind {
        /** An add-on line of the new selection. */
        ADDON,
        /** Places held for the raise while it is pending. */
        HOLD
    }

    @Embeddable
    public static class Key implements Serializable {

        @Column(name = "raise_id", nullable = false, updatable = false)
        private UUID raiseId;

        @Enumerated(EnumType.STRING)
        @Column(name = "kind", nullable = false, updatable = false)
        private Kind kind;

        @Column(name = "reward_tier_id", nullable = false, updatable = false)
        private UUID rewardTierId;

        protected Key() {
            // JPA.
        }

        public Key(UUID raiseId, Kind kind, UUID rewardTierId) {
            this.raiseId = Objects.requireNonNull(raiseId, "A line belongs to a raise");
            this.kind = Objects.requireNonNull(kind, "A line is an add-on or a hold");
            this.rewardTierId = Objects.requireNonNull(rewardTierId, "A line names a tier");
        }

        public UUID getRaiseId() {
            return raiseId;
        }

        public Kind getKind() {
            return kind;
        }

        public UUID getRewardTierId() {
            return rewardTierId;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            return other instanceof Key key
                    && Objects.equals(raiseId, key.raiseId)
                    && kind == key.kind
                    && Objects.equals(rewardTierId, key.rewardTierId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(raiseId, kind, rewardTierId);
        }
    }

    @EmbeddedId
    private Key id;

    @Column(name = "quantity", nullable = false, updatable = false)
    private int quantity;

    protected PledgeRaiseLine() {
        // JPA.
    }

    public static PledgeRaiseLine of(UUID raiseId, Kind kind, UUID rewardTierId, int quantity) {
        if (quantity < 1) {
            throw new IllegalArgumentException("A line is for at least one of something");
        }
        PledgeRaiseLine line = new PledgeRaiseLine();
        line.id = new Key(raiseId, kind, rewardTierId);
        line.quantity = quantity;
        return line;
    }

    public UUID getRaiseId() {
        return id.getRaiseId();
    }

    public Kind getKind() {
        return id.getKind();
    }

    public UUID getRewardTierId() {
        return id.getRewardTierId();
    }

    public int getQuantity() {
        return quantity;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof PledgeRaiseLine line && Objects.equals(id, line.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        return "PledgeRaiseLine[raise=" + getRaiseId() + ", kind=" + getKind() + ", tier=" + getRewardTierId()
                + ", quantity=" + quantity + "]";
    }
}
