package az.ideanest.shared.ratelimit;

import jakarta.servlet.http.HttpServletRequest;

/**
 * What an anonymous caller is counted as.
 *
 * <p>One copy of a decision that four endpoints had made separately. It is the kind
 * of three-line helper that is cheaper to repeat than to share right up until the
 * day the reasoning below changes, at which point the copies that were not updated
 * are the ones that turn the limiter off.
 */
public final class ClientAddress {

    private ClientAddress() {
    }

    /**
     * The remote address as the container resolved it.
     *
     * <p>Deliberately not {@code X-Forwarded-For} read here. Trusting that header from
     * anybody means any client can pick its own rate-limit bucket by inventing one,
     * which turns the limiter off. {@code server.forward-headers-strategy: native} in
     * {@code application.yml} (#578) is what makes this the client's address behind
     * the proxy: Tomcat rewrites {@code getRemoteAddr} from the header only when the
     * connection comes from a private-network proxy, and takes the right-most hop that
     * is not one. A caller that reaches the container directly is still counted as the
     * address it connected from. One rule in the container, rather than a header
     * parser in every class that needs an address.
     */
    public static String of(HttpServletRequest request) {
        String address = request.getRemoteAddr();
        return address == null ? "unknown" : address;
    }
}
