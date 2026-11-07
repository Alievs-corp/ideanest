package az.ideanest.analytics.domain;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Who an audience event is counted as — #633.
 *
 * <p><strong>{@code HMAC-SHA256(day salt, address "|" user agent)}</strong>, and nothing
 * else. No cookie, no device identifier, no account: the owner's decision of 2026-11-07
 * was to count people without asking anybody for consent, which rules out storing
 * anything on the reader's device and rules out keeping their address.
 *
 * <p><strong>The salt is what makes this an aggregate rather than a tracker.</strong> It
 * is random, one per Baku day, and deleted once the day and one more have passed
 * (V124). While it exists, the same reader on the same day is the same key, which is
 * what lets a page view and a reload count one person. Once it is gone, nobody — not the
 * platform, not somebody holding a copy of the database — can tell whether a key in an
 * old marker belonged to a given address: the hash is keyed, and the key no longer
 * exists. And a reader is a different key every day, so keys cannot be joined across
 * days to follow anybody.
 *
 * <p>The address and user agent are inputs and are never stored, logged, or returned.
 */
public final class VisitorKey {

    /** The HMAC's output and the salt's length: SHA-256's 32 bytes. */
    public static final int LENGTH = 32;

    private static final String ALGORITHM = "HmacSHA256";

    private static final SecureRandom RANDOM = new SecureRandom();

    private VisitorKey() {
    }

    /** A new day's salt: 256 bits of {@link SecureRandom}. */
    public static byte[] newSalt() {
        byte[] salt = new byte[LENGTH];
        RANDOM.nextBytes(salt);
        return salt;
    }

    /**
     * The visitor's key for the day the salt belongs to.
     *
     * @param address the client's address as resolved for this request; never null
     * @param userAgent the {@code User-Agent} header, or empty when there was none
     */
    public static byte[] of(byte[] salt, String address, String userAgent) {
        if (salt == null || salt.length != LENGTH) {
            throw new IllegalArgumentException("A day salt is " + LENGTH + " bytes");
        }
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(salt, ALGORITHM));
            return mac.doFinal((address + "|" + (userAgent == null ? "" : userAgent)).getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException exception) {
            // HmacSHA256 is one of the algorithms every Java platform must provide.
            throw new IllegalStateException("HmacSHA256 is unavailable", exception);
        }
    }
}
