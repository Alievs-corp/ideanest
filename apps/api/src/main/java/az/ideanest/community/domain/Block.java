package az.ideanest.community.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Generated;
import org.hibernate.generator.EventType;

/**
 * One account blocking another — #324, and App Store Review Guideline 1.2.
 *
 * <p>The shape of {@link Follow} and for its reasons: no states, nothing edits it, unblocking
 * deletes the row, and registration is an {@code ON CONFLICT DO NOTHING} insert in the
 * repository rather than a constructor here.
 *
 * <p><strong>The two ends are named for their roles</strong>, as a follow's are. A swapped pair
 * is a row the database accepts and which hides the wrong person's comments from the wrong
 * reader, and the only case {@code user_blocks_is_not_self} can catch is the one where both ends
 * are the same account.
 */
@Entity
@Table(name = "user_blocks")
public class Block {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Who decided. The only account this row is ever shown to. */
    @Column(name = "blocker_id", nullable = false, updatable = false)
    private UUID blockerId;

    /** Who is blocked. Never told. */
    @Column(name = "blocked_id", nullable = false, updatable = false)
    private UUID blockedId;

    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected Block() {
        // JPA.
    }

    public UUID getId() {
        return id;
    }

    public UUID getBlockerId() {
        return blockerId;
    }

    public UUID getBlockedId() {
        return blockedId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        return other instanceof Block block && Objects.equals(id, block.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        return "Block[id=" + id + ", blocker=" + blockerId + ", blocked=" + blockedId + "]";
    }
}
