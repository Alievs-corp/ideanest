package az.ideanest.project.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Generated;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.generator.EventType;
import org.hibernate.type.SqlTypes;

/**
 * A creator's proposed edit to a launched campaign, waiting for a moderator (V117).
 *
 * <p>The content is held as JSON text against a {@code jsonb} column, as
 * {@link Project#getStory()} is: the entity has no use for the document, and
 * {@code ProjectRevisionService} is what reads it into a {@link RevisionContent}.
 */
@Entity
@Table(name = "project_revisions")
public class ProjectRevision {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private RevisionStatus status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "content", nullable = false)
    private String content;

    @Column(name = "author_id", nullable = false)
    private UUID authorId;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "reason")
    private String reason;

    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Generated(event = {EventType.INSERT, EventType.UPDATE})
    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ProjectRevision() {
        // JPA.
    }

    private ProjectRevision(UUID projectId, String content, UUID authorId) {
        this.id = Identifiers.newIdentifier();
        this.projectId = projectId;
        this.status = RevisionStatus.DRAFT;
        this.content = content;
        this.authorId = authorId;
    }

    public static ProjectRevision draft(UUID projectId, String content, UUID authorId) {
        Objects.requireNonNull(projectId, "A revision belongs to a campaign");
        Objects.requireNonNull(content, "A revision holds content");
        Objects.requireNonNull(authorId, "A revision names who wrote it");
        return new ProjectRevision(projectId, content, authorId);
    }

    /** Replaces the working copy. Anything already submitted goes back to a draft. */
    public void rewrite(String content, UUID authorId) {
        requireOpen();
        this.content = content;
        this.authorId = authorId;
        this.status = RevisionStatus.DRAFT;
        this.submittedAt = null;
    }

    public void submit(Instant at) {
        if (status != RevisionStatus.DRAFT) {
            throw new IllegalStateException("Only a draft can be submitted, not " + status);
        }
        this.status = RevisionStatus.PENDING;
        this.submittedAt = at;
    }

    public void withdraw() {
        requireOpen();
        this.status = RevisionStatus.WITHDRAWN;
    }

    public void approve(UUID moderatorId, Instant at, String note) {
        decide(RevisionStatus.APPROVED, moderatorId, at, note);
    }

    public void reject(UUID moderatorId, Instant at, String reason) {
        decide(RevisionStatus.REJECTED, moderatorId, at, reason);
    }

    private void decide(RevisionStatus outcome, UUID moderatorId, Instant at, String note) {
        if (status != RevisionStatus.PENDING) {
            throw new IllegalStateException("Only a submitted revision can be decided, not " + status);
        }
        this.status = outcome;
        this.decidedBy = moderatorId;
        this.decidedAt = at;
        this.reason = note;
    }

    private void requireOpen() {
        if (!status.isOpen()) {
            throw new IllegalStateException("A " + status + " revision is closed");
        }
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public RevisionStatus getStatus() {
        return status;
    }

    public String getContent() {
        return content;
    }

    public UUID getAuthorId() {
        return authorId;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public Instant getDecidedAt() {
        return decidedAt;
    }

    public UUID getDecidedBy() {
        return decidedBy;
    }

    public String getReason() {
        return reason;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        return other instanceof ProjectRevision revision && Objects.equals(id, revision.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        return "ProjectRevision[" + id + ", " + status + "]";
    }
}
