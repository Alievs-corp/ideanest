package az.ideanest.analytics.api;

import az.ideanest.analytics.AudienceAnalyticsProperties;
import az.ideanest.analytics.application.AudienceEvent;
import az.ideanest.analytics.application.AudienceEventService;
import az.ideanest.shared.ratelimit.ClientAddress;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.shared.ratelimit.RateLimits;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /v1/audience/events}: the beacon — #633.
 *
 * <p><strong>No credential, and none read.</strong> A visitor is counted whether or not
 * they are signed in, and an account must not change who they are counted as: the
 * figures are about people reading the site, and the key is
 * {@code VisitorKey}'s day-salted hash of the address and agent for everybody alike.
 * {@code SecurityConfiguration} permits the path and does not even resolve a bearer token
 * on it, so an expired token sent by a beacon is not a 401.
 *
 * <p><strong>Always 204 for an event of the right shape.</strong> Counted, deduplicated,
 * from a bot, about a draft or about a campaign that does not exist — the answer is the
 * same, so the endpoint cannot be used to learn which identifiers exist or which agents
 * are filtered. A malformed body is a 400 and an exhausted budget a 429: both are about
 * the request rather than about the platform's data.
 *
 * <p><strong>Rate limited per source address</strong>, with {@code ClientAddress}, which
 * is the address the container trusts — never the Cloudflare header, which a direct
 * caller can write.
 */
@RestController
public class AudienceEventController {

    /** What Cloudflare puts the reader's own address in when the request came through it. */
    static final String CONNECTING_ADDRESS = "CF-Connecting-IP";

    /** What Cloudflare puts the reader's country in when the request came through it. */
    static final String COUNTRY = "CF-IPCountry";

    /** IP literals only: anything else in the header is ignored rather than hashed. */
    private static final Pattern IP_LITERAL = Pattern.compile("^[0-9A-Fa-f:.]{2,45}$");

    private final AudienceEventService events;
    private final RateLimiter rateLimiter;
    private final AudienceAnalyticsProperties properties;

    public AudienceEventController(
            AudienceEventService events, RateLimiter rateLimiter, AudienceAnalyticsProperties properties) {
        this.events = events;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    @PostMapping("/v1/audience/events")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void record(@Valid @RequestBody AudienceEventRequest request, HttpServletRequest http) {
        String address = ClientAddress.of(http);
        RateLimits.enforce(rateLimiter.recordAttempt(
                "audience-event:ip:" + address, properties.eventsPerAddress(), properties.window()));

        events.record(new AudienceEvent(
                request.kind(),
                request.platform(),
                request.projectId(),
                request.surface(),
                readerAddress(http, address),
                http.getHeader(HttpHeaders.USER_AGENT),
                http.getHeader(COUNTRY)));
    }

    /**
     * Who the reader is, for the visitor key and the country: Cloudflare's
     * {@code CF-Connecting-IP} when the request came through Cloudflare, else the address
     * the container resolved.
     *
     * <p>A browser's beacon reaches the API through Cloudflare and the web container's
     * rewrite, and the container's address for it is a Cloudflare edge shared by
     * everybody behind it (ops/deploy/README.md); Cloudflare's header is the reader. A
     * caller that forges the header can only change which visitor it is counted as, which
     * it could do as easily by changing its agent — it skews a statistic and grants
     * nothing, so it is documented rather than defended. Rate limiting does not use it.
     */
    static String readerAddress(HttpServletRequest http, String containerAddress) {
        String connecting = http.getHeader(CONNECTING_ADDRESS);
        if (connecting != null) {
            String trimmed = connecting.trim();
            if (IP_LITERAL.matcher(trimmed).matches() && (trimmed.contains(".") || trimmed.contains(":"))) {
                return trimmed;
            }
        }
        return containerAddress;
    }
}
