package az.ideanest.moderation.api;

import az.ideanest.moderation.ModerationProperties;
import az.ideanest.moderation.application.ReportingService;
import az.ideanest.moderation.application.SubmittedReport;
import az.ideanest.moderation.domain.ReportTargetType;
import az.ideanest.shared.ratelimit.ClientAddress;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.shared.ratelimit.RateLimits;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * How somebody tells the platform that something is wrong. §4.9's C-06 and C-07, and
 * §10.2's {@code POST /v1/projects/{id}/report}.
 *
 * <p><strong>Three endpoints on one controller, because they are one feature and one
 * budget.</strong> Splitting them would mean three rate limiters to keep in step, and
 * somebody who had spent their reporting allowance on campaigns could then spend a
 * second one on people and a third on comments.
 *
 * <p><strong>No endpoint here appears in {@code SecurityConfiguration}, and that is
 * the intended arrangement.</strong> All three fall through to the catch-all rule, so
 * all three require a bearer token from an account that is not inside §17.4's deletion
 * grace period. Reporting is one of the few writes where requiring an account is not
 * friction but the mechanism: the duplicate suppression this feature is built on is
 * unstateable without an identity to compare, and V23's header has the other two
 * reasons.
 *
 * <p><strong>{@code POST /v1/updates/{id}/report} is published as of #297</strong>, which
 * was the last of AD-09's three surfaces without one. See {@link #reportUpdate}.
 *
 * <p><strong>{@code POST /v1/comments/{id}/report} is published as of #84.</strong> It
 * was absent because there was no {@code comments} table for an identifier to be
 * checked against, and accepting a report a moderator could never look at shows the
 * reporter a success for nothing. {@link ReportTargetType#COMMENT} was already in the
 * taxonomy and in V23's check constraint, so this cost a controller method and no
 * migration — which is the whole of the bet #102 made when it enumerated the value
 * early. Deduplication is unchanged and is still V23's partial unique index: a
 * comment is a target like any other, so a second report on one comment by one
 * reporter is the same 202 carrying the report already on file.
 *
 * <p><strong>Rate limiting is here rather than in the service</strong>, following
 * {@code PrelaunchController} and {@code AuthController}: it is about the transport —
 * a source address, a 429, a {@code Retry-After} — and the service should not have to
 * know it is being reached over HTTP.
 */
@RestController
@RequestMapping("/v1")
public class ContentReportController {

    private final ReportingService reporting;
    private final RateLimiter rateLimiter;
    private final ModerationProperties properties;

    public ContentReportController(
            ReportingService reporting, RateLimiter rateLimiter, ModerationProperties properties) {
        this.reporting = reporting;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    /** "There is something wrong with this campaign." §4.9's C-06. */
    @PostMapping("/projects/{id}/report")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ReportResponse reportProject(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody ReportRequest request,
            HttpServletRequest httpRequest) {

        return report(ReportTargetType.PROJECT, id, accessToken, request, httpRequest);
    }

    /**
     * "There is something wrong with this person." AD-09's "profiles", and what a
     * ban is decided from.
     *
     * <p>Not in §10.2's endpoint list, and required by this issue's definition of
     * done — "report projects, comments, and users". Without it the only way to
     * report an account is to report one of its campaigns, which is the wrong object
     * for a complaint about impersonation or harassment and produces a queue where
     * every report about a person is filed against something they made.
     *
     * <p><strong>Addressed by slug as of #143, not by identifier.</strong> The route was
     * {@code /users/{id}/report} and no screen could call it: the public profile
     * response carries the slug and deliberately no identifier, and the follow route
     * beside it — {@code /users/{slug}/follow} — is already keyed on the slug. The two
     * cannot coexist on one path pattern, and adding the identifier to the profile would
     * publish a stable key for every account to anybody who can read a profile, so the
     * route changed rather than the response. Nothing called the identifier form. The
     * report itself still names the account by identifier, so the queue, deduplication
     * and the self-report refusal are unchanged and a report survives a slug change.
     */
    @PostMapping("/users/{slug}/report")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ReportResponse reportUser(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable String slug,
            @Valid @RequestBody ReportRequest request,
            HttpServletRequest httpRequest) {

        UUID reporterId = spendBudget(accessToken, httpRequest);
        return ReportResponse.of(reporting.reportAccount(slug, reporterId, request.reason(), request.detail()));
    }

    /**
     * "There is something wrong with this comment." §4.9's C-07, and §10.2's
     * {@code POST /v1/comments/{id}/report}.
     *
     * <p>The comment is checked through the community module's {@code PublicComments}
     * before anything is written, which also refuses a comment that has already been
     * removed — see {@code ReportTargets}. Nothing about the comment changes: a report
     * is a request for a person to look, and a comment that disappeared on a report
     * count would be a comment any five accounts could delete.
     */
    @PostMapping("/comments/{id}/report")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ReportResponse reportComment(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody ReportRequest request,
            HttpServletRequest httpRequest) {

        return report(ReportTargetType.COMMENT, id, accessToken, request, httpRequest);
    }

    /**
     * "There is something wrong with this update." §4.11's AD-09, and §10.2's
     * {@code POST /v1/updates/{id}/report} — issue #297.
     *
     * <p><strong>The last of §4.11's four report targets to get a route.</strong> AD-09
     * asks for moderation of "comments, updates, profiles" and the queue could only be
     * filled from two of the three, so half of it had no intake and the console screen
     * said so. What unblocked it was not this endpoint but #83, which built
     * {@code project_updates}: once the rows existed, the route was a method here and a
     * branch in {@code ReportTargets}, exactly as #102 predicted when it enumerated the
     * value it could not yet write.
     *
     * <p>The update is checked through the community module's
     * {@code PublicProjectUpdates}, which refuses one that is scheduled rather than
     * published — an accepted report about an unpublished update would tell the reporter
     * that it exists. Nothing about the update changes: a report is a request for a person
     * to look, and §10.2 gives an update no withdrawal in any case.
     */
    @PostMapping("/updates/{id}/report")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ReportResponse reportUpdate(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody ReportRequest request,
            HttpServletRequest httpRequest) {

        return report(ReportTargetType.PROJECT_UPDATE, id, accessToken, request, httpRequest);
    }

    /**
     * The implementation for every target addressed by identifier.
     *
     * <p>202 rather than 201. The platform has the complaint and has created nothing
     * the client can go and read — the report is not addressable by the person who
     * made it, on purpose — and "accepted, a person will look at this" is what
     * actually happened.
     */
    private ReportResponse report(
            ReportTargetType targetType,
            UUID targetId,
            Jwt accessToken,
            ReportRequest request,
            HttpServletRequest httpRequest) {

        UUID reporterId = spendBudget(accessToken, httpRequest);
        SubmittedReport report =
                reporting.report(targetType, targetId, reporterId, request.reason(), request.detail());
        return ReportResponse.of(report);
    }

    /**
     * The one place the two budgets are spent, for all four routes; answers the reporter.
     *
     * <p>Both limits are counted before anything is written, and the reporter's own
     * budget is counted first: it is the tighter of the two and the one an attacker
     * actually has to spend, so a client that is over it should not also have a unit
     * of the address budget taken from whoever shares its NAT.
     */
    private UUID spendBudget(Jwt accessToken, HttpServletRequest httpRequest) {
        ModerationProperties.Reports limits = properties.reports();
        UUID reporterId = UUID.fromString(accessToken.getSubject());

        RateLimits.enforce(
                rateLimiter.recordAttempt("report:account:" + reporterId, limits.perReporter(), limits.window()));
        RateLimits.enforce(rateLimiter.recordAttempt(
                "report:ip:" + ClientAddress.of(httpRequest), limits.perClient(), limits.window()));
        return reporterId;
    }
}
