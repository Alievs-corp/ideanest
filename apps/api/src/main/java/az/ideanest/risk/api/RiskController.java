package az.ideanest.risk.api;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.risk.application.RiskAssessments;
import az.ideanest.risk.domain.RiskAssessment;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/**
 * §4.11's AD-02 fraud signals over HTTP — issue #108. The row that said "fraud signals are
 * not built".
 *
 * <h2>Finance only, audited, and never cached</h2>
 *
 * <p>{@code VIEW_FINANCE}, asked by {@link RiskAssessments} on every read and on the review
 * mark rather than here: this used to ask whether the caller was staff at all, which since
 * #295 every role is.
 *
 * <p>The same three rules {@code AuditTrailController} and {@code PaymentLogController}
 * follow, for a reason that is sharper here: this is a list of people the platform's
 * arithmetic has found suspicious. Reading it is a privileged act and §17.4 requires the
 * act to be recorded, and a shared cache holding it would be a copy of that list outside
 * the console.
 *
 * <p>The audit row names how many rows were read and never who was in them, following
 * {@code ConsoleReadService}: an audit trail that reproduced the queue would be a second
 * copy of it with no retention rule.
 *
 * <h2>Marking one reviewed is not a verdict</h2>
 *
 * <p>{@code POST .../reviewed} records that somebody looked. It records nothing about what
 * they concluded — see {@link RiskAssessment#reviewedBy}: the conclusion is a refund, a
 * suspension or a ticket, and each of those is recorded by the module that took it. A
 * second free-text verdict here would be a place for the two to disagree.
 */
@RestController
@RequestMapping("/v1/admin/risk")
public class RiskController {

    /** A page of the queue. Bounded because a queue nobody can read in a sitting is a backlog. */
    private static final int DEFAULT_LIMIT = 50;

    private static final int MAX_LIMIT = 200;

    private final RiskAssessments assessments;
    private final AuditLog audit;
    private final ObjectMapper json;

    public RiskController(RiskAssessments assessments, AuditLog audit, ObjectMapper json) {
        this.assessments = assessments;
        this.audit = audit;
        this.json = json;
    }

    /** What needs looking at, worst first. */
    @GetMapping("/queue")
    public ResponseEntity<RiskResponses.Queue> queue(
            @AuthenticationPrincipal Jwt accessToken, @RequestParam(required = false) Integer limit) {

        UUID staffId = callerOf(accessToken);
        List<RiskAssessment> page = assessments.queue(staffId, clamp(limit));
        record(staffId, "rows=%d".formatted(page.size()));

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(RiskResponses.Queue.of(page, json));
    }

    /**
     * Everything ever noticed about one pledge.
     *
     * <p>A list, because a re-assessment writes a new row rather than overwriting the old
     * one — which is the whole reason this is a table and not a column.
     */
    @GetMapping("/pledges/{pledgeId}")
    public ResponseEntity<RiskResponses.Queue> historyOf(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID pledgeId) {

        UUID staffId = callerOf(accessToken);
        List<RiskAssessment> history = assessments.historyOf(staffId, pledgeId);
        record(staffId, "pledge=set; rows=%d".formatted(history.size()));

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(RiskResponses.Queue.of(history, json));
    }

    /**
     * Records that somebody looked.
     *
     * <p>204 whether the row was still unreviewed or a colleague had just taken it. A
     * member of staff pressing the button on a row somebody else has claimed should be told
     * it is done, not that it is missing — and the query puts the unreviewed condition in
     * the {@code WHERE} clause so the two of them race to one winner.
     */
    @PostMapping("/{assessmentId}/reviewed")
    public ResponseEntity<Void> markReviewed(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID assessmentId) {

        UUID staffId = callerOf(accessToken);
        boolean taken = assessments.markReviewed(assessmentId, staffId).isPresent();
        record(staffId, "assessment=%s; claimed=%s".formatted(assessmentId, taken));

        return ResponseEntity.noContent().build();
    }

    private void record(UUID staffId, String detail) {
        // The staff account is the entity, following ACCOUNTS_SEARCHED: a read of a list
        // has no single subject, which is exactly what makes it worth recording.
        audit.recordIndependently(
                AuditAction.RISK_QUEUE_READ, staffId, AuditActor.moderator(staffId), AuditOutcome.SUCCEEDED, detail);
    }

    private static int clamp(Integer limit) {
        if (limit == null || limit < 1) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    /** Whoever is signed in. Never the body — see {@code AuditTrailController}. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
