package az.ideanest.fee;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * §5.2's fee when no schedule is in force — IDN-EXT-01 (#42).
 *
 * <p><strong>15% of any withdrawal, the bank's and the provider's fees included</strong>, so a creator
 * reads one number and receives 85%. A schedule in {@code fee_schedules} — platform-wide, for a
 * category, or for one campaign — still takes precedence; this is what applies when staff have
 * created none. It replaced pricing at zero fees, which would have paid a creator the platform's
 * share of every withdrawal on any environment nobody had configured.
 *
 * @param defaultPlatformRate the platform's share, between zero and one
 * @param defaultProcessingRate a separate processing share; zero, because the bank is inside the 15%
 * @param defaultCurrency the currency the default is disclosed in
 */
@ConfigurationProperties(prefix = "ideanest.fee")
public record FeeProperties(BigDecimal defaultPlatformRate, BigDecimal defaultProcessingRate, String defaultCurrency) {

    private static final BigDecimal DEFAULT_PLATFORM_RATE = new BigDecimal("0.15");

    public FeeProperties {
        defaultPlatformRate = defaultPlatformRate == null ? DEFAULT_PLATFORM_RATE : defaultPlatformRate;
        defaultProcessingRate = defaultProcessingRate == null ? BigDecimal.ZERO : defaultProcessingRate;
        defaultCurrency = defaultCurrency == null || defaultCurrency.isBlank() ? "AZN" : defaultCurrency.trim();
        if (defaultPlatformRate.signum() < 0 || defaultProcessingRate.signum() < 0
                || defaultPlatformRate.add(defaultProcessingRate).compareTo(BigDecimal.ONE) > 0) {
            throw new IllegalArgumentException("Default fee rates are shares of a withdrawal and add up to at most one");
        }
    }
}
