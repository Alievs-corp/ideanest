package az.ideanest.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.verification.domain.StudentCardNumber;
import az.ideanest.verification.domain.StudentDocumentKind;
import az.ideanest.verification.domain.StudentVerification;
import az.ideanest.verification.domain.StudentVerificationState;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Student verification without a database — #655. */
class StudentVerificationDomainTests {

    private static final Instant NOW = Instant.parse("2026-02-28T09:00:00Z");

    private static final UUID STAFF = UUID.randomUUID();

    @Nested
    @DisplayName("a card number")
    class CardNumbers {

        @Test
        @DisplayName("is compared upper case, letters and digits only")
        void isNormalised() {
            assertThat(StudentCardNumber.normalise(" ab-12 345 ")).contains("AB12345");
            assertThat(StudentCardNumber.normalise("AB 12345")).contains("AB12345");
            assertThat(StudentCardNumber.normalise("ab12345")).contains("AB12345");
            assertThat(StudentCardNumber.normalise("t/2024.ə7")).contains("T2024Ə7");
        }

        @Test
        @DisplayName("is three to forty characters as typed, and three letters or digits at least")
        void hasALength() {
            assertThat(StudentCardNumber.normalise(null)).isEmpty();
            assertThat(StudentCardNumber.normalise("  ")).isEmpty();
            assertThat(StudentCardNumber.normalise("A1")).isEmpty();
            assertThat(StudentCardNumber.normalise("A-1")).isEmpty();
            assertThat(StudentCardNumber.normalise("A12")).contains("A12");
            assertThat(StudentCardNumber.normalise("1".repeat(40))).isPresent();
            assertThat(StudentCardNumber.normalise("1".repeat(41))).isEmpty();
        }
    }

    @Nested
    @DisplayName("a submission")
    class Transitions {

        @Test
        @DisplayName("waits for staff, and does not qualify while it does")
        void startsPending() {
            StudentVerification submitted = submitted();

            assertThat(submitted.stateAt(NOW)).isEqualTo(StudentVerificationState.PENDING);
            assertThat(submitted.qualifiesAt(NOW)).isFalse();
            assertThat(submitted.getValidUntil()).isNull();
        }

        @Test
        @DisplayName("approved counts for a calendar year from the decision")
        void anApprovalCountsForAYear() {
            StudentVerification approved = submitted();
            approved.approve(STAFF, NOW);

            assertThat(approved.getValidUntil()).isEqualTo(Instant.parse("2027-02-28T09:00:00Z"));
            assertThat(approved.getDecidedBy()).isEqualTo(STAFF);
            assertThat(approved.qualifiesAt(NOW.plusSeconds(1))).isTrue();
        }

        @Test
        @DisplayName("expires at its validUntil, half-open, whatever the stored state says")
        void expiryIsComputed() {
            StudentVerification approved = submitted();
            approved.approve(STAFF, NOW);
            Instant end = approved.getValidUntil();

            assertThat(approved.stateAt(end.minusNanos(1000))).isEqualTo(StudentVerificationState.APPROVED);
            assertThat(approved.stateAt(end)).isEqualTo(StudentVerificationState.EXPIRED);
            assertThat(approved.qualifiesAt(end)).isFalse();
            assertThat(approved.getState()).isEqualTo(StudentVerificationState.APPROVED);
        }

        @Test
        @DisplayName("is retired to EXPIRED only once its year has run out")
        void retiring() {
            StudentVerification approved = submitted();
            approved.approve(STAFF, NOW);

            assertThat(approved.retire(NOW.plusSeconds(60))).isFalse();
            assertThat(approved.retire(approved.getValidUntil())).isTrue();
            assertThat(approved.getState()).isEqualTo(StudentVerificationState.EXPIRED);
            assertThat(approved.stateAt(approved.getValidUntil())).isEqualTo(StudentVerificationState.EXPIRED);
        }

        @Test
        @DisplayName("refused carries the reason and may be followed by another submission")
        void aRefusal() {
            StudentVerification refused = submitted();
            refused.reject(STAFF, "  The card is unreadable  ", NOW);

            assertThat(refused.stateAt(NOW)).isEqualTo(StudentVerificationState.REJECTED);
            assertThat(refused.getRejectionReason()).isEqualTo("The card is unreadable");
            assertThat(refused.stateAt(NOW).blocksResubmission()).isFalse();
        }

        @Test
        @DisplayName("is decided once: a second decision is refused")
        void decidedOnce() {
            StudentVerification approved = submitted();
            approved.approve(STAFF, NOW);

            assertThatThrownBy(() -> approved.approve(STAFF, NOW)).isInstanceOf(IllegalStateException.class);
            assertThatThrownBy(() -> approved.reject(STAFF, "late", NOW)).isInstanceOf(IllegalStateException.class);
        }

        @Test
        @DisplayName("a revocation turns an approval that still counts into a refusal")
        void aRevocation() {
            StudentVerification approved = submitted();
            approved.approve(STAFF, NOW);

            approved.revoke(STAFF, "Shared with another account", NOW.plusSeconds(3600));

            assertThat(approved.stateAt(NOW.plusSeconds(3600))).isEqualTo(StudentVerificationState.REJECTED);
            assertThat(approved.getValidUntil()).isNull();
            assertThat(approved.qualifiesAt(NOW.plusSeconds(3600))).isFalse();
        }

        @Test
        @DisplayName("only an approval that still counts can be revoked")
        void revokingNeedsAnApproval() {
            StudentVerification pending = submitted();
            assertThatThrownBy(() -> pending.revoke(STAFF, "no", NOW)).isInstanceOf(IllegalStateException.class);

            StudentVerification expired = submitted();
            expired.approve(STAFF, NOW);
            assertThatThrownBy(() -> expired.revoke(STAFF, "no", expired.getValidUntil()))
                    .isInstanceOf(IllegalStateException.class);
        }

        @Test
        @DisplayName("a reason is required, and at most two thousand characters")
        void reasonsAreChecked() {
            assertThatThrownBy(() -> submitted().reject(STAFF, " ", NOW)).isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> submitted().reject(STAFF, "x".repeat(2001), NOW))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        @DisplayName("stores only a normalised card number")
        void storesNormalised() {
            assertThatThrownBy(() -> StudentVerification.submitted(UUID.randomUUID(), "BDU", "ab-123", NOW))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    @DisplayName("a selfie is a photograph; a student card may also be a PDF")
    void whatEachKindTakes() {
        assertThat(StudentDocumentKind.SELFIE.accepts("image/jpeg")).isTrue();
        assertThat(StudentDocumentKind.SELFIE.accepts("image/png")).isTrue();
        assertThat(StudentDocumentKind.SELFIE.accepts("application/pdf")).isFalse();
        assertThat(StudentDocumentKind.STUDENT_CARD.accepts("application/pdf")).isTrue();
    }

    private static StudentVerification submitted() {
        return StudentVerification.submitted(UUID.randomUUID(), "Bakı Dövlət Universiteti", "AB12345", NOW);
    }
}
