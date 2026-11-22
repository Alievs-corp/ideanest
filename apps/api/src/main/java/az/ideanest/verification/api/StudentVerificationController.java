package az.ideanest.verification.api;

import az.ideanest.verification.application.DocumentRefusedException;
import az.ideanest.verification.application.StudentDocumentRefusedException;
import az.ideanest.verification.application.StudentVerifications;
import java.io.IOException;
import java.time.Clock;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * A creator's own student verification — #655.
 *
 * <p>{@code VerificationController}'s rules: the access token's subject is the whole of the
 * authorisation, there is no identifier to enumerate, the files' types come from their bytes, and
 * both answers are {@code no-store}.
 */
@RestController
@RequestMapping("/v1/me/student-verification")
public class StudentVerificationController {

    private final StudentVerifications verifications;
    private final Clock clock;

    public StudentVerificationController(StudentVerifications verifications, Clock clock) {
        this.verifications = verifications;
        this.clock = clock;
    }

    /** Where this account stands: {@code NONE} when it never submitted. */
    @GetMapping
    public ResponseEntity<StudentVerificationResponses.StudentVerificationStatus> mine(
            @AuthenticationPrincipal Jwt accessToken) {
        return answer(callerOf(accessToken));
    }

    /**
     * A new submission. Answers the standing it produced, which is {@code PENDING}.
     *
     * <p>Every part is optional at the binding, so that a missing one is refused with this
     * endpoint's codes and its {@code field} rather than with the framework's. The two text
     * fields are parts of the form, not query parameters: a student card number does not belong
     * in a URL, where every proxy and access log would keep it.
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<StudentVerificationResponses.StudentVerificationStatus> submit(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestPart(name = "institution", required = false) String institution,
            @RequestPart(name = "cardNumber", required = false) String cardNumber,
            @RequestPart(name = "studentCard", required = false) MultipartFile studentCard,
            @RequestPart(name = "selfie", required = false) MultipartFile selfie) {

        UUID accountId = callerOf(accessToken);
        verifications.submit(
                accountId, institution, cardNumber, bytesOf("studentCard", studentCard), bytesOf("selfie", selfie));
        return answer(accountId);
    }

    private ResponseEntity<StudentVerificationResponses.StudentVerificationStatus> answer(UUID accountId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(StudentVerificationResponses.StudentVerificationStatus.of(
                        verifications.current(accountId), clock.instant()));
    }

    /**
     * The part's bytes. Absent and empty are the same refusal, and so is a part that did not
     * arrive completely — the creator's connection, not a server fault.
     */
    private static byte[] bytesOf(String field, MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new StudentDocumentRefusedException(field, DocumentRefusedException.Reason.EMPTY, "That file is empty.");
        }
        try {
            return file.getBytes();
        } catch (IOException interrupted) {
            throw new StudentDocumentRefusedException(
                    field, DocumentRefusedException.Reason.EMPTY, "That file did not arrive completely.");
        }
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
