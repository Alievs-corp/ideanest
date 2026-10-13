package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.util.EnumSet;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** #436: which refunds may keep the provider's fee back, as the entity enforces it before V101 does. */
class RefundWithheldFeeTests {

    private static final UUID PLEDGE = UUID.fromString("0193f2a1-0000-7000-8000-000000000021");
    private static final UUID PROJECT = UUID.fromString("0193f2a1-0000-7000-8000-000000000022");
    private static final UUID CHARGE = UUID.fromString("0193f2a1-0000-7000-8000-000000000023");
    private static final UUID STAFF = UUID.fromString("0193f2a1-0000-7000-8000-000000000024");

    @Test
    @DisplayName("only a failed or halted campaign's refund withholds the fee")
    void onlyCampaignOutcomes() {
        assertThat(EnumSet.allOf(RefundReason.class).stream().filter(Refund::withholdsProviderFee))
                .containsExactlyInAnyOrder(RefundReason.CAMPAIGN_FAILED, RefundReason.CAMPAIGN_HALTED);
    }

    @Test
    @DisplayName("a campaign refund records what it sends and what it keeps back, separately")
    void recordsBoth() {
        Refund refund = Refund.requested(
                PLEDGE, PROJECT, CHARGE, azn("97.00"), azn("3.00"), true, RefundReason.CAMPAIGN_FAILED, "Failed.", null, "k-436-1");

        assertThat(refund.amount()).isEqualTo(azn("97.00"));
        assertThat(refund.withheldFee()).isEqualTo(azn("3.00"));
    }

    @Test
    @DisplayName("every other refund withholds nothing")
    void othersWithholdNothing() {
        Refund staff = Refund.requested(
                PLEDGE, PROJECT, CHARGE, azn("100.00"), true, RefundReason.BACKER_REQUEST, "Asked.", STAFF, "k-436-2");
        assertThat(staff.withheldFee().isZero()).isTrue();

        assertThatThrownBy(() -> Refund.requested(
                        PLEDGE, PROJECT, CHARGE, azn("97.00"), azn("3.00"), true, RefundReason.BACKER_REQUEST, "Asked.", STAFF,
                        "k-436-3"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Refund.requested(
                        PLEDGE, PROJECT, CHARGE, azn("97.00"), azn("3.00"), false, RefundReason.RAISE_NOT_APPLIED, "Raise.",
                        null, "k-436-4"))
                .as("a raise that could not be applied bought nothing, and is returned whole")
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Refund.requested(
                        PLEDGE, PROJECT, CHARGE, azn("97.00"), Money.of(new BigDecimal("3.00"), "USD"), true,
                        RefundReason.CAMPAIGN_FAILED, "Failed.", null, "k-436-5"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static Money azn(String amount) {
        return Money.of(new BigDecimal(amount), "AZN");
    }
}
