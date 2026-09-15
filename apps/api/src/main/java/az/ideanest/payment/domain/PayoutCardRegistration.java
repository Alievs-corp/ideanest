package az.ideanest.payment.domain;

import az.ideanest.shared.Identifiers;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A creator's payout card between the provider naming it and the provider registering it —
 * IDN-EXT-01 (#44). See V81.
 */
@Entity
@Table(name = "payout_card_registrations")
public class PayoutCardRegistration {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "creator_id", nullable = false, updatable = false)
    private UUID creatorId;

    @Enumerated(EnumType.STRING)
    @Column(name = "provider", nullable = false, updatable = false)
    private ProviderName provider;

    @Column(name = "card_id", nullable = false, updatable = false)
    private String cardId;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private PayoutCardRegistrationState state;

    @Column(name = "started_at", nullable = false, updatable = false)
    private Instant startedAt;

    @Column(name = "settled_at")
    private Instant settledAt;

    protected PayoutCardRegistration() {
    }

    public static PayoutCardRegistration started(UUID creatorId, ProviderName provider, String cardId, Instant at) {
        PayoutCardRegistration registration = new PayoutCardRegistration();
        registration.id = Identifiers.newIdentifier();
        registration.creatorId = Objects.requireNonNull(creatorId, "creatorId");
        registration.provider = Objects.requireNonNull(provider, "provider");
        if (cardId == null || cardId.isBlank()) {
            throw new IllegalArgumentException("A registration names the card the provider issued");
        }
        registration.cardId = cardId;
        registration.state = PayoutCardRegistrationState.PENDING;
        registration.startedAt = Objects.requireNonNull(at, "at");
        return registration;
    }

    public boolean isPending() {
        return state == PayoutCardRegistrationState.PENDING;
    }

    public void registered(Instant at) {
        settle(PayoutCardRegistrationState.REGISTERED, at);
    }

    public void failed(Instant at) {
        settle(PayoutCardRegistrationState.FAILED, at);
    }

    private void settle(PayoutCardRegistrationState to, Instant at) {
        if (!isPending()) {
            throw new IllegalStateException("Card " + cardId + " is already " + state);
        }
        this.state = to;
        this.settledAt = Objects.requireNonNull(at, "at");
    }

    public UUID creatorId() {
        return creatorId;
    }

    public ProviderName provider() {
        return provider;
    }

    public String cardId() {
        return cardId;
    }

    public PayoutCardRegistrationState state() {
        return state;
    }
}
