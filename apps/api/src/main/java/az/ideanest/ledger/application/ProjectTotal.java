package az.ideanest.ledger.application;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * What a set of accounts holds for one campaign, in one currency — #587.
 *
 * <p>{@link AccountTotal}'s twin for a question asked per campaign rather than per account: the row
 * {@code LedgerEntryRepository.projectsBelowZero} projects into. Signed the way the ledger is signed,
 * debits positive and credits negative.
 *
 * @param projectId the campaign the entries were posted against
 * @param currency the ISO code the entries were written in
 * @param net debits minus credits over the accounts asked about, never summed across currencies (§21.2)
 */
public record ProjectTotal(UUID projectId, String currency, BigDecimal net) {
}
