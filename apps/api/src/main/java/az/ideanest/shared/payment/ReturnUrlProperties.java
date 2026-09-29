package az.ideanest.shared.payment;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The origins a payment provider may return a person to — issue #139.
 *
 * @param siteOrigin the web application's public origin. {@code application.yml} points it at
 *     {@code ideanest.notification.email.base-url} ({@code WEB_BASE_URL}), which is the API's name
 *     for what the web calls {@code IDEANEST_SITE_URL}: one variable for "where the site is", so a
 *     deployment that moved its site cannot leave the payment flow pointing at the old one
 * @param additionalOrigins further origins, for an environment whose site answers on more than one
 *     — a staging host beside a preview host. {@code PAYMENT_RETURN_ORIGINS}, comma separated,
 *     empty by default
 */
@ConfigurationProperties(prefix = "ideanest.payment.return-urls")
public record ReturnUrlProperties(String siteOrigin, List<String> additionalOrigins) {

    public ReturnUrlProperties {
        siteOrigin = siteOrigin == null ? "" : siteOrigin.trim();
        // Binding an unset variable gives an empty string, and a comma-separated value may carry a
        // stray comma; neither is an origin anybody meant.
        additionalOrigins = additionalOrigins == null
                ? List.of()
                : additionalOrigins.stream().map(String::trim).filter(entry -> !entry.isEmpty()).toList();
    }
}
