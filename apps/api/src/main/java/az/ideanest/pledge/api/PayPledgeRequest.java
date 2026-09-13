package az.ideanest.pledge.api;

import java.net.URI;

/**
 * The body of {@code POST /v1/pledges/{id}/payment} — IDN-EXT-01 (#39). Every field is optional.
 *
 * @param acknowledgedAgreementVersion the backer agreement version the checkout showed, as on confirm
 * @param language the payment page's language: az, en or ru
 * @param successUrl where the provider returns the backer after paying
 * @param errorUrl where it returns them after a failure
 */
public record PayPledgeRequest(Integer acknowledgedAgreementVersion, String language, URI successUrl, URI errorUrl) {

    static PayPledgeRequest orEmpty(PayPledgeRequest body) {
        return body == null ? new PayPledgeRequest(null, null, null, null) : body;
    }
}
