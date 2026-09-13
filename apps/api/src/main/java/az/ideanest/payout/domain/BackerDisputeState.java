package az.ideanest.payout.domain;

/** IDN-EXT-01 (#43). */
public enum BackerDisputeState {
    /** Waiting for an administrator. */
    OPEN,
    /** The backer was refunded in full and the payout recalculated without them. */
    UPHELD,
    /** Nothing moved. */
    REJECTED
}
