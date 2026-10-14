package az.ideanest.project.application;

import java.util.UUID;

/**
 * A campaign a payment is being posted for, as much of it as the payment module may see.
 *
 * <p>§16.1 keeps {@code Project} inside this module, and what the other side actually
 * needs is three fields. The creator's identifier is the one that would otherwise force the coupling
 * — §9.5 credits {@code creator:{id}} at collection, and that identifier lives on
 * {@code projects} and nowhere the payment module can reach.
 *
 * @param projectId which campaign
 * @param creatorId whose ledger account the collection credits
 * @param currency the campaign's currency, frozen at launch. Carried so that the
 *     posting can be checked against the pledge's own currency rather than assumed to
 *     match it — §21.2 has no rate at which a mismatch could be reconciled, so a
 *     mismatch has to be refused rather than converted
 */
public record CollectingCampaign(UUID projectId, UUID creatorId, String currency) {}
