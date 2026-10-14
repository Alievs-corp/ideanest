package az.ideanest.payment.domain;

import java.util.Objects;
import java.util.Set;

/**
 * §9.4's capability record: what an adapter's provider can actually do.
 *
 * <p><strong>This is not documentation.</strong> It is read per payment, to decide whether a
 * currency can be charged and whether less than the whole of a charge can be returned.
 *
 * <p>Until #45 it also carried §9.3's R-01 card-on-file, R-02 merchant-initiated and R-03
 * scheme chaining, which the stored-card collection at close rested on. IDN-EXT-01 charges
 * the backer on the provider's own page when the pledge is made, so nothing asks those three
 * any more and they left with the collection.
 *
 * @param splitPayment R-10, optional. Whether §9.5's distribution can be performed by
 *     the provider rather than by the payout run. Optional means optional — the
 *     ledger is the platform's record either way, and a provider that splits changes
 *     who moves the money and not who accounts for it
 * @param partialRefund R-06. Whether less than the whole of a charge can be returned.
 *     Not required at registration, because §9.7's scenarios are all full refunds;
 *     #67 is what will read it, and a provider without it makes partial refunds a
 *     product limitation rather than a bug
 * @param wallets R-12, possibly empty
 * @param currencies R-11: the ISO 4217 codes the provider settles in. Checked per
 *     charge rather than at start-up, because a provider that cannot take one
 *     currency is still the right provider for every campaign in the others
 */
public record ProviderCapabilities(
        boolean splitPayment,
        boolean partialRefund,
        Set<WalletType> wallets,
        Set<String> currencies) {

    public ProviderCapabilities {
        // Defensive copies of both, and not merely for immutability. These sets are
        // read on every charge to decide whether a currency is supported, and an
        // adapter that handed over a mutable set it went on holding could change the
        // answer between the check and the call.
        wallets = wallets == null ? Set.of() : Set.copyOf(wallets);
        currencies = currencies == null ? Set.of() : Set.copyOf(currencies);

        for (String currency : currencies) {
            Objects.requireNonNull(currency, "A supported currency cannot be null");
            if (!currency.matches("^[A-Z]{3}$")) {
                throw new IllegalArgumentException(
                        "A supported currency is an ISO 4217 code in upper case, and one is '" + currency + "'");
            }
        }
    }

    /** Whether the provider settles in this currency. */
    public boolean supports(String currency) {
        return currency != null && currencies.contains(currency);
    }
}
