package az.ideanest.platform.api;

import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.maintenance.ActiveMaintenance;
import az.ideanest.shared.maintenance.MaintenanceGate;
import az.ideanest.shared.maintenance.MaintenanceProblem;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.server.PathContainer;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;
import tools.jackson.databind.ObjectMapper;

/**
 * The maintenance gate — issue #214.
 *
 * <p>While a window is in force, every request is answered here with the maintenance
 * contract ({@link MaintenanceProblem}: 503, {@code Retry-After}, {@code no-store}), except
 * the ones listed below.
 *
 * <h2>Where it sits</h2>
 *
 * <p>Inside Spring Security's chain, <strong>after the bearer token has been read and
 * before authorization</strong> ({@code SecurityConfiguration} places it before
 * {@code AuthorizationFilter}) — so before every controller. Being after authentication
 * is what lets it tell a staff token from a reader's without parsing the token a second
 * time; being before authorization is what makes an anonymous request to a protected
 * endpoint get the maintenance answer rather than a 401, which a client would treat as
 * "sign in again". It is deliberately not registered as a servlet filter of its own
 * ({@link MaintenanceFilterRegistration}): running ahead of the security chain it would
 * see every staff request as anonymous.
 *
 * <h2>What passes</h2>
 *
 * <ul>
 *   <li>{@code GET /v1/status} — what clients poll to find out when it is over;
 *   <li>{@code /actuator/**} — the platform's own health checks and metrics;
 *   <li>{@code /v1/auth/login}, {@code /v1/auth/refresh}, {@code /v1/auth/2fa/verify},
 *       {@code /v1/auth/logout} — so staff can sign in. A reader's sign-in is refused one
 *       layer down, after the credentials say whose it is, by
 *       {@code MaintenanceGate.admitSession}: no session and no refresh token is issued;
 *   <li>{@code POST /v1/webhooks/psp/{provider}} — payment provider webhooks, because a
 *       provider may stop retrying and the ledger must not miss a settlement;
 *   <li>any request carrying a staff access token, of any role — so staff can look at the
 *       platform while it is closed to everybody else.
 * </ul>
 *
 * <p>Nothing else, and the list is written out rather than derived: a new endpoint is
 * closed during maintenance until somebody decides otherwise.
 */
@Component
public class MaintenanceFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(MaintenanceFilter.class);

    static final String STATUS = "/v1/status";

    static final String ACTUATOR = "/actuator";

    static final Set<String> AUTH_PATHS =
            Set.of("/v1/auth/login", "/v1/auth/refresh", "/v1/auth/2fa/verify", "/v1/auth/logout");

    static final PathPattern PAYMENT_WEBHOOK = PathPatternParser.defaultInstance.parse("/v1/webhooks/psp/{provider}");

    private final MaintenanceGate maintenance;
    private final PlatformStaff staff;
    private final ObjectMapper json;
    private final Clock clock;

    public MaintenanceFilter(MaintenanceGate maintenance, PlatformStaff staff, ObjectMapper json, Clock clock) {
        this.maintenance = maintenance;
        this.staff = staff;
        this.json = json;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        // The snapshot first: outside a window — which is nearly always — this is one
        // atomic read and a clock comparison, and nothing else below runs.
        Optional<ActiveMaintenance> window = maintenance.active();
        if (window.isEmpty() || isExempt(request) || carriesStaffToken()) {
            chain.doFilter(request, response);
            return;
        }

        ActiveMaintenance active = window.get();
        response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
        response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(active.retryAfterSeconds(clock.instant())));
        response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue());
        response.setContentType(MaintenanceProblem.MEDIA_TYPE.toString());
        response.setCharacterEncoding("UTF-8");
        json.writeValue(response.getOutputStream(), MaintenanceProblem.of(active));
    }

    static boolean isExempt(HttpServletRequest request) {
        String path = pathOf(request);
        String method = request.getMethod();

        if (STATUS.equals(path)) {
            return HttpMethod.GET.matches(method) || HttpMethod.HEAD.matches(method);
        }
        if (ACTUATOR.equals(path) || path.startsWith(ACTUATOR + "/")) {
            return true;
        }
        if (AUTH_PATHS.contains(path)) {
            return true;
        }
        return HttpMethod.POST.matches(method) && PAYMENT_WEBHOOK.matches(PathContainer.parsePath(path));
    }

    /**
     * The request's path within the application, as the security matchers see it.
     *
     * <p>Spring Security's firewall has already refused anything with {@code ..}, an
     * encoded slash or a semicolon by the time this runs, so the path cannot be dressed
     * up as an exempt one.
     */
    private static String pathOf(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String context = request.getContextPath();
        return context != null && !context.isEmpty() && uri.startsWith(context) ? uri.substring(context.length()) : uri;
    }

    /**
     * Whether the bearer token already verified by the chain belongs to platform staff.
     *
     * <p>Asked of {@code PlatformStaff}, which reads the grants on every call rather than
     * trusting a claim: the access token carries no role, and a role withdrawn must stop
     * working on the next request. That is one query, and only for a request that carries
     * a token during a window. If it cannot be answered the request is treated as a
     * reader's — the platform is closed, and "could not tell" is not "staff".
     */
    private boolean carriesStaffToken() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken token)) {
            return false;
        }
        try {
            return staff.isStaff(UUID.fromString(token.getToken().getSubject()));
        } catch (RuntimeException e) {
            log.warn("Could not tell whether a token's holder is staff during maintenance; refusing.", e);
            return false;
        }
    }
}
