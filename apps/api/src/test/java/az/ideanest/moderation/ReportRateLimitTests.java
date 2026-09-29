package az.ideanest.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.moderation.api.ContentReportController;
import az.ideanest.moderation.api.ReportRequest;
import az.ideanest.moderation.application.ReportingService;
import az.ideanest.moderation.application.SubmittedReport;
import az.ideanest.moderation.domain.ReportReason;
import az.ideanest.moderation.domain.ReportState;
import az.ideanest.moderation.domain.ReportTargetType;
import az.ideanest.shared.ratelimit.InMemoryRateLimiter;
import az.ideanest.shared.ratelimit.RateLimitExceededException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.context.request.ServletWebRequest;

/**
 * §17.3's shape applied to reporting, at the boundary.
 *
 * <p><strong>Not an integration test, and deliberately not one</strong>, for
 * {@code SearchRateLimitTests}' reason: the suite shares a single Spring context and
 * therefore a single limiter, and every request in it comes from {@code 127.0.0.1} —
 * so a per-address budget small enough to exhaust in a test is a budget the rest of
 * this module's suite would exhaust for it. Driving the controller directly keeps the
 * assertion exact: twenty reports are accepted, the twenty-first is not, and it is
 * not the nineteenth.
 *
 * <p>The point of the test is not the numbers. It is that <strong>the two budgets are
 * separate and both are spent</strong>: a per-account limit alone does not bound
 * somebody with fifty accounts, and a per-address limit alone would refuse the whole
 * of a shared office because one person there is reporting things.
 */
class ReportRateLimitTests {

    private static final Clock FIXED = Clock.fixed(Instant.parse("2026-08-18T12:00:00Z"), ZoneOffset.UTC);

    /** §17.3's window for this endpoint, as {@code ModerationProperties} defaults it. */
    private static final int PER_REPORTER = ModerationProperties.defaults().reports().perReporter();

    private static final int PER_CLIENT = ModerationProperties.defaults().reports().perClient();

    private ContentReportController reports;
    private MockHttpServletRequest request;

    @BeforeEach
    void buildTheEndpoint() {
        reports = new ContentReportController(
                new AcceptingReportingService(), new InMemoryRateLimiter(FIXED), ModerationProperties.defaults());
        bindARequest("198.51.100.7");
    }

    @AfterEach
    void unbindTheRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    @DisplayName("the twentieth report from one account is accepted and the twenty-first is refused")
    void refusesPastTheReporterBudget() {
        UUID reporter = UUID.randomUUID();

        for (int attempt = 0; attempt < PER_REPORTER; attempt++) {
            assertThatCode(() -> report(reporter)).doesNotThrowAnyException();
        }

        assertThatThrownBy(() -> report(reporter)).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("one account's exhausted budget does not refuse another account")
    void theReporterBudgetIsPerAccount() {
        UUID first = UUID.randomUUID();
        for (int attempt = 0; attempt < PER_REPORTER; attempt++) {
            report(first);
        }

        // Otherwise one person reporting a lot would silence everybody else, which
        // is a denial of service against the safety feature rather than protection
        // for it.
        assertThatCode(() -> report(UUID.randomUUID())).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a source address is bounded across accounts, which is what the per-account limit cannot do")
    void theAddressBudgetSpansAccounts() {
        // A fresh account per report, so the per-account limit never fires and the
        // only thing that can refuse this is the address budget.
        for (int attempt = 0; attempt < PER_CLIENT; attempt++) {
            report(UUID.randomUUID());
        }

        assertThatThrownBy(() -> report(UUID.randomUUID())).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("the reporter's budget is spent before the address's")
    void theTighterBudgetIsCheckedFirst() {
        UUID reporter = UUID.randomUUID();
        for (int attempt = 0; attempt < PER_REPORTER; attempt++) {
            report(reporter);
        }
        assertThatThrownBy(() -> report(reporter)).isInstanceOf(RateLimitExceededException.class);

        // A client over its own budget must not also spend a unit of the address
        // budget, which belongs to whoever else is behind the same NAT. Twenty
        // reports have been made from this address and the twenty-first was refused
        // before it was counted, so exactly the address budget less twenty is left
        // for everybody else -- and a fresh account per attempt keeps the
        // per-account limit out of the way, so the address budget is the only thing
        // that could refuse one of them.
        for (int attempt = 0; attempt < PER_CLIENT - PER_REPORTER; attempt++) {
            assertThatCode(() -> report(UUID.randomUUID())).doesNotThrowAnyException();
        }
        assertThatThrownBy(() -> report(UUID.randomUUID())).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("reporting an account by its slug spends the same budget as reporting a campaign")
    void theAccountRouteSharesTheBudget() {
        UUID reporter = UUID.randomUUID();
        for (int attempt = 0; attempt < PER_REPORTER; attempt++) {
            report(reporter);
        }

        // #143 moved the account route onto the slug and gave it its own service
        // method. It must still be counted against the one allowance, or somebody who
        // had spent theirs on campaigns could carry on spending it on people.
        assertThatThrownBy(() -> reports.reportUser(
                        accessTokenFor(reporter), "some-person", new ReportRequest(ReportReason.SPAM, null), request))
                .isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("the response says how much of the allowance is left before it runs out")
    void theAllowanceIsReported() {
        MockHttpServletResponse response = currentResponse();

        report(UUID.randomUUID());

        // A client that can see its allowance shrinking can slow down; one that
        // cannot only finds out by being refused. §10.3's convention, and RateLimits
        // reports the tightest of the two budgets.
        assertThat(response.getHeader("X-RateLimit-Remaining")).isNotNull();
        assertThat(response.getHeader("X-RateLimit-Limit")).isNotNull();
    }

    private void report(UUID reporterId) {
        reports.reportProject(
                accessTokenFor(reporterId),
                UUID.randomUUID(),
                new ReportRequest(ReportReason.FRAUD, null),
                request);
    }

    private static Jwt accessTokenFor(UUID accountId) {
        return Jwt.withTokenValue("access-token")
                .header("alg", "none")
                .subject(accountId.toString())
                .claim("sub", accountId.toString())
                .build();
    }

    /**
     * A bound request and response, which is what {@code RateLimits} writes the
     * allowance onto. Without it the headers have nowhere to go and the limiter's
     * refusal would be the only thing this test could observe.
     */
    private void bindARequest(String address) {
        request = new MockHttpServletRequest();
        request.setRemoteAddr(address);
        RequestContextHolder.setRequestAttributes(
                new ServletWebRequest(request, new MockHttpServletResponse()));
    }

    private static MockHttpServletResponse currentResponse() {
        ServletRequestAttributes attributes =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return (MockHttpServletResponse) attributes.getResponse();
    }

    /**
     * A reporting service that always succeeds.
     *
     * <p>The limiter is what is being tested, so the work behind it is replaced
     * rather than mocked: a stub with one overridden method is a stub whose behaviour
     * a reader can see, and it cannot drift from the real signature without failing
     * to compile.
     *
     * <p><strong>Both collaborators are null, and none is reachable.</strong>
     * {@link ReportingService#report} and {@link ReportingService#reportAccount} are the
     * only methods that touch either, and both are overridden here, so the stub never reads a repository or a
     * {@code ReportTargets}. Naming them is what would be dishonest: a
     * {@code ReportTargets} assembled here out of nulls looks like a collaborator
     * under test and is not one, and it re-breaks this test every time
     * {@code ReportTargets} takes on another module's read — which is exactly what
     * #84 adding {@code PublicComments} to it did. What this test asserts about the
     * limiter is unchanged either way.
     */
    private static final class AcceptingReportingService extends ReportingService {

        private AcceptingReportingService() {
            super(null, null);
        }

        @Override
        public SubmittedReport report(
                ReportTargetType targetType, UUID targetId, UUID reporterId, ReportReason reason, String detail) {

            return new SubmittedReport(
                    UUID.randomUUID(),
                    targetType,
                    targetId,
                    reason,
                    ReportState.OPEN,
                    Instant.now(FIXED),
                    true);
        }

        /** The slug route's entry point (#143), overridden for the same reason. */
        @Override
        public SubmittedReport reportAccount(String slug, UUID reporterId, ReportReason reason, String detail) {
            return report(ReportTargetType.USER, UUID.randomUUID(), reporterId, reason, detail);
        }
    }
}
