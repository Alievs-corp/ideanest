package az.ideanest.shared;

/**
 * Whether a link a person typed is an https address, the one shape the platform stores.
 *
 * <p>{@code ProfileEditing} drew this line for profile links first, and #587 found a campaign's
 * typed cover address stored verbatim beside it. One rule in one place, because the reason is
 * the same everywhere a typed address is rendered back: a {@code javascript:} or {@code data:}
 * URL in an {@code src} or {@code href} is the same exploit on a campaign page as on a
 * profile, and plain http is mixed content on a page served over https.
 *
 * <p>The shape only. Nothing here fetches the address or asks whether it resolves; the server
 * never fetches these, so the shape is all that can honestly be checked.
 */
public final class HttpsAddresses {

    private static final String HTTPS_PREFIX = "https://";

    private HttpsAddresses() {
    }

    /**
     * Whether this already-trimmed value starts with {@code https://}, has something after it,
     * and holds no whitespace — a space inside a URL is a mistake or an attempt to smuggle a
     * second attribute through a template that forgot to quote.
     */
    public static boolean isHttps(String trimmed) {
        if (trimmed == null || !trimmed.startsWith(HTTPS_PREFIX) || trimmed.length() == HTTPS_PREFIX.length()) {
            return false;
        }
        for (int index = 0; index < trimmed.length(); index++) {
            if (Character.isWhitespace(trimmed.charAt(index))) {
                return false;
            }
        }
        return true;
    }
}
