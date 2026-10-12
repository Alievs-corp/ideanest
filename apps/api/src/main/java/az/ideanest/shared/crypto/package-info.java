/**
 * Field-level encryption with application-managed keys — §17.4.
 *
 * <p>{@link az.ideanest.shared.crypto.FieldCipher} is the one route between a readable
 * field and a stored one; {@link az.ideanest.shared.crypto.Keyring} is the keys one kind
 * of field is sealed under. Shared because the data crosses modules: a creator's IBAN is
 * recorded by compliance and read by payout.
 */
package az.ideanest.shared.crypto;
