package az.ideanest.payment.api;

import az.ideanest.payment.application.ProviderWebhooks;
import az.ideanest.payment.infrastructure.SandboxPaymentProvider;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.HtmlUtils;

/**
 * The local sandbox's "card entry" page — issue #243. <strong>Temporary.</strong>
 *
 * <p>Stands where Epoint's own page will: the creator is sent here by
 * {@code POST /v1/me/payout-destination/card-registration}, chooses to register or decline, and is
 * sent back to the settings page. Registering delivers a webhook through {@link ProviderWebhooks}
 * — the same call Epoint's callback reaches — so everything after it is the real path.
 *
 * <p>No card number is asked for, because none would be used: the sandbox moves no money. The
 * holder's name is asked for, because the three-way name match is the thing worth trying here; it
 * defaults to nothing so that leaving it empty shows the "not named by the provider" case.
 *
 * <p>Exists only beside {@link SandboxPaymentProvider}, under the same condition, and the
 * security configuration lets it through unauthenticated because a browser arriving from a
 * redirect carries no bearer token. The card identifier is a random UUID known only to the
 * creator who began it.
 */
@RestController
@ConditionalOnProperty(prefix = "ideanest.payment.provider", name = "primary", havingValue = "SANDBOX")
public class SandboxPayoutCardController {

    private final SandboxPaymentProvider sandbox;
    private final ProviderWebhooks webhooks;

    public SandboxPayoutCardController(SandboxPaymentProvider sandbox, ProviderWebhooks webhooks) {
        this.sandbox = sandbox;
        this.webhooks = webhooks;
    }

    @GetMapping(path = "/v1/sandbox/payout-cards/{cardId}", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> page(@PathVariable String cardId) {
        if (sandbox.pendingFor(cardId).isEmpty()) {
            return html(HttpStatus.NOT_FOUND, document("""
                    <h1>No such card registration</h1>
                    <p>It has finished already, or this service restarted since it began. Start again from the payout settings.</p>
                    """));
        }
        String action = "/v1/sandbox/payout-cards/" + HtmlUtils.htmlEscape(cardId);
        return html(HttpStatus.OK, document("""
                <p><strong>Sandbox.</strong> Local development only. No card is read and no money moves (#243).</p>
                <h1>Register a business card</h1>
                <form method="post" action="%s">
                  <p>
                    <label for="holder">Name on the card</label><br>
                    <input id="holder" name="holder" autocomplete="off" size="40">
                  </p>
                  <p>
                    <button type="submit" name="outcome" value="register">Register the card</button>
                    <button type="submit" name="outcome" value="decline">Decline</button>
                  </p>
                </form>
                """.formatted(action)));
    }

    @PostMapping(
            path = "/v1/sandbox/payout-cards/{cardId}",
            consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
    public ResponseEntity<String> finish(
            @PathVariable String cardId,
            @RequestParam(name = "outcome", defaultValue = "decline") String outcome,
            @RequestParam(name = "holder", required = false) String holder) {

        Optional<SandboxPaymentProvider.Pending> found = sandbox.pendingFor(cardId);
        if (found.isEmpty()) {
            return page(cardId);
        }
        boolean registered = "register".equals(outcome);
        SandboxPaymentProvider.Delivery delivery = sandbox.deliveryFor(cardId, registered, holder);
        webhooks.receive("sandbox", delivery.body(), delivery.headers());

        URI back = registered ? found.get().successUrl() : found.get().errorUrl();
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(back).build();
    }

    private static ResponseEntity<String> html(HttpStatus status, String body) {
        return ResponseEntity.status(status)
                .cacheControl(CacheControl.noStore())
                .contentType(new MediaType(MediaType.TEXT_HTML, StandardCharsets.UTF_8))
                .body(body);
    }

    private static String document(String content) {
        return """
                <!doctype html>
                <html lang="en">
                <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Sandbox card</title>
                </head>
                <body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem;">
                %s
                </body>
                </html>
                """.formatted(content);
    }
}
