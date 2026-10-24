package az.ideanest.project.infrastructure;

import az.ideanest.project.domain.ProjectRevision;
import az.ideanest.project.domain.RevisionStatus;
import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Revisions of launched campaigns, by the questions asked of them.
 *
 * <p>The open revision is looked up by campaign because there is at most one (V117's partial
 * unique index), and the queue by status, oldest submission first.
 */
public interface ProjectRevisionRepository extends JpaRepository<ProjectRevision, UUID> {

    /** The revision the creator is working on or has submitted, or empty. */
    @Query("SELECT r FROM ProjectRevision r WHERE r.projectId = :projectId AND r.status IN :open")
    Optional<ProjectRevision> findOpenByProjectId(
            @Param("projectId") UUID projectId, @Param("open") Collection<RevisionStatus> open);

    default Optional<ProjectRevision> findOpenByProjectId(UUID projectId) {
        return findOpenByProjectId(projectId, RevisionStatus.OPEN);
    }

    /** Locked, for the moderator's decision: two decisions on one revision must not both apply. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM ProjectRevision r WHERE r.id = :id")
    Optional<ProjectRevision> findByIdForUpdate(@Param("id") UUID id);

    List<ProjectRevision> findByStatusOrderBySubmittedAtAsc(RevisionStatus status, Pageable page);

    long countByStatus(RevisionStatus status);

    /** The campaigns that have a revision in the queue, for the page that lists it. */
    @Query("SELECT r FROM ProjectRevision r WHERE r.projectId = :projectId ORDER BY r.createdAt DESC")
    List<ProjectRevision> findHistory(@Param("projectId") UUID projectId, Pageable page);
}
