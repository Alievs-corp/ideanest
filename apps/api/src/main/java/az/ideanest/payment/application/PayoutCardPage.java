package az.ideanest.payment.application;

import java.net.URI;

/**
 * Where a creator enters their payout card — IDN-EXT-01 (#44).
 *
 * @param provider the provider that will hold the card, as a {@code ProviderName} constant's spelling,
 *     so a module that may not name payment's domain can still say which one
 * @param redirectUrl the provider's page
 */
public record PayoutCardPage(String provider, URI redirectUrl) {
}
