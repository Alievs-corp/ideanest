package az.ideanest.payment;

import az.ideanest.payment.domain.ProviderName;
import java.math.BigDecimal;
import java.util.EnumMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * What each provider keeps out of a charge it settles — #401.
 *
 * @param rates the provider's commission as a fraction of the charge: Payriff's is {@code 0.03},
 *     confirmed by Payriff on 2026-10-12 (#387). <strong>A provider with no entry posts no fee</strong>,
 *     which is right for one whose rate nobody has confirmed: a guessed rate in the ledger would look
 *     like a fact
 */
@ConfigurationProperties(prefix = "ideanest.payment.provider-fees")
public record ProviderFeeProperties(Map<ProviderName, BigDecimal> rates) {

    public ProviderFeeProperties {
        Map<ProviderName, BigDecimal> checked = new EnumMap<>(ProviderName.class);
        if (rates != null) {
            rates.forEach((provider, rate) -> {
                if (provider == null || rate == null) {
                    return;
                }
                if (rate.signum() < 0 || rate.compareTo(BigDecimal.ONE) >= 0) {
                    throw new IllegalArgumentException(
                            "provider-fees.rates." + provider.slug() + " must be at least 0 and below 1, and is " + rate);
                }
                checked.put(provider, rate);
            });
        }
        rates = Map.copyOf(checked);
    }
}
