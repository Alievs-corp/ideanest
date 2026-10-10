package az.ideanest.shared.payment;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Which return addresses may be handed to a payment provider — issue #139.
 *
 * <p>{@code POST /v1/pledges/{id}/payment} and {@code POST /v1/me/payout-destination/card-registration}
 * take a {@code successUrl} and an {@code errorUrl} from the caller and forward them to the provider,
 * which redirects the person there from its own page. Unchecked, that is an open redirect running
 * through the payment flow: a compromised front end or a browser extension could send a backer from
 * the bank's page to a look-alike "payment failed, re-enter your card" site, and the link would look
 * like ours because the redirect came from checkout.
 *
 * <p>So an address is accepted only when it is absolute, carries no user information, and its
 * scheme, host and port are exactly those of a configured origin ({@link ReturnUrlProperties}). The
 * path and query are the caller's: the web returns to {@code /{locale}/pledges/{id}?payment=…} and
 * {@code /{locale}/settings/payout?card=…}, and neither is the platform's business to enumerate. An
 * absent address is accepted too, because both fields are optional and the provider then uses the
 * return pages configured in the merchant account.
 *
 * <p><strong>Configured origins are https.</strong> The one exception is a loopback host —
 * {@code http://localhost:3000} is the default site origin and what a developer runs — because no
 * third party can serve a page on somebody else's loopback. {@code http} on any other host is
 * refused: a return over plain http can be rewritten by anybody on the network path.
 *
 * <p><strong>No custom schemes</strong> ({@code ideanest://}). Nobody has confirmed that the provider
 * redirects to one, and the native application returns through an https page on the site instead —
 * {@code docs/architecture.md} §9.4 records the decision.
 *
 * <p><strong>Loopback only, outside development, is logged loudly.</strong> {@code WEB_BASE_URL}
 * defaults to {@code http://localhost:3000}, and that is a valid origin, so a deployment that forgot
 * the variable starts cleanly and then refuses every real return address — a payment outage with
 * nothing in the log. The service still starts (a start-up refusal would take down everything else
 * the API serves over one variable), but it says so at WARN. See
 * {@link #looksDeployed(Environment)} for how "outside development" is told.
 *
 * <p><strong>Every refusal is logged</strong> at WARN with the field and the host, never the path or
 * query: those are the caller's and may carry anything, including an attacker's link.
 */
@Component
public class ReturnUrls {

    private static final Logger log = LoggerFactory.getLogger(ReturnUrls.class);

    private static final Set<String> LOOPBACK_HOSTS = Set.of("localhost", "127.0.0.1", "[::1]");

    /** Profiles in which a loopback-only allow-list is what is expected. */
    private static final Set<String> DEVELOPMENT_PROFILES = Set.of("local", "test");

    /**
     * The longest return address accepted. Both addresses are stored in the pending charge's
     * {@code provider_response}, and {@code transactions} is append-only: whatever is accepted here
     * stays forever. 2048 is the long-standing practical URL limit and far above what the web sends.
     */
    static final int MAX_LENGTH = 2048;

    /** A host in a log line is bounded too: a DNS name is at most 253 characters. */
    private static final int MAX_LOGGED_HOST_LENGTH = 253;

    private final List<Origin> allowed;

    @Autowired
    public ReturnUrls(ReturnUrlProperties properties, Environment environment) {
        this(properties);
        if (!allowed.isEmpty() && allowed.stream().allMatch(Origin::isLoopback) && looksDeployed(environment)) {
            log.warn(
                    "PAYMENT RETURN ADDRESSES ARE LOOPBACK ONLY ({}) outside local development: every real"
                            + " successUrl and errorUrl will be refused with INVALID_RETURN_URL and payments"
                            + " cannot return to the site. Set WEB_BASE_URL to the site's https origin (and"
                            + " PAYMENT_RETURN_ORIGINS for any further host) — ops/deploy/README.md.",
                    allowed.stream().map(Origin::display).toList());
        }
    }

    /** Without an environment: no start-up diagnosis. For unit tests of the rule itself. */
    ReturnUrls(ReturnUrlProperties properties) {
        List<Origin> origins = new ArrayList<>();
        if (!properties.siteOrigin().isEmpty()) {
            // Lenient about the site origin, strict about the extras. The site origin is
            // WEB_BASE_URL, which every deployment already sets for its e-mail links, and a value
            // that was good enough for those must not stop the service starting; an unusable one
            // refuses payments and says why, once, here.
            try {
                origins.add(Origin.parse(properties.siteOrigin()));
            } catch (IllegalArgumentException unusable) {
                log.warn(
                        "The site origin {} cannot be a payment return address ({}); every successUrl and"
                                + " errorUrl on it will be refused.",
                        properties.siteOrigin(),
                        unusable.getMessage());
            }
        }
        // An extra origin is only ever there because somebody added it for this purpose, so a
        // mistake in one is a start-up failure rather than a payment refused on a staging host.
        for (String entry : properties.additionalOrigins()) {
            origins.add(Origin.parse(entry));
        }
        this.allowed = List.copyOf(origins);
    }

    /**
     * Whether this process looks like a deployment rather than a developer's machine or a test run.
     *
     * <p>A profile alone cannot tell: {@code spring.profiles.default} is {@code local}, so a deployed
     * API that sets no profile runs as "local" too. So: an explicitly active {@code local} or
     * {@code test} profile is development. Any other explicitly active profile is a deployment. With
     * no active profile at all (the {@code local} default), a configured payment provider
     * ({@code ideanest.payment.provider.primary}, e.g. {@code EPOINT}) is what marks a deployment —
     * nobody configures merchant keys to leave them unused.
     */
    static boolean looksDeployed(Environment environment) {
        String[] active = environment.getActiveProfiles();
        if (Arrays.stream(active).anyMatch(DEVELOPMENT_PROFILES::contains)) {
            return false;
        }
        if (active.length > 0) {
            return true;
        }
        String provider = environment.getProperty("ideanest.payment.provider.primary", "");
        return !provider.isBlank();
    }

    /**
     * Refuses either address unless it is on a configured origin.
     *
     * @throws InvalidReturnUrlException naming the first field that is not
     */
    public void check(URI successUrl, URI errorUrl) {
        check("successUrl", successUrl);
        check("errorUrl", errorUrl);
    }

    /**
     * The site's own origin, for a person who comes back from a provider with no usable address — #359.
     * Empty when no origin is configured.
     */
    public java.util.Optional<URI> home() {
        return allowed.stream().findFirst().map(origin -> {
            boolean defaultPort = ("https".equals(origin.scheme()) && origin.port() == 443)
                    || ("http".equals(origin.scheme()) && origin.port() == 80);
            return URI.create(origin.scheme() + "://" + origin.host() + (defaultPort ? "" : ":" + origin.port()) + "/");
        });
    }

    /** Whether this address may be handed to a provider. Null is: the field is optional. */
    public boolean accepts(URI url) {
        if (url == null) {
            return true;
        }
        if (url.toASCIIString().length() > MAX_LENGTH) {
            // The ASCII form is what goes to the provider and is never shorter than toString(),
            // which is what provider_response stores — so this bounds both.
            return false;
        }
        if (!url.isAbsolute() || url.isOpaque() || url.getRawUserInfo() != null || url.getHost() == null) {
            // Relative, `javascript:`/`mailto:`/`data:`, `https://somebody@host`, or an authority
            // java.net.URI could not read as a host (percent-encoded, non-ASCII, empty). None of
            // them is a page on the site.
            return false;
        }
        if (url.getRawAuthority().indexOf('@') >= 0) {
            // Belt and braces: an `@` anywhere in the authority is user information to a browser,
            // whether or not java.net.URI reported it as such.
            return false;
        }
        Origin candidate = Origin.of(url.getScheme(), url.getHost(), url.getPort());
        return allowed.contains(candidate);
    }

    private void check(String field, URI url) {
        if (!accepts(url)) {
            log.warn("Refused a payment return address: field={} host={}", field, loggableHost(url));
            throw new InvalidReturnUrlException(field);
        }
    }

    /** The host alone, bounded; never the path or query, which are the caller's. */
    private static String loggableHost(URI url) {
        String host = url.getHost();
        if (host == null) {
            return "(none)";
        }
        return host.length() > MAX_LOGGED_HOST_LENGTH ? host.substring(0, MAX_LOGGED_HOST_LENGTH) + "…" : host;
    }

    /** Scheme, host and effective port, compared case-insensitively where the URI spec says so. */
    private record Origin(String scheme, String host, int port) {

        boolean isLoopback() {
            return LOOPBACK_HOSTS.contains(host);
        }

        String display() {
            return scheme + "://" + host + ":" + port;
        }

        static Origin of(String scheme, String host, int port) {
            String normalisedScheme = scheme.toLowerCase(Locale.ROOT);
            int effectivePort = port;
            if (effectivePort == -1) {
                // `https://ideanest.az` and `https://ideanest.az:443` are one origin.
                effectivePort = switch (normalisedScheme) {
                    case "https" -> 443;
                    case "http" -> 80;
                    default -> -1;
                };
            }
            return new Origin(normalisedScheme, host.toLowerCase(Locale.ROOT), effectivePort);
        }

        static Origin parse(String value) {
            URI uri;
            try {
                uri = new URI(value);
            } catch (URISyntaxException malformed) {
                throw new IllegalArgumentException("A payment return origin is not a URI: " + value, malformed);
            }
            if (!uri.isAbsolute() || uri.isOpaque() || uri.getHost() == null || uri.getRawUserInfo() != null) {
                throw new IllegalArgumentException("A payment return origin is scheme://host[:port]: " + value);
            }
            String path = uri.getRawPath();
            boolean hasPath = path != null && !path.isEmpty() && !"/".equals(path);
            if (hasPath || uri.getRawQuery() != null || uri.getRawFragment() != null) {
                throw new IllegalArgumentException(
                        "A payment return origin has no path, query or fragment: " + value);
            }
            Origin origin = of(uri.getScheme(), uri.getHost(), uri.getPort());
            boolean https = "https".equals(origin.scheme());
            boolean loopbackHttp = "http".equals(origin.scheme()) && LOOPBACK_HOSTS.contains(origin.host());
            if (!https && !loopbackHttp) {
                throw new IllegalArgumentException(
                        "A payment return origin is https, or http on a loopback host only: " + value);
            }
            return origin;
        }
    }
}
