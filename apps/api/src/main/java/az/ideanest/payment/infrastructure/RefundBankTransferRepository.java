package az.ideanest.payment.infrastructure;

import az.ideanest.payment.domain.RefundBankTransfer;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** V99's refunds paid by bank transfer — issue #399. */
public interface RefundBankTransferRepository extends JpaRepository<RefundBankTransfer, UUID> {

    /**
     * Whether this bank reference was already recorded for a refund of another pledge.
     *
     * <p>One transfer may pay every part of one pledge's refund — staff send what is owed in one
     * payment — so the same reference on two refunds of one pledge is ordinary. On another backer's
     * refund it is a transfer recorded twice, and one of the two backers was not paid.
     */
    @Query(
            value =
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM refund_bank_transfers b
                          JOIN refunds r ON r.id = b.refund_id
                         WHERE b.bank_reference = :reference
                           AND r.pledge_id <> :pledgeId)
                    """,
            nativeQuery = true)
    boolean referenceTakenElsewhere(@Param("reference") String reference, @Param("pledgeId") UUID pledgeId);

    /**
     * Whether the support ticket was raised by the backer of this pledge — the conversation a backer's
     * bank account may be recorded from.
     *
     * <p>Native, because tickets and pledges are two other modules' tables and this module may not
     * name their classes.
     */
    @Query(
            value =
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM support_tickets t
                          JOIN pledges p ON p.backer_id = t.requester_id
                         WHERE t.id = :ticketId
                           AND p.id = :pledgeId)
                    """,
            nativeQuery = true)
    boolean ticketIsFromBackerOf(@Param("ticketId") UUID ticketId, @Param("pledgeId") UUID pledgeId);
}
