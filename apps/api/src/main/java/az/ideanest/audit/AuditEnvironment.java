package az.ideanest.audit;

import az.ideanest.shared.observability.Correlation;
import jakarta.servlet.http.HttpServletRequest;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Where a privileged action was performed from, taken rather than asked for.
 *
 * <p><strong>Nothing here is a parameter of {@link AuditLog#record}, and that is
 * the point.</strong> The address, the user agent and §18.1's correlation
 * identifiers are the same four values at every call site, so passing them would be
 * four arguments per call that nobody reads and that one call site eventually gets
 * wrong or leaves out — and a row missing its correlation identifier is a row that
 * cannot be joined to the log lines of the request that produced it, discovered
 * during the incident rather than before it. They are also not the caller's to
 * choose: an actor who could name their own source address would be writing the
 * alibi as well as the record.
 *
 * <p>Everything is null when there is no request: a scheduled sweep has no client,
 * and a row that invented one would be worse than a row that says so.
 *
 * @param sourceAddress the client's address as the container resolved it, behind
 *     the proxy included; see {@code addressOf}
 * @param userAgent what the client called itself, unredacted here and redacted by
 *     {@link AuditLog} on the way to the column
 * @param requestId §18.1's {@code requestId}, as
 *     {@code CorrelationFilter} established it
 * @param traceId §18.1's {@code traceId}, which is the caller's when the caller
 *     sent a well-formed {@code traceparent}
 */
public record AuditEnvironment(String sourceAddress, String userAgent, String requestId, String traceId) {

    /** Nothing known. What a job, a sweep, or a test calling directly gets. */
    public static final AuditEnvironment NONE = new AuditEnvironment(null, null, null, null);

    /**
     * Characters an IP literal is made of, and nothing else.
     *
     * <p>Not a validator — {@code inet} is, and V21 chose that column so the
     * database would be the authority. What this rejects is the two shapes a
     * servlet container really produces that PostgreSQL will not take: a
     * link-local IPv6 address carrying its interface zone ({@code fe80::1%eth0}),
     * and a hostname where an address was expected. Anything else that slips
     * through is refused by the column, loudly, which on this table is the
     * correct direction — see {@link AuditLog} on why an audit write is allowed
     * to fail the action it was recording.
     */
    private static final Pattern ADDRESS_LITERAL = Pattern.compile("[0-9A-Fa-f.:]{2,45}");

    /** The current request's, or {@link #NONE} if this is not running in one. */
    public static AuditEnvironment current() {
        HttpServletRequest request = currentRequest();
        if (request == null) {
            // Still worth reading the MDC: CorrelationTaskDecorator mints
            // identifiers for work that began on a timer, so a job's row can be
            // joined to a job's log lines even though there is no client.
            return new AuditEnvironment(null, null, correlated(Correlation.REQUEST_ID), correlated(Correlation.TRACE_ID));
        }
        return new AuditEnvironment(
                addressOf(request),
                request.getHeader(HttpHeaders.USER_AGENT),
                correlated(Correlation.REQUEST_ID),
                correlated(Correlation.TRACE_ID));
    }

    private static HttpServletRequest currentRequest() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        return attributes instanceof ServletRequestAttributes servlet ? servlet.getRequest() : null;
    }

    /**
     * The remote address as the container resolved it.
     *
     * <p>Deliberately not {@code X-Forwarded-For} read here, for
     * {@code ClientAddress}'s reason and more so: that header is whatever the client
     * typed, and an audit row naming an address of the actor's own choosing is worse
     * than one naming none at all. {@code server.forward-headers-strategy: native} in
     * {@code application.yml} (#578) makes {@code getRemoteAddr} itself correct behind
     * the proxy, rather than teaching this class to trust a header: Tomcat takes the
     * header only from a private-network peer, and only its right-most hop that is not
     * one, so the value is the proxy's account of the client and never the client's
     * account of itself.
     */
    private static String addressOf(HttpServletRequest request) {
        String address = request.getRemoteAddr();
        if (address == null) {
            return null;
        }
        String withoutZone = address.trim();
        int zone = withoutZone.indexOf('%');
        if (zone >= 0) {
            withoutZone = withoutZone.substring(0, zone);
        }
        return ADDRESS_LITERAL.matcher(withoutZone).matches() ? withoutZone : null;
    }

    /**
     * An MDC value, if it is one this service was willing to write to a log.
     *
     * <p>The same rule, because the whole value of the column is that the row and
     * the lines carry the same string: a value the log rejected and this accepted
     * would join to nothing.
     */
    private static String correlated(String key) {
        return Correlation.acceptableIdentifier(MDC.get(key));
    }
}
