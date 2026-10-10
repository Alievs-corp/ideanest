package az.ideanest.payment.api;

import az.ideanest.payment.application.ProviderWebhooks;
import az.ideanest.payment.application.WebhookReceipt;
import az.ideanest.shared.payment.ReturnUrls;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §10.2's {@code POST /v1/webhooks/psp/{provider}} (#66).
 *
 * <p><strong>The only unauthenticated write endpoint on the platform</strong>, and
 * everything about it is arranged around that. There is no session, no token and no
 * account: the sender is a payment provider, and the only thing that distinguishes it
 * from anybody who has guessed the URL is a signature over the body. So the controller
 * does as close to nothing as an endpoint can — it hands the bytes and the headers to
 * {@code ProviderWebhooks}, which hands them to the adapter that can verify them, and
 * makes no decision of its own that could be reached without a valid signature.
 *
 * <h2>{@code byte[]} and not a bound request type</h2>
 *
 * <p>Every other controller in this service binds a validated record. This one takes
 * the raw body, because <strong>a signature is over the bytes</strong>: a body parsed
 * into objects and serialised again is a different sequence of them, and the check
 * would fail for every provider that signs the payload rather than a digest of a few
 * named fields. It also means a body the platform cannot parse is still verifiable, and
 * therefore still recordable, rather than being rejected by Jackson before anything has
 * established who sent it.
 *
 * <h2>Everything the platform has finished with is a 200</h2>
 *
 * <p>Processed, ignored and already-seen are all 200 with an empty body. A provider
 * retries anything that is not a 2xx, so the status is an instruction about retrying
 * rather than a description — and a body distinguishing the three would tell whoever
 * has the URL which events the platform acts on. The distinction is in the log and in
 * {@code provider_webhook_events}, where the question is actually asked.
 *
 * <p>What is <em>not</em> a 200 is a delivery the platform failed to handle, which is a
 * 500 and a retry, and a delivery it refused, which is a 400 or a 404 and no retry. See
 * {@code ProviderWebhookExceptionHandler}.
 *
 * <h2>What is deliberately absent</h2>
 *
 * <p><strong>No rate limiting.</strong> Every other public endpoint has some, and this
 * one is protected by something better: an unsigned body is refused before anything is
 * read, and a valid signature cannot be produced by whoever would be flooding it. A
 * limiter here would instead throttle a provider delivering a genuine backlog after an
 * outage — exactly when the platform most needs the deliveries.
 *
 * <p><strong>No source allowlist.</strong> §17.2 lists one and it belongs to the
 * deployment's network rather than to this class: the address a Java servlet sees is
 * whatever proxy terminated the connection, so an allowlist here would either match the
 * load balancer or trust an {@code X-Forwarded-For} that the sender controls. §19.1 is
 * where it goes.
 */
@RestController
public class ProviderWebhookController {

    private static final Logger log = LoggerFactory.getLogger(ProviderWebhookController.class);

    private final ProviderWebhooks webhooks;
    private final ReturnUrls returnUrls;

    public ProviderWebhookController(ProviderWebhooks webhooks, ReturnUrls returnUrls) {
        this.webhooks = webhooks;
        this.returnUrls = returnUrls;
    }

    /**
     * Sends a person's browser back to the site — #359.
     *
     * <p>Payriff sends the backer to the order's callback address after 3-D Secure, with a GET, and
     * ignores the return address it was given. The adapter puts that address on the callback as
     * {@code return}, and this answers 303 to it — but only when {@link ReturnUrls} accepts it, so the
     * endpoint is not an open redirect; anything else goes to the site's own origin.
     *
     * <p><strong>The same answer for every provider name</strong>, configured or not, and no body: a
     * GET here must not become a way to ask which providers the platform has adapters for. It reads
     * nothing and changes nothing; the payment is settled by the POST, or by #353's sweep.
     */
    @GetMapping("/v1/webhooks/psp/{provider}")
    public ResponseEntity<Void> returnToSite(
            @PathVariable("provider") String provider, @RequestParam(name = "return", required = false) String back) {
        URI target = parse(back);
        if (target == null || !returnUrls.accepts(target)) {
            target = returnUrls.home().orElse(null);
        }
        if (target == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(target).build();
    }

    private static URI parse(String address) {
        if (address == null || address.isBlank()) {
            return null;
        }
        try {
            return URI.create(address.trim());
        } catch (IllegalArgumentException unreadable) {
            return null;
        }
    }

    /**
     * Receives one delivery.
     *
     * <p>No {@code consumes} and no {@code produces}: a provider sends whatever content
     * type its own documentation says it sends — several send
     * {@code application/x-www-form-urlencoded} — and an endpoint that answered 415
     * before verifying anything would be refusing a delivery for a reason nobody
     * configured.
     *
     * @param provider the {@code {provider}} path segment. Matched case-insensitively
     *     against §9.3's list; anything else is a 404
     * @param body the request body, exactly as it arrived
     */
    @PostMapping("/v1/webhooks/psp/{provider}")
    public ResponseEntity<Void> receive(
            @PathVariable("provider") String provider,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request) {

        // An empty body is refused here rather than in the adapter, because every adapter
        // would otherwise have to refuse it separately and one of them would eventually
        // treat it as an unrecognised event and answer 200.
        byte[] raw = body == null ? new byte[0] : body;

        WebhookReceipt receipt = webhooks.receive(provider, raw, headersOf(request));

        // DEBUG rather than INFO: a provider sends everything it has, so this line is
        // otherwise one row per event type per campaign for the life of the platform.
        // ProviderWebhooks logs the deliveries that were acted on at INFO.
        log.debug("Delivery to {} answered {}.", provider, receipt);
        return ResponseEntity.status(HttpStatus.OK).build();
    }

    /**
     * The request's headers, lower-cased.
     *
     * <p>Lower-cased here so that no adapter has to know which case the transport chose.
     * HTTP header names are case-insensitive and HTTP/2 requires them lower-case, so an
     * adapter matching {@code X-Signature} literally would work behind one proxy and not
     * behind another — the sort of failure that reproduces in production and not in a
     * test.
     *
     * <p>One value per name, the first. No provider's signature scheme uses a repeated
     * header, and folding several into a comma-joined string would silently change the
     * bytes a signature is checked against.
     */
    private static Map<String, String> headersOf(HttpServletRequest request) {
        Map<String, String> headers = new HashMap<>();
        Enumeration<String> names = request.getHeaderNames();
        if (names == null) {
            return Collections.emptyMap();
        }
        while (names.hasMoreElements()) {
            String name = names.nextElement();
            headers.put(name.toLowerCase(Locale.ROOT), request.getHeader(name));
        }
        return Collections.unmodifiableMap(headers);
    }
}
