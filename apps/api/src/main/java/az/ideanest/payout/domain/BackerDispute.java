package az.ideanest.payout.domain;

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

/** A backer's dispute of their payment during the payout hold — IDN-EXT-01 (#43). See V79. */
@Entity
@Table(name = "backer_disputes")
public class BackerDispute {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "pledge_id", nullable = false, updatable = false)
    private UUID pledgeId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "backer_id", nullable = false, updatable = false)
    private UUID backerId;

    @Column(name = "payout_id", nullable = false, updatable = false)
    private UUID payoutId;

    @Column(name = "reason", nullable = false, updatable = false)
    private String reason;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private BackerDisputeState state;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "decision_note")
    private String decisionNote;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "refund_id")
    private UUID refundId;

    @Column(name = "opened_at", nullable = false, updatable = false)
    private Instant openedAt;

    protected BackerDispute() {
    }

    public static BackerDispute opened(
            UUID pledgeId, UUID projectId, UUID backerId, UUID payoutId, String reason, Instant at) {
        BackerDispute dispute = new BackerDispute();
        dispute.id = Identifiers.newIdentifier();
        dispute.pledgeId = Objects.requireNonNull(pledgeId, "pledgeId");
        dispute.projectId = Objects.requireNonNull(projectId, "projectId");
        dispute.backerId = Objects.requireNonNull(backerId, "backerId");
        dispute.payoutId = Objects.requireNonNull(payoutId, "payoutId");
        String trimmed = Objects.requireNonNull(reason, "reason").trim();
        if (trimmed.isEmpty() || trimmed.length() > 2000) {
            throw new IllegalArgumentException("A dispute says why, in at most 2000 characters");
        }
        dispute.reason = trimmed;
        dispute.state = BackerDisputeState.OPEN;
        dispute.openedAt = Objects.requireNonNull(at, "at");
        return dispute;
    }

    public void upheld(UUID by, String note, UUID refund, Instant at) {
        requireOpen();
        this.state = BackerDisputeState.UPHELD;
        this.decidedBy = Objects.requireNonNull(by, "by");
        this.decisionNote = note;
        this.refundId = Objects.requireNonNull(refund, "refund");
        this.decidedAt = Objects.requireNonNull(at, "at");
    }

    public void rejected(UUID by, String note, Instant at) {
        requireOpen();
        this.state = BackerDisputeState.REJECTED;
        this.decidedBy = Objects.requireNonNull(by, "by");
        this.decisionNote = note;
        this.decidedAt = Objects.requireNonNull(at, "at");
    }

    private void requireOpen() {
        if (state != BackerDisputeState.OPEN) {
            throw new IllegalStateException("Dispute " + id + " was already decided: " + state);
        }
    }

    public UUID id() {
        return id;
    }

    public UUID pledgeId() {
        return pledgeId;
    }

    public UUID projectId() {
        return projectId;
    }

    public UUID backerId() {
        return backerId;
    }

    public UUID payoutId() {
        return payoutId;
    }

    public String reason() {
        return reason;
    }

    public BackerDisputeState state() {
        return state;
    }

    public UUID decidedBy() {
        return decidedBy;
    }

    public String decisionNote() {
        return decisionNote;
    }

    public Instant decidedAt() {
        return decidedAt;
    }

    public UUID refundId() {
        return refundId;
    }

    public Instant openedAt() {
        return openedAt;
    }
}
