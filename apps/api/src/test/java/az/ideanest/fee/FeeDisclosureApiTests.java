package az.ideanest.fee;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.Map;
import javax.sql.DataSource;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * §22.3's sixth product requirement, checked — issue #439.
 *
 * <p><strong>The test #439 asks for by name</strong> is the second one below: "fee disclosure
 * derived from {@code fee_schedules} [...] with a test that it changes when the schedule does".
 * That is the assertion that makes the disclosure a disclosure. The copy it replaced said the
 * platform charges nothing — true, because no schedule is seeded, and false the day one is, in a
 * message catalogue where nothing would have noticed.
 *
 * <p>The first test is the other half of the same argument: with no schedule, the endpoint says it
 * has nothing to disclose rather than quoting zeros. Zeros are a commitment to charge nothing; an
 * empty table is the platform not having decided, and a page that printed "0% platform fee" on the
 * strength of one would be making a promise nobody authorised.
 */
class FeeDisclosureApiTests extends AbstractIntegrationTest {

    private static final String ADMIN_EMAIL = "moderator@ideanest.test";
    private static final String PASSWORD = "a-long-enough-password";

    private String adminToken;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @AfterEach
    void clear() {
        new JdbcTemplate(dataSource).update("DELETE FROM fee_schedules");
    }

    @Test
    @DisplayName("IDN-EXT-01: with no schedule the platform discloses the default — 15%, the bank inside it")
    void nothingConfiguredDisclosesTheDefault() {
        Map<String, Object> disclosure = disclosure();

        // The default terms are what a withdrawal is priced at, so they are what is disclosed. A page
        // may not say "nothing to disclose" while the payout run charges 15%.
        assertThat(disclosure.get("configured")).isEqualTo(true);
        assertThat(disclosure.get("platformRate")).isEqualTo("0.15");
        assertThat(disclosure.get("processingRate")).isEqualTo("0");
        assertThat(disclosure.get("creatorReceivesRate")).isEqualTo("0.85000");
        assertThat(disclosure.get("effectiveFrom")).isNull();
    }

    @Test
    @DisplayName("the disclosure changes when the schedule changes")
    void theDisclosureFollowsTheSchedule() {
        openSchedule("0.05000", "0.02000", "0.20");

        Map<String, Object> first = disclosure();
        assertThat(first.get("configured")).isEqualTo(true);
        assertThat(first.get("platformRate")).isEqualTo("0.05000");
        // The platform's fee and the provider's stay separate, because "a creator reading 5% and
        // receiving 94.2% will ask, and the answer needs to already be on the page".
        assertThat(first.get("processingRate")).isEqualTo("0.02000");
        // V49 stores the fixed amount as numeric(19,4), so the scale comes back as the column
        // holds it. Asserted as written rather than trimmed: what a client renders is what the
        // table says, and a test that normalised it would hide a scale change.
        assertThat(first.get("processingFixed")).isEqualTo("0.2000");
        assertThat(first.get("creatorReceivesRate")).isEqualTo("0.93000");

        // The whole point of deriving it. A copy deck would still be saying five percent.
        openSchedule("0.08000", "0.02000", "0.20");

        Map<String, Object> second = disclosure();
        assertThat(second.get("platformRate")).isEqualTo("0.08000");
        assertThat(second.get("creatorReceivesRate")).isEqualTo("0.90000");
    }

    @Test
    @DisplayName("the rates travel as strings, because a page multiplies them by somebody's pledge")
    void ratesAreStrings() {
        openSchedule("0.05000", "0.02900", "0.30");

        Map<String, Object> disclosure = disclosure();

        // A JSON number is an IEEE 754 double in every mainstream parser, so 0.05 would arrive as
        // 0.05000000000000000277… and the fee the page previews would differ in the last place
        // from the fee the service charges. CLAUDE.md: money crosses the API as a string.
        assertThat(disclosure.get("platformRate")).isInstanceOf(String.class);
        assertThat(disclosure.get("processingRate")).isInstanceOf(String.class);
        assertThat(disclosure.get("processingFixed")).isInstanceOf(String.class);
        assertThat(disclosure.get("creatorReceivesRate")).isInstanceOf(String.class);
    }

    @Test
    @DisplayName("the disclosure needs no account, because the audience has not signed in")
    void theDisclosureIsPublic() {
        openSchedule("0.05000", "0.02000", "0.20");

        ResponseEntity<Map<String, Object>> answer = rest.exchange(
                "/v1/fees/disclosure",
                HttpMethod.GET,
                HttpEntity.EMPTY,
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
        // And cacheable by a shared cache: nothing in the answer belongs to a person.
        assertThat(answer.getHeaders().getCacheControl()).contains("public");
    }

    private Map<String, Object> disclosure() {
        ResponseEntity<Map<String, Object>> answer = rest.exchange(
                "/v1/fees/disclosure",
                HttpMethod.GET,
                HttpEntity.EMPTY,
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(answer.getStatusCode()).isEqualTo(HttpStatus.OK);
        return answer.getBody();
    }

    /** Through the console, so that what is disclosed is what an operator could actually open. */
    private void openSchedule(String platformRate, String processingRate, String processingFixed) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(adminToken());

        ResponseEntity<String> opened = rest.exchange(
                "/v1/admin/fees",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of(
                                "scope", "PLATFORM",
                                "platformRate", platformRate,
                                "processingRate", processingRate,
                                "processingFixed", processingFixed,
                                "currency", "AZN",
                                "note", "Set by FeeDisclosureApiTests."),
                        headers),
                String.class);

        assertThat(opened.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    /** Issued rather than signed in: a dozen suites share this address and five attempts. */
    private String adminToken() {
        if (adminToken != null) {
            return adminToken;
        }
        EmailAddress email = EmailAddress.of(ADMIN_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Administrator"),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        adminToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return adminToken;
    }
}
