package az.ideanest.shared.observability;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The masking rules, category by category.
 *
 * <p>Every assertion also requires {@link #MARKER} to survive. Without that a
 * rule that deleted the whole line — or a test whose input never reached the
 * masker at all — would pass while proving nothing: "the address is absent" is
 * true of an empty string.
 */
class RedactionTests {

    /** Present in every input, and expected in every output. */
    private static final String MARKER = "pledge-drafted";

    private static String redact(String text) {
        String output = Redaction.redact(text);
        // The vacuity guard, stated once. A masker that returned "" would pass
        // every doesNotContain assertion below.
        assertThat(output)
                .withFailMessage("The line did not survive redaction, so nothing below proves anything: %s", output)
                .contains(MARKER);
        return output;
    }

    @Test
    @DisplayName("an email address is masked")
    void masksEmailAddresses() {
        String output = redact(MARKER + " backer=nurlan.aliyev+tag@example.com");

        assertThat(output).doesNotContain("nurlan.aliyev", "example.com").contains(Redaction.MASK);
    }

    @Test
    @DisplayName("a phone number is masked, international and local")
    void masksPhoneNumbers() {
        assertThat(redact(MARKER + " called +994 50 123 45 67 back")).doesNotContain("994", "123 45 67");
        assertThat(redact(MARKER + " called 0501234567 back")).doesNotContain("0501234567");
    }

    @Test
    @DisplayName("a full name is masked")
    void masksFullNames() {
        assertThat(redact("{\"message\":\"" + MARKER + "\",\"name\":\"Nurlan Aliyev\"}"))
                .doesNotContain("Nurlan", "Aliyev");
        assertThat(redact(MARKER + " User[fullName=Nurlan Aliyev, id=7]")).doesNotContain("Nurlan", "Aliyev");
    }

    @Test
    @DisplayName("a postal address is masked")
    void masksPostalAddresses() {
        String output = redact(MARKER + " Shipping[addressLine1=28 May kucesi 14, city=Baku, postalCode=AZ1010]");

        assertThat(output).doesNotContain("28 May kucesi 14", "Baku", "AZ1010");
    }

    @Test
    @DisplayName("a card number is masked, grouped or not, and so is anything in a card field")
    void masksCardNumbers() {
        assertThat(redact(MARKER + " pan 4111111111111111 declined")).doesNotContain("4111111111111111");
        assertThat(redact(MARKER + " pan 4111 1111 1111 1111 declined")).doesNotContain("4111 1111 1111 1111");
        assertThat(redact("{\"message\":\"" + MARKER + "\",\"cardNumber\":\"not-a-real-pan\",\"cvv\":\"123\"}"))
                .doesNotContain("not-a-real-pan");
        assertThat(redact(MARKER + " iban=AZ21NABZ00000000137010001944")).doesNotContain("NABZ00000000137010001944");
    }

    @Test
    @DisplayName("a bearer token is masked")
    void masksBearerTokens() {
        String jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI3In0.c2lnbmF0dXJl";
        String output = redact(MARKER + " Authorization: Bearer " + jwt);

        assertThat(output).doesNotContain(jwt).contains("Bearer");
    }

    @Test
    @DisplayName("a session token and a refresh token are masked")
    void masksSessionAndRefreshTokens() {
        String output = redact(MARKER + " refreshToken=Zm9vYmFyYmF6cXV1eA, sessionId=8f3c1d2e4b5a6978");

        assertThat(output).doesNotContain("Zm9vYmFyYmF6cXV1eA", "8f3c1d2e4b5a6978");
    }

    @Test
    @DisplayName("a password field is masked whatever it is called")
    void masksPasswordFields() {
        String output = redact(MARKER + " SignInRequest[email=a@b.example, password=correct horse battery]");

        assertThat(output).doesNotContain("correct horse battery");
        assertThat(redact("{\"message\":\"" + MARKER + "\",\"currentPassword\":\"hunter2\"}"))
                .doesNotContain("hunter2");
    }

    @Test
    @DisplayName("a two-factor secret, a code, and an enrolment URI are masked")
    void masksSecondFactorMaterial() {
        assertThat(redact(MARKER + " twoFactorSecret=JBSWY3DPEHPK3PXP")).doesNotContain("JBSWY3DPEHPK3PXP");
        assertThat(redact(MARKER + " code=418025")).doesNotContain("418025");
        assertThat(redact(MARKER + " recoveryCodes=[abcd-efgh, ijkl-mnop]")).doesNotContain("abcd-efgh");
        assertThat(redact(MARKER + " otpauth://totp/IdeyaNest:a@b.example?secret=JBSWY3DPEHPK3PXP"))
                .doesNotContain("JBSWY3DPEHPK3PXP");
    }

    @Test
    @DisplayName("a value nested inside an object is masked, not only a top-level field")
    void masksValuesInsideNestedObjects() {
        String output = redact("{\"message\":\"" + MARKER
                + " DraftPledge[backer=User[email=nurlan@example.com, name=Nurlan Aliyev],"
                + " shipping=Address[city=Baku]], amount=50.00\"}");

        assertThat(output).doesNotContain("nurlan@example.com", "Nurlan Aliyev", "Baku");
    }

    @Test
    @DisplayName("what a log line is for is left alone")
    void leavesNonPersonalDataAlone() {
        String line = "2026-08-17T10:22:31.123+04:00  INFO 12345 --- [io-8080-exec-1] "
                + "a.i.p.a.PledgeService : " + MARKER + " requestId=0192f0c1-8f3a-7c2b-9d4e-1a2b3c4d5e6f "
                + "traceId=0192f0c18f3a7c2b9d4e1a2b3c4d5e6f timestamp=1763372551123 "
                + "pledgeId=0192f0c1-8f3a-7c2b-9d4e-aabbccddeeff amount=50.00 currency=AZN "
                + "shippingCountry=AZ tokenDelivery=body errorCode=PLEDGE_NOT_DRAFT state=DRAFT";

        assertThat(redact(line)).isEqualTo(line);
    }

    @Test
    @DisplayName("a null or empty line is not a crash")
    void toleratesNothingToMask() {
        assertThat(Redaction.redact(null)).isNull();
        assertThat(Redaction.redact("")).isEmpty();
    }
}
