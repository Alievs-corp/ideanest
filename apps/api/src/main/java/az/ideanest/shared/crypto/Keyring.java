package az.ideanest.shared.crypto;

import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The keys one kind of encrypted field is sealed under — §17.4.
 *
 * <h2>There is no default key, and that is the design</h2>
 *
 * <p>A generated one would change on every deploy and make every stored value
 * unreadable, discovered by whoever next needs one. A constant committed to this
 * repository would be a published key, which is not encryption. So an unconfigured
 * keyring binds, the deployment starts and serves every other endpoint, and the first
 * write that needs this keyring is refused with a 503 naming the property —
 * {@code PledgeManagerProperties.Addresses} argues why that is better than failing to
 * start, and this record is that argument made once for every keyring.
 *
 * <h2>Generating a key</h2>
 *
 * <p>Thirty-two random bytes, base64: {@code openssl rand -base64 32}. The label is
 * free-form within {@link #KEY_ID}'s shape, but in a deployment it should be letters and
 * digits only, such as {@code b1} then {@code b2}: the keys are bound from environment
 * variables, where Spring reads {@code -} and {@code _} in the name as separators, so a
 * label such as {@code 2026-10} is bound under a different name and never found.
 *
 * @param primaryKeyId which key new values are sealed under. Rotation is: add the new
 *     key to {@code keys}, deploy, then move this label — so that every instance can read
 *     the new key before any instance writes under it
 * @param keys label to base64 key material, 32 bytes each for AES-256. Old keys stay
 *     after a rotation so that rows sealed under them remain readable; a row re-saved is
 *     re-sealed under the primary, which makes rotation a migration rather than a rewrite
 */
public record Keyring(String primaryKeyId, Map<String, String> keys) {

    /** AES-256. A shorter key is a configuration mistake rather than a weaker choice. */
    public static final int KEY_BYTES = 32;

    /** The shape every encrypted table's {@code key_id} check constraint holds a label to (V36). */
    public static final Pattern KEY_ID = Pattern.compile("^[a-z0-9][a-z0-9._-]{0,62}$");

    public static Keyring unconfigured() {
        return new Keyring(null, Map.of());
    }

    public Keyring {
        keys = keys == null ? Map.of() : Map.copyOf(keys);

        // Blank is unconfigured, not a label. A placeholder resolving to an empty string
        // is what an environment that has not set the variable produces, and treating it
        // as a name would refuse to start over an absence this record tolerates.
        if (primaryKeyId != null && primaryKeyId.isBlank()) {
            primaryKeyId = null;
        }
        if (primaryKeyId != null) {
            primaryKeyId = primaryKeyId.trim().toLowerCase(Locale.ROOT);
            if (!KEY_ID.matcher(primaryKeyId).matches()) {
                throw new IllegalArgumentException(
                        "A key label is lowercase letters, digits, dot, dash or underscore");
            }
            if (!keys.containsKey(primaryKeyId)) {
                // Caught at start-up rather than on the first write, because this one
                // *is* a mistake rather than an absence: a deployment that named a
                // primary key meant to configure the keyring, and every write would fail.
                throw new IllegalArgumentException(
                        "The primary key '" + primaryKeyId + "' is not among the configured keys");
            }
        }
        for (Map.Entry<String, String> entry : keys.entrySet()) {
            if (!KEY_ID.matcher(entry.getKey()).matches()) {
                throw new IllegalArgumentException(
                        "A key label is lowercase letters, digits, dot, dash or underscore");
            }
            if (decode(entry.getKey(), entry.getValue()).length != KEY_BYTES) {
                throw new IllegalArgumentException(
                        "The key '" + entry.getKey() + "' is not " + KEY_BYTES + " bytes of base64");
            }
        }
    }

    /** Whether anything can be sealed under this keyring. */
    public boolean isConfigured() {
        return primaryKeyId != null;
    }

    /**
     * The key material, decoded.
     *
     * <p>A fresh map each call rather than a cached field, so that the arrays a caller
     * holds are its own. A cipher asks for this once at construction.
     */
    public Map<String, byte[]> decodedKeys() {
        Map<String, byte[]> decoded = new LinkedHashMap<>();
        keys.forEach((label, material) -> decoded.put(label, decode(label, material)));
        return Map.copyOf(decoded);
    }

    @Override
    public String toString() {
        // Labels only. The default record rendering would print the key material into
        // any log line or binding failure that renders this record.
        return "Keyring[primary=" + primaryKeyId + ", keys=" + keys.keySet() + "]";
    }

    private static byte[] decode(String label, String material) {
        try {
            return Base64.getDecoder().decode(material == null ? "" : material.trim());
        } catch (IllegalArgumentException e) {
            // The message names the label and never the material.
            throw new IllegalArgumentException("The key '" + label + "' is not valid base64");
        }
    }
}
