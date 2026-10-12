package az.ideanest.shared.observability;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What may never be written to a log, removed from a line that was about to be.
 *
 * <p>§17.4: "Personal data in logs — redacted: email, phone, address, card,
 * token, password". This is that rule as code, and it is applied by
 * {@link RedactingEncoder} to the bytes an appender was going to emit rather
 * than by each call site. That choice is the whole design: a rule that depends
 * on every {@code log.info} remembering it is a rule that holds until the first
 * afternoon somebody logs a request object to find out what is in it.
 *
 * <p><strong>Over-masking is the safe direction.</strong> Where a value's
 * boundary is ambiguous — free text after {@code name=}, say — the rules take
 * more rather than less. A line that says less than it could is a debugging
 * inconvenience; a line that names a backer and their address is a breach.
 *
 * <p>Two kinds of rule, because personal data arrives in two shapes.
 *
 * <p><strong>By field name.</strong> {@code password=…}, {@code "city":"…"},
 * {@code recoveryCodes=[…]}. The name is the evidence, and this is what catches
 * a full name or a street — neither of which has a pattern to match. The names
 * are the ones this codebase actually uses: {@code auth.api}'s requests,
 * {@code pledge}'s shipping fields, {@code user.domain.User}.
 *
 * <p><strong>By shape.</strong> An address, a card, a phone number, and a JWT
 * are recognisable wherever they appear — including inside an object's
 * {@code toString}, an exception message, or a stack trace, which is exactly
 * where the field-name rules cannot reach.
 *
 * <p>What is deliberately <em>not</em> masked: the correlation identifiers,
 * amounts, currencies, states, and the account identifier. §18.1 requires them
 * on every line, and a pseudonymous UUID is what makes a log joinable without
 * naming anybody. The card rules are keyed on issuer prefix and Luhn precisely
 * so that a thirteen-digit epoch timestamp is not mistaken for a card.
 */
public final class Redaction {

    /** What replaces anything this class removes. Contains no JSON metacharacter. */
    public static final String MASK = "<redacted>";

    private Redaction() {
    }

    /**
     * Field names whose value is personal data, a credential, or both.
     *
     * <p>Matched with a word boundary on each side, which is what keeps
     * {@code loggerName}, {@code threadName}, {@code errorCode},
     * {@code shippingCountry}, {@code tokenDelivery} and {@code idempotencyKey}
     * readable — all of them contain a listed name and none of them carries one.
     *
     * <p>{@code authorization} is absent on purpose: the {@code Bearer} rule
     * below masks the credential and leaves the scheme visible, which says more
     * than masking the whole header would.
     */
    private static final List<String> SENSITIVE_FIELDS = List.of(
            // Credentials.
            "passwordConfirmation",
            "currentPassword",
            "newPassword",
            "passwordHash",
            "password",
            "passwd",
            "pwd",
            // Secrets and keys.
            "twoFactorSecret",
            "clientSecret",
            "totpSecret",
            "secret",
            "privateKeyPem",
            "privateKey",
            "apiKey",
            "api_key",
            // Session material. §17.2's refresh token, §17.3's session.
            "refreshToken",
            "refresh_token",
            "accessToken",
            "access_token",
            "bearerToken",
            "idToken",
            "id_token",
            "sessionToken",
            "sessionId",
            "session_id",
            "token",
            "challenge",
            // Second factor. §3.4's enrolment, codes, and recovery codes.
            "otpauthUri",
            "otpauth",
            "recoveryCodes",
            "recoveryCode",
            "verificationCode",
            "twoFactorCode",
            "securityCode",
            "codes",
            "code",
            "totp",
            "otp",
            // Contact details.
            "emailAddress",
            "email",
            "mail",
            "phoneNumber",
            "phone",
            "mobile",
            "msisdn",
            // Who somebody is.
            "displayName",
            "fullName",
            "firstName",
            "lastName",
            "givenName",
            "familyName",
            "recipientName",
            "recipient",
            "userName",
            "username",
            "name",
            "bio",
            // Where they are. §17.4 encrypts shipping addresses at rest; a log is
            // not encrypted at all.
            "shippingAddress",
            "deliveryAddress",
            "billingAddress",
            "addressLine1",
            "addressLine2",
            "streetAddress",
            "address",
            "street",
            "line1",
            "line2",
            "city",
            "postalCode",
            "postcode",
            "zipCode",
            "zip",
            // An address is personal data too, and §17.4 nulls it on
            // anonymisation. It must not outlive the row in a log line.
            "ipAddress",
            "remoteAddr",
            "clientIp",
            "forwardedFor",
            // Instruments. Card data never reaches this service (§17.2, SAQ A),
            // which is a reason to prove it rather than to assume it.
            "cardholderName",
            "cardNumber",
            "card",
            "pan",
            "cvv",
            "cvc",
            "expiry",
            "iban",
            "accountNumber",
            "bankAccount",
            "routingNumber",
            "sortCode");

    private static final String FIELD_NAMES = String.join("|", SENSITIVE_FIELDS);

    /**
     * A sensitive field name, followed immediately by its separator.
     *
     * <p>No whitespace is permitted before the {@code :} or {@code =}, and that
     * is load-bearing rather than an oversight. The console pattern renders
     * {@code …RecoveryCode : message}, and a rule that allowed a space there
     * would mask every line logged by a class whose name happens to end in one
     * of these words.
     */
    private static final String FIELD_AND_SEPARATOR =
            "(?<![A-Za-z0-9_])(?:" + FIELD_NAMES + ")(?![A-Za-z0-9_])\\\\?\"?[:=]\\s*";

    private static final Pattern SENSITIVE_FIELD_NAME = Pattern.compile("(?i)(?:" + FIELD_NAMES + ")");

    private record Rule(Pattern pattern, String replacement) {
    }

    private static final List<Rule> RULES = List.of(
            // The enrolment URI carries the shared secret in a query parameter, so
            // the whole of it goes. First, before anything can mask only part.
            new Rule(Pattern.compile("(?i)otpauth://[^\\s\"',)\\]}]+"), MASK),
            // The credential goes; the scheme stays, because "a bearer token was
            // rejected" and "a basic credential was rejected" are different bugs.
            new Rule(Pattern.compile("(?i)\\b(bearer|basic)\\s+[A-Za-z0-9._~+/=-]{8,}"), "$1 " + MASK),
            // A JWT anywhere, named or not. Every JWT header is JSON, so every
            // JWT starts with the base64 of "{\"".
            new Rule(Pattern.compile("\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]*"), MASK),
            // A sensitive field with a quoted value: JSON, and anything that
            // renders like it.
            new Rule(
                    Pattern.compile("(?i)(" + FIELD_AND_SEPARATOR + ")\"(?:\\\\.|[^\"\\\\])*\""),
                    "$1\"" + MASK + "\""),
            // A sensitive field with a bare value: a record's toString, a
            // key=value message, an unquoted JSON literal. Everything up to the
            // next delimiter goes, which is how a name or a street with spaces in
            // it is caught.
            new Rule(
                    Pattern.compile("(?i)(" + FIELD_AND_SEPARATOR + ")(?!\")[^,;\\]})\\r\\n]*"),
                    "$1" + MASK),
            // A bank account, wherever it appears. §17.4 encrypts these and shows
            // four digits; a log shows none.
            new Rule(Pattern.compile("\\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\\b"), MASK),
            // The same, printed in groups of four as banks and statements print it
            // (#394). The rule above stops at the first space and would leave the
            // account number after it. Two whole groups at least, which every IBAN
            // has -- the shortest is fifteen characters.
            new Rule(Pattern.compile("\\b[A-Z]{2}[0-9]{2}(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,3})?\\b"), MASK),
            new Rule(Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}"), MASK),
            // International, and requiring the literal +. Without it the rule
            // would also match an ISO timestamp, which is on every line.
            new Rule(Pattern.compile("(?<![\\w+])\\+\\d[\\d\\s().-]{7,17}\\d(?![\\w])"), MASK),
            // Local, in the shape Azerbaijani mobile numbers are written in.
            new Rule(
                    Pattern.compile("(?<![\\w+])0\\d{2}[\\s.-]?\\d{3}[\\s.-]?\\d{2}[\\s.-]?\\d{2}(?![\\w])"), MASK));

    /**
     * Digits, twelve to nineteen of them, single spaces or hyphens allowed
     * between. A candidate only — {@link #cardLike(String)} decides.
     */
    private static final Pattern CARD_CANDIDATE = Pattern.compile("(?<![0-9])[0-9](?:[ -]?[0-9]){11,18}(?![0-9])");

    /** Masks everything §17.4 forbids. Null and empty input are returned as they are. */
    public static String redact(String text) {
        if (text == null || text.isEmpty()) {
            return text;
        }
        String output = text;
        for (Rule rule : RULES) {
            output = rule.pattern().matcher(output).replaceAll(rule.replacement());
        }
        return maskCardNumbers(output);
    }

    /**
     * Whether a value under this name would be masked anyway.
     *
     * <p>{@link LogFields} uses it to refuse the field at the call site instead,
     * because a field that is always masked is a field somebody will eventually
     * work around.
     */
    public static boolean isSensitiveFieldName(String field) {
        return field != null && SENSITIVE_FIELD_NAME.matcher(field).matches();
    }

    private static String maskCardNumbers(String text) {
        Matcher matcher = CARD_CANDIDATE.matcher(text);
        StringBuilder output = null;
        int copied = 0;
        while (matcher.find()) {
            String digits = matcher.group().replace(" ", "").replace("-", "");
            if (!cardLike(digits)) {
                continue;
            }
            if (output == null) {
                output = new StringBuilder(text.length());
            }
            output.append(text, copied, matcher.start()).append(MASK);
            copied = matcher.end();
        }
        if (output == null) {
            return text;
        }
        return output.append(text, copied, text.length()).toString();
    }

    /**
     * A card number, on the two tests a card number always passes: an issuer
     * prefix at a length that issuer uses, and Luhn.
     *
     * <p>Both, rather than "thirteen or more digits". A log line carries an epoch
     * timestamp of thirteen digits and a trace identifier of thirty-two hex
     * characters, and masking either would break the thing this package exists
     * to provide. Every real primary account number satisfies both tests, so
     * nothing is lost by asking.
     */
    private static boolean cardLike(String digits) {
        return hasIssuerPrefix(digits) && passesLuhn(digits);
    }

    private static boolean hasIssuerPrefix(String digits) {
        int length = digits.length();
        int two = Integer.parseInt(digits.substring(0, 2));
        return switch (digits.charAt(0)) {
            // Visa.
            case '4' -> length == 13 || length == 16 || length == 19;
            // Mastercard, including the 2221-2720 range.
            case '5' -> length == 16 && two >= 51 && two <= 55;
            case '2' -> length == 16 && Integer.parseInt(digits.substring(0, 4)) >= 2221
                    && Integer.parseInt(digits.substring(0, 4)) <= 2720;
            // American Express, and JCB.
            case '3' -> (length == 15 && (two == 34 || two == 37)) || (length == 16 && two == 35);
            // Discover, and UnionPay — the network AZ-issued cards most often
            // co-brand with.
            case '6' -> (length == 16 && (digits.startsWith("6011") || two == 65))
                    || (two == 62 && length >= 16 && length <= 19);
            default -> false;
        };
    }

    private static boolean passesLuhn(String digits) {
        int sum = 0;
        boolean doubling = false;
        for (int index = digits.length() - 1; index >= 0; index--) {
            int digit = digits.charAt(index) - '0';
            if (doubling) {
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }
            sum += digit;
            doubling = !doubling;
        }
        return sum % 10 == 0;
    }
}
