package az.ideanest.payment.domain;

/** Where a payout card registration is — IDN-EXT-01 (#44). See V81. */
public enum PayoutCardRegistrationState {
    PENDING,
    REGISTERED,
    FAILED
}
