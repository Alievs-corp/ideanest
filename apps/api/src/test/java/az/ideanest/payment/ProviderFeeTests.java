package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.ledger.application.EntryDirection;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.Posting;
import az.ideanest.payment.application.PayoutFigures;
import az.ideanest.payment.application.ProviderFees;
import az.ideanest.payment.domain.ProviderName;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** #401: the provider's commission on a charge, and the split a payout posts. */
class ProviderFeeTests {

    private static final UUID TRANSACTION = UUID.fromString("0193f2a1-0000-7000-8000-000000000011");
    private static final UUID PROJECT = UUID.fromString("0193f2a1-0000-7000-8000-000000000012");
    private static final LedgerAccount CREATOR =
            LedgerAccount.creator(UUID.fromString("0193f2a1-0000-7000-8000-000000000013"));

    private final ProviderFees fees =
            new ProviderFees(new ProviderFeeProperties(Map.of(ProviderName.PAYRIFF, new BigDecimal("0.03"))));

    @Test
    @DisplayName("takes the provider's rate of a charge, as Payriff paid 4.85 on 5.00")
    void appliesTheRate() {
        assertThat(fees.on(ProviderName.PAYRIFF, azn("5.00"))).isEqualTo(azn("0.15"));
        assertThat(fees.on(ProviderName.PAYRIFF, azn("33.33"))).isEqualTo(azn("1.00"));
    }

    @Test
    @DisplayName("posts no fee for a provider whose rate nobody confirmed")
    void anUnconfiguredProviderHasNoFee() {
        assertThat(fees.on(ProviderName.EPOINT, azn("100.00")).isZero()).isTrue();

        Posting posting = fees.chargePosting(TRANSACTION, PROJECT, CREATOR, ProviderName.EPOINT, azn("100.00"));

        assertThat(posting.lines()).hasSize(2);
    }

    @Test
    @DisplayName("takes the fee out of escrow in the charge's own posting")
    void postsTheFeeWithTheCharge() {
        Posting posting = fees.chargePosting(TRANSACTION, PROJECT, CREATOR, ProviderName.PAYRIFF, azn("100.00"));

        assertThat(posting.lines())
                .containsExactlyInAnyOrder(
                        new Posting.Line(LedgerAccount.ESCROW, EntryDirection.DEBIT, azn("100.00")),
                        new Posting.Line(CREATOR, EntryDirection.CREDIT, azn("100.00")),
                        new Posting.Line(LedgerAccount.PSP_FEE, EntryDirection.DEBIT, azn("3.00")),
                        new Posting.Line(LedgerAccount.ESCROW, EntryDirection.CREDIT, azn("3.00")));
    }

    @Test
    @DisplayName("refuses a rate that is negative or the whole charge")
    void refusesAnImpossibleRate() {
        assertThatThrownBy(() -> new ProviderFeeProperties(Map.of(ProviderName.PAYRIFF, new BigDecimal("1"))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ProviderFeeProperties(Map.of(ProviderName.PAYRIFF, new BigDecimal("-0.01"))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(new ProviderFeeProperties(null).rates()).isEmpty();
    }

    @Test
    @DisplayName("a payout's parts must add up to its gross")
    void payoutFiguresMustAddUp() {
        PayoutFigures figures = new PayoutFigures(azn("1000.00"), azn("150.00"), azn("0.00"), azn("40.00"), azn("810.00"));
        assertThat(figures.net()).isEqualTo(azn("810.00"));

        assertThatThrownBy(() -> new PayoutFigures(azn("1000.00"), azn("150.00"), azn("0.00"), azn("0.00"), azn("810.00")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static Money azn(String amount) {
        return Money.of(new BigDecimal(amount), "AZN");
    }
}
