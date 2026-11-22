package az.ideanest.verification.api;

import az.ideanest.verification.application.IdentityVerifications;
import az.ideanest.verification.application.StudentVerificationReview;
import az.ideanest.verification.application.StudentVerifications;
import az.ideanest.verification.domain.StudentDocumentKind;
import az.ideanest.verification.domain.StudentVerificationState;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The student verification queue — #655, beside AD-02's identity queue and under the same
 * capabilities: {@code REVIEW_IDENTITY_VERIFICATION} to read and decide,
 * {@code OPEN_IDENTITY_DOCUMENT} to open a photograph. Checked in {@code StudentVerifications},
 * where the decision is also recorded.
 *
 * <p>The photograph endpoint follows {@code VerificationAdminController}'s: audited before the
 * bytes leave, {@code attachment} and never {@code inline}, a fixed file name, {@code no-store}.
 */
@RestController
@RequestMapping("/v1/admin/student-verifications")
public class StudentVerificationAdminController {

    private static final int DEFAULT_LIMIT = 50;

    private static final int MAX_LIMIT = 200;

    private final StudentVerifications verifications;

    public StudentVerificationAdminController(StudentVerifications verifications) {
        this.verifications = verifications;
    }

    /**
     * One list. {@code PENDING} — the default — is the queue, oldest first; {@code APPROVED},
     * {@code REJECTED} and {@code EXPIRED} are the archive, newest decision first.
     */
    @GetMapping
    public ResponseEntity<StudentVerificationResponses.StudentVerificationList> list(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(defaultValue = "PENDING") StudentVerificationState state,
            @RequestParam(required = false) Integer limit) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new StudentVerificationResponses.StudentVerificationList(
                        verifications.list(callerOf(accessToken), state, clamp(limit)).stream()
                                .map(StudentVerificationResponses.StudentVerificationRow::of)
                                .toList()));
    }

    /** One photograph's bytes, audited. 404 once a decision has erased it. */
    @GetMapping("/{verificationId}/documents/{kind}")
    public ResponseEntity<byte[]> document(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID verificationId,
            @PathVariable StudentDocumentKind kind) {

        IdentityVerifications.OpenedDocument opened =
                verifications.openDocument(callerOf(accessToken), verificationId, kind);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType(opened.contentType()))
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment()
                                .filename("student-" + kind.name().toLowerCase(java.util.Locale.ROOT) + "-" + verificationId)
                                .build()
                                .toString())
                .body(opened.content());
    }

    /** Approves a pending submission for a year, and erases its photographs. */
    @PostMapping("/{verificationId}/approve")
    public ResponseEntity<StudentVerificationResponses.StudentVerificationRow> approve(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID verificationId) {
        return row(verifications.approve(callerOf(accessToken), verificationId));
    }

    /** Refuses a pending submission with a reason the creator is shown, and erases its photographs. */
    @PostMapping("/{verificationId}/reject")
    public ResponseEntity<StudentVerificationResponses.StudentVerificationRow> reject(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID verificationId,
            @Valid @RequestBody StudentVerificationResponses.StudentVerificationDecision decision) {
        return row(verifications.reject(callerOf(accessToken), verificationId, decision.reason()));
    }

    /** Withdraws an approval that still counts — abuse found later. */
    @PostMapping("/{verificationId}/revoke")
    public ResponseEntity<StudentVerificationResponses.StudentVerificationRow> revoke(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID verificationId,
            @Valid @RequestBody StudentVerificationResponses.StudentVerificationDecision decision) {
        return row(verifications.revoke(callerOf(accessToken), verificationId, decision.reason()));
    }

    private static ResponseEntity<StudentVerificationResponses.StudentVerificationRow> row(StudentVerificationReview review) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(StudentVerificationResponses.StudentVerificationRow.of(review));
    }

    private static int clamp(Integer limit) {
        if (limit == null || limit < 1) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
