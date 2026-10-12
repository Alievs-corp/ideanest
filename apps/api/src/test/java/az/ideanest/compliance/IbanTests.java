package az.ideanest.compliance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.compliance.domain.Iban;
import az.ideanest.compliance.domain.MalformedIbanException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The checks an IBAN passes before the platform will pay into it — issue #394.
 *
 * <p>A plain unit test: {@link Iban} is a pure function of a string, and the cases worth
 * having are the ones a creator produces by typing — a wrong character, a missing group, the
 * number copied with spaces or in lower case, an account abroad.
 */
@DisplayName("An IBAN")
class IbanTests {

    /** The SWIFT registry's own Azerbaijani example. */
    private static final String AZERBAIJANI = "AZ21NABZ00000000137010001944";

    @Test
    @DisplayName("a valid Azerbaijani IBAN is accepted, and masked to its country, check digits and last four")
    void aValidAzerbaijaniIbanIsAccepted() {
        Iban iban = Iban.parseAzerbaijani(AZERBAIJANI);

        assertThat(iban.value()).isEqualTo(AZERBAIJANI);
        assertThat(iban.country()).isEqualTo("AZ");
        assertThat(iban.displayHint()).isEqualTo("AZ21…1944").hasSizeLessThanOrEqualTo(12);
        // Logged by accident, it says what the settings screen already shows.
        assertThat(iban.toString()).doesNotContain(AZERBAIJANI).contains("AZ21…1944");
    }

    @Test
    @DisplayName("spaces and lower case are normalised away, so one account is one value")
    void printedFormIsNormalised() {
        Iban printed = Iban.parseAzerbaijani("az21 nabz 0000 0000 1370 1000 1944");
        Iban tabbed = Iban.parseAzerbaijani("  AZ21\tNABZ 0000000013701000 1944 ");

        assertThat(printed.value()).isEqualTo(AZERBAIJANI);
        assertThat(tabbed).isEqualTo(printed);
    }

    @Test
    @DisplayName("one mistyped character fails the check digits")
    void aWrongChecksumIsRefused() {
        assertThatThrownBy(() -> Iban.parseAzerbaijani("AZ21NABZ00000000137010001945"))
                .isInstanceOf(MalformedIbanException.class)
                .satisfies(thrown -> assertThat(((MalformedIbanException) thrown).defect())
                        .isEqualTo(Iban.Defect.CHECKSUM));
    }

    @Test
    @DisplayName("two swapped characters fail the check digits")
    void aTranspositionIsRefused() {
        assertThat(defectOf("AZ21NABZ00000000137010009144")).isEqualTo(Iban.Defect.CHECKSUM);
    }

    @ParameterizedTest
    @DisplayName("a number that is not twenty-eight characters is refused as the wrong length")
    @ValueSource(strings = {"AZ21NABZ0000000013701000194", "AZ21NABZ000000001370100019440", "AZ21"})
    void aWrongLengthIsRefused(String typed) {
        assertThat(defectOf(typed)).isEqualTo(Iban.Defect.LENGTH);
    }

    @Test
    @DisplayName("the right length with digits where the bank code goes is refused as the wrong format")
    void aWrongStructureIsRefused() {
        assertThat(defectOf("AZ2112340000000013701000194X")).isEqualTo(Iban.Defect.FORMAT);
    }

    @ParameterizedTest
    @DisplayName("anything but letters and digits is refused, and nothing is refused for being empty")
    @ValueSource(strings = {"AZ21-NABZ-0000-0000-1370-1000-1944", "AZ21NABZ0000000013701000194!", ""})
    void otherCharactersAreRefused(String typed) {
        assertThat(defectOf(typed)).isIn(Iban.Defect.CHARACTERS, Iban.Defect.LENGTH);
    }

    @Test
    @DisplayName("an unknown country is refused as a country rather than a length")
    void anUnknownCountryIsRefused() {
        assertThat(defectOf("ZZ21NABZ00000000137010001944")).isEqualTo(Iban.Defect.COUNTRY);
    }

    @Test
    @DisplayName("a valid foreign IBAN is an IBAN, and is not one a creator is paid to")
    void aForeignIbanIsRefusedForACreator() {
        // Valid everywhere: a refund past the provider's window may go abroad (#399).
        assertThat(Iban.parse("GB82 WEST 1234 5698 7654 32").value()).isEqualTo("GB82WEST12345698765432");
        assertThat(Iban.parse("DE89370400440532013000").country()).isEqualTo("DE");

        // A creator is paid from an Azerbaijani account in manat, to an Azerbaijani one.
        assertThatThrownBy(() -> Iban.parseAzerbaijani("GB82WEST12345698765432"))
                .isInstanceOf(MalformedIbanException.class)
                .satisfies(thrown -> assertThat(((MalformedIbanException) thrown).defect())
                        .isEqualTo(Iban.Defect.COUNTRY_NOT_ACCEPTED));
    }

    @Test
    @DisplayName("a refusal never repeats the number it refused")
    void aRefusalDoesNotCarryTheNumber() {
        assertThatThrownBy(() -> Iban.parseAzerbaijani("AZ21NABZ00000000137010001945"))
                .hasMessageNotContaining("NABZ00000000137010001945");
    }

    private static Iban.Defect defectOf(String typed) {
        try {
            Iban.parseAzerbaijani(typed);
        } catch (MalformedIbanException refused) {
            return refused.defect();
        }
        throw new AssertionError("Accepted: " + typed);
    }
}
