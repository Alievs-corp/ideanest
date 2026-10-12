package az.ideanest.compliance.domain;

import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * An International Bank Account Number, checked as far as it can be checked without a bank —
 * ISO 13616, issue #394.
 *
 * <p>Three checks, in the order a person can act on them: the characters (letters and digits
 * once spaces are removed), the length the country registers, and the mod-97 check digits. The
 * last catches every single mistyped character and nearly every swap of two, which is the
 * mistake that would otherwise send a creator's money to a stranger's account or bounce it
 * back weeks later. None of the three says the account exists or whose it is; that is what
 * verification is for.
 *
 * <p><strong>Normalised on the way in</strong>: spaces removed and letters upper-cased, because
 * IBANs are printed in groups of four and copied from banking apps in either case. The stored
 * and compared value is the electronic form, so {@code az21 nabz …} and {@code AZ21NABZ…} are
 * one account rather than two.
 *
 * <p>{@link #toString()} is the masked hint, never the number, so an {@code Iban} that reaches a
 * log line by accident discloses what the settings screen already shows.
 */
public final class Iban {

    /** What is wrong with a candidate, from a closed set the client translates. */
    public enum Defect {
        /** Something other than letters and digits after removing spaces. */
        CHARACTERS,
        /** The first two letters are not a country that issues IBANs. */
        COUNTRY,
        /** Not the length that country's IBANs have. */
        LENGTH,
        /** The right length, but not the structure that country's IBANs have. */
        FORMAT,
        /** The check digits do not agree with the rest: a mistyped or transposed character. */
        CHECKSUM,
        /** A valid IBAN, from a country the platform does not pay creators in. */
        COUNTRY_NOT_ACCEPTED
    }

    /** Azerbaijan, the only country a creator is paid in. */
    public static final String AZERBAIJAN = "AZ";

    /**
     * Azerbaijan's IBAN: {@code AZ}, two check digits, a four-letter bank code, and twenty
     * letters or digits for the account. Twenty-eight characters in all.
     */
    private static final Pattern AZERBAIJANI = Pattern.compile("^AZ[0-9]{2}[A-Z]{4}[A-Z0-9]{20}$");

    /** Letters and digits only: the alphabet of an IBAN once its spaces are gone. */
    private static final Pattern ALPHANUMERIC = Pattern.compile("^[A-Z0-9]*$");

    /** A country, two check digits, then the account. Anything else has no country to look up. */
    private static final Pattern SHAPE = Pattern.compile("^[A-Z]{2}[0-9]{2}[A-Z0-9]+$");

    private static final Pattern WHITESPACE = Pattern.compile("[\\s\\u00A0]+");

    /**
     * The length each country's IBANs have, from the SWIFT IBAN registry.
     *
     * <p>Every country that issues them rather than only Azerbaijan, because a refund past the
     * provider's window goes to whichever account the backer names (#399), and a backer may bank
     * anywhere. A country missing from here is refused as {@link Defect#COUNTRY}: adding one is a
     * line, and refusing an unknown country is safer than accepting any length.
     */
    private static final Map<String, Integer> LENGTHS = Map.ofEntries(
            Map.entry("AD", 24), Map.entry("AE", 23), Map.entry("AL", 28), Map.entry("AT", 20),
            Map.entry("AZ", 28), Map.entry("BA", 20), Map.entry("BE", 16), Map.entry("BG", 22),
            Map.entry("BH", 22), Map.entry("BI", 27), Map.entry("BR", 29), Map.entry("BY", 28),
            Map.entry("CH", 21), Map.entry("CR", 22), Map.entry("CY", 28), Map.entry("CZ", 24),
            Map.entry("DE", 22), Map.entry("DJ", 27), Map.entry("DK", 18), Map.entry("DO", 28),
            Map.entry("EE", 20), Map.entry("EG", 29), Map.entry("ES", 24), Map.entry("FI", 18),
            Map.entry("FK", 18), Map.entry("FO", 18), Map.entry("FR", 27), Map.entry("GB", 22),
            Map.entry("GE", 22), Map.entry("GI", 23), Map.entry("GL", 18), Map.entry("GR", 27),
            Map.entry("GT", 28), Map.entry("HN", 28), Map.entry("HR", 21), Map.entry("HU", 28),
            Map.entry("IE", 22), Map.entry("IL", 23), Map.entry("IQ", 23), Map.entry("IS", 26),
            Map.entry("IT", 27), Map.entry("JO", 30), Map.entry("KW", 30), Map.entry("KZ", 20),
            Map.entry("LB", 28), Map.entry("LC", 32), Map.entry("LI", 21), Map.entry("LT", 20),
            Map.entry("LU", 20), Map.entry("LV", 21), Map.entry("LY", 25), Map.entry("MC", 27),
            Map.entry("MD", 24), Map.entry("ME", 22), Map.entry("MK", 19), Map.entry("MN", 20),
            Map.entry("MR", 27), Map.entry("MT", 31), Map.entry("MU", 30), Map.entry("NI", 28),
            Map.entry("NL", 18), Map.entry("NO", 15), Map.entry("OM", 23), Map.entry("PK", 24),
            Map.entry("PL", 28), Map.entry("PS", 29), Map.entry("PT", 25), Map.entry("QA", 29),
            Map.entry("RO", 24), Map.entry("RS", 22), Map.entry("RU", 33), Map.entry("SA", 24),
            Map.entry("SC", 31), Map.entry("SD", 18), Map.entry("SE", 24), Map.entry("SI", 19),
            Map.entry("SK", 24), Map.entry("SM", 27), Map.entry("SO", 23), Map.entry("ST", 25),
            Map.entry("SV", 28), Map.entry("TL", 23), Map.entry("TN", 24), Map.entry("TR", 26),
            Map.entry("UA", 29), Map.entry("VA", 22), Map.entry("VG", 24), Map.entry("XK", 20),
            Map.entry("YE", 30));

    private final String value;

    private Iban(String value) {
        this.value = value;
    }

    /**
     * Any country's IBAN, normalised and checked.
     *
     * @throws MalformedIbanException with the first {@link Defect} found
     */
    public static Iban parse(String typed) {
        String candidate = normalise(typed);
        if (!ALPHANUMERIC.matcher(candidate).matches()) {
            throw new MalformedIbanException(Defect.CHARACTERS);
        }
        if (!SHAPE.matcher(candidate).matches()) {
            // Letters and digits, but too short to have a country and check digits, or with
            // them in the wrong places. Either way the length is what a person fixes.
            throw new MalformedIbanException(candidate.length() < 5 ? Defect.LENGTH : Defect.FORMAT);
        }
        Integer length = LENGTHS.get(candidate.substring(0, 2));
        if (length == null) {
            throw new MalformedIbanException(Defect.COUNTRY);
        }
        if (candidate.length() != length) {
            throw new MalformedIbanException(Defect.LENGTH);
        }
        if (AZERBAIJAN.equals(candidate.substring(0, 2)) && !AZERBAIJANI.matcher(candidate).matches()) {
            throw new MalformedIbanException(Defect.FORMAT);
        }
        if (mod97(candidate) != 1) {
            throw new MalformedIbanException(Defect.CHECKSUM);
        }
        return new Iban(candidate);
    }

    /**
     * An Azerbaijani IBAN, which is the only kind a creator is paid to.
     *
     * <p>The other checks first, so that a mistyped Azerbaijani number is reported as mistyped
     * rather than as foreign.
     *
     * @throws MalformedIbanException with {@link Defect#COUNTRY_NOT_ACCEPTED} for a valid IBAN
     *     from anywhere else
     */
    public static Iban parseAzerbaijani(String typed) {
        Iban iban = parse(typed);
        if (!AZERBAIJAN.equals(iban.country())) {
            throw new MalformedIbanException(Defect.COUNTRY_NOT_ACCEPTED);
        }
        return iban;
    }

    /** The electronic form: upper case, no spaces. The value that is sealed and fingerprinted. */
    public String value() {
        return value;
    }

    /** The two-letter country code. */
    public String country() {
        return value.substring(0, 2);
    }

    /**
     * How a person recognises the account without being shown it: country, check digits, an
     * ellipsis and the last four, such as {@code AZ21…1944}. Nine characters, inside V72's
     * twelve-character ceiling on a hint, and too few to be an account number.
     */
    public String displayHint() {
        return value.substring(0, 4) + "…" + value.substring(value.length() - 4);
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Iban that && value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return value.hashCode();
    }

    @Override
    public String toString() {
        return "Iban[" + displayHint() + "]";
    }

    private static String normalise(String typed) {
        if (typed == null) {
            return "";
        }
        return WHITESPACE.matcher(typed).replaceAll("").toUpperCase(Locale.ROOT);
    }

    /**
     * ISO 7064 mod 97-10 over the rearranged number: the first four characters moved to the
     * end, each letter replaced by two digits (A is 10, Z is 35). Folded a character at a time,
     * so the thirty-odd-digit number is never built.
     */
    private static int mod97(String iban) {
        String rearranged = iban.substring(4) + iban.substring(0, 4);
        int remainder = 0;
        for (int index = 0; index < rearranged.length(); index++) {
            char c = rearranged.charAt(index);
            if (c >= '0' && c <= '9') {
                remainder = (remainder * 10 + (c - '0')) % 97;
            } else {
                remainder = (remainder * 100 + (c - 'A' + 10)) % 97;
            }
        }
        return remainder;
    }
}
