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
import org.hibernate.generator.EventType;

/**
 * One recorded move in a campaign's life.
 *
 * <p><strong>Append-only.</strong> There is no setter on this class and no
 * repository method that updates or deletes one. The value of an audit trail is
 * entirely in the fact that it cannot be tidied up afterwards: a moderation
 * decision that let a campaign collect money from the public has to remain
 * reviewable by somebody who was not in the room, and a row that can be edited
 * is a row that says whatever the last writer wanted it to say.
 *
 * <p>{@code fromState} is null exactly once per campaign, on creation — there is
 * no state before {@link ProjectState#DRAFT}. Recording creation as a transition
 * rather than inferring it from {@code created_at} means the history reads as a
 * complete sequence without a special case at the front.
 *
 * <p>The actor is an identifier rather than an association, for the reason given
 * on {@link Project}: {@code users} belongs to another module.
 *
 * <p><strong>History may name two states {@link ProjectState} no longer has</strong>:
 * {@code COLLECTING} and {@code LATE_PLEDGE}, retired by #45. The table's check still
 * allows them, because an audit row is not rewritten. No production read loads such a row
 * as this entity — the creator's checklist loads staff decisions only, and the console and
 * dashboard read the history as text — so a new reader of a whole history must do the same.
 */
@Entity
@Table(name = "project_state_transitions")
public class ProjectStateTransition {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_state", updatable = false)
    private ProjectState fromState;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_state", nullable = false, updatable = false)
    private ProjectState toState;

    @Column(name = "actor_id", updatable = false)
    private UUID actorId;

    @Enumerated(EnumType.STRING)
    @Column(name = "actor_role", nullable = false, updatable = false)
    private ActorRole actorRole;

    @Column(name = "note", updatable = false)
    private String note;

    /**
     * The database's clock, not the application's, and read back after the insert so
     * that the row can be reported in the response that created it. A history whose
     * ordering depended on which instance wrote it would be a history that cannot be
     * read as a sequence.
     */
    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected ProjectStateTransition() {
        // JPA.
    }

    private ProjectStateTransition(
            UUID projectId, ProjectState fromState, ProjectState toState, ActorRole actorRole, UUID actorId,
            String note) {
        this.id = Identifiers.newIdentifier();
        this.projectId = projectId;
        this.fromState = fromState;
        this.toState = toState;
        this.actorRole = actorRole;
        this.actorId = actorId;
        this.note = note;
    }

    /**
     * The row for a campaign coming into existence.
     *
     * <p>Separate from {@link #of} so that the one legitimate null
     * {@code fromState} in the table is written by a method that says that is
     * what it is doing, rather than by a caller passing null and being trusted.
     */
    public static ProjectStateTransition creation(UUID projectId, UUID creatorId) {
        return new ProjectStateTransition(
                projectId, null, ProjectStateMachine.initial(), ActorRole.CREATOR, creatorId, null);
    }

    /**
     * @param actorId the account that acted, or null for {@link ActorRole#SYSTEM}.
     *     The database refuses any other role without one
     * @param note what the creator is shown: a moderator's reason, or the
     *     creator's own reason for cancelling. Null when the transition needs no
     *     explanation
     */
    public static ProjectStateTransition of(
            UUID projectId, ProjectState fromState, ProjectState toState, ActorRole actorRole, UUID actorId,
            String note) {
        Objects.requireNonNull(fromState, "Only creation has no previous state");
        return new ProjectStateTransition(projectId, fromState, toState, actorRole, actorId, note);
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public ProjectState getFromState() {
        return fromState;
    }

    public ProjectState getToState() {
        return toState;
    }

    public UUID getActorId() {
        return actorId;
    }

    public ActorRole getActorRole() {
        return actorRole;
    }

    public String getNote() {
        return note;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        return other instanceof ProjectStateTransition transition && Objects.equals(id, transition.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }

    @Override
    public String toString() {
        // No note: it is written for the creator and can quote the content of an
        // unlaunched campaign.
        return "ProjectStateTransition[project=" + projectId + ", " + fromState + "->" + toState + ", by "
                + actorRole + "]";
    }
}
