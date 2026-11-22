package az.ideanest.verification.infrastructure;

import az.ideanest.verification.domain.StudentVerification;
import az.ideanest.verification.domain.StudentVerificationState;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/**
 * V127's {@code student_verifications} — #655.
 *
 * <p>No query here lists photographs across people, and none answers a card number to anybody but
 * {@code StudentVerifications}, which is where the access rules live.
 */
public interface StudentVerificationRepository extends JpaRepository<StudentVerification, UUID> {

    /** An account's submissions, newest first. The first is its standing. */
    List<StudentVerification> findByAccountIdOrderBySubmittedAtDesc(UUID accountId);

    /** Every submission of one normalised card number, on any account, in any state. */
    List<StudentVerification> findByCardNumberOrderBySubmittedAtDesc(String cardNumber);

    /** Every submission of any of these card numbers — the console's "used elsewhere" column. */
    List<StudentVerification> findByCardNumberIn(Collection<String> cardNumbers);

    /** The review queue: waiting, oldest first. */
    List<StudentVerification> findByStateOrderBySubmittedAtAsc(StudentVerificationState state, Pageable page);

    /** Approved rows that still count, newest decision first. */
    @Query("""
            select v from StudentVerification v
             where v.state = az.ideanest.verification.domain.StudentVerificationState.APPROVED
               and v.validUntil > :now
             order by v.decidedAt desc
            """)
    List<StudentVerification> approvedAt(Instant now, Pageable page);

    /** Refused or revoked rows, newest decision first. */
    @Query("""
            select v from StudentVerification v
             where v.state = az.ideanest.verification.domain.StudentVerificationState.REJECTED
             order by v.decidedAt desc
            """)
    List<StudentVerification> rejected(Pageable page);

    /** Approvals that have run out, retired or not, newest expiry first. */
    @Query("""
            select v from StudentVerification v
             where v.state = az.ideanest.verification.domain.StudentVerificationState.EXPIRED
                or (v.state = az.ideanest.verification.domain.StudentVerificationState.APPROVED
                    and v.validUntil <= :now)
             order by v.validUntil desc
            """)
    List<StudentVerification> expiredAt(Instant now, Pageable page);

    /** Approvals whose year has run out and whose row still says APPROVED — the sweep's work. */
    @Query("""
            select v from StudentVerification v
             where v.state = az.ideanest.verification.domain.StudentVerificationState.APPROVED
               and v.validUntil <= :now
            """)
    List<StudentVerification> approvalsRunOutBy(Instant now);

    /**
     * The rows that could stand in a new submission's way in V127's indexes: this account's, and
     * every row of this card, that are pending or approved.
     */
    @Query("""
            select v from StudentVerification v
             where (v.accountId = :accountId or v.cardNumber = :cardNumber)
               and v.state in (az.ideanest.verification.domain.StudentVerificationState.PENDING,
                               az.ideanest.verification.domain.StudentVerificationState.APPROVED)
            """)
    List<StudentVerification> openForAccountOrCard(UUID accountId, String cardNumber);

    Optional<StudentVerification> findFirstByAccountIdOrderBySubmittedAtDesc(UUID accountId);

    /** Anonymisation — #655: every submission an account made, with its photographs by cascade. */
    @Modifying
    @Query("delete from StudentVerification v where v.accountId = :accountId")
    int deleteByAccount(UUID accountId);
}
