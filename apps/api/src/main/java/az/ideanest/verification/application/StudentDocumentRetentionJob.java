package az.ideanest.verification.application;

import az.ideanest.shared.jobs.ScheduledJob;
import az.ideanest.verification.VerificationProperties;
import az.ideanest.verification.domain.StudentVerification;
import az.ideanest.verification.infrastructure.StudentDocumentRepository;
import az.ideanest.verification.infrastructure.StudentVerificationRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The backstop behind student verification's retention — #655, {@link DocumentRetentionJob}'s
 * pattern.
 *
 * <p>A decision erases the photographs at once; this covers the submission nobody decides. A
 * photograph older than {@code ideanest.verification.documents.unreviewed-retention} (sixty days)
 * is destroyed whatever its submission says, so a queue nobody works does not become an archive of
 * student cards and faces. The submission stays, pending, with nothing to look at: a reviewer
 * refuses it and the creator sends new photographs.
 *
 * <p>The same pass retires approvals whose year has run out, which is what keeps V127's indexes
 * from holding a card for an account that no longer qualifies — a submission retires them too,
 * when one is in its way, so this is tidiness rather than the rule.
 */
@Component
public class StudentDocumentRetentionJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(StudentDocumentRetentionJob.class);

    /** Daily, ten minutes after the identity sweep, for that job's reason for not being on the hour. */
    private static final String SCHEDULE = "0 50 3 * * *";

    private final StudentVerificationRepository verifications;
    private final StudentDocumentRepository documents;
    private final VerificationProperties properties;
    private final Clock clock;

    public StudentDocumentRetentionJob(
            StudentVerificationRepository verifications,
            StudentDocumentRepository documents,
            VerificationProperties properties,
            Clock clock) {
        this.verifications = verifications;
        this.documents = documents;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public String name() {
        return "student-document-retention";
    }

    @Override
    public String schedule() {
        return SCHEDULE;
    }

    @Override
    public void run() {
        sweep(clock.instant());
    }

    /**
     * One pass, judged against one instant.
     *
     * @return how many photographs were destroyed
     */
    @Transactional
    public int sweep(Instant now) {
        List<StudentVerification> runOut = verifications.approvalsRunOutBy(now);
        runOut.forEach(verification -> verification.retire(now));
        if (!runOut.isEmpty()) {
            log.info("Retired {} student verification approval(s) past their year.", runOut.size());
        }

        List<UUID> aged = documents.verificationsWithDocumentsBefore(
                now.minus(properties.documents().unreviewedRetention()));
        if (aged.isEmpty()) {
            return 0;
        }
        int destroyed = documents.deleteForVerifications(aged);
        verifications.findAllById(aged).forEach(verification -> verification.documentsErased(now));
        // The count and never a student.
        log.info("Retention sweep destroyed {} student verification photograph(s) across {} submission(s).",
                destroyed, aged.size());
        return destroyed;
    }
}
