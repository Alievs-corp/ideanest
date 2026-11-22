package az.ideanest.verification.application;

import az.ideanest.user.application.AccountStudentVerifications;
import az.ideanest.verification.infrastructure.StudentVerificationRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * An anonymised account's student verifications, deleted — {@code user}'s
 * {@link AccountStudentVerifications} (#655).
 *
 * <p>Every submission in every state, and its photographs with it by V127's cascade. The card
 * number goes too: kept, it would still say which student this account was, and the one-card rule
 * has nobody left to protect the card from.
 */
@Service
public class ClosedAccountStudentVerifications implements AccountStudentVerifications {

    private static final Logger log = LoggerFactory.getLogger(ClosedAccountStudentVerifications.class);

    private final StudentVerificationRepository verifications;

    public ClosedAccountStudentVerifications(StudentVerificationRepository verifications) {
        this.verifications = verifications;
    }

    /** Joins the anonymiser's transaction. No account in the log line, for the anonymiser's reason. */
    @Override
    @Transactional
    public int forgetAll(UUID userId) {
        int removed = verifications.deleteByAccount(userId);
        if (removed > 0) {
            log.info("Forgot {} student verification(s) of an anonymised account.", removed);
        }
        return removed;
    }
}
