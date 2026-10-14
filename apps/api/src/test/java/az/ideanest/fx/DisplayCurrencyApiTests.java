package az.ideanest.fx;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.fx.application.ExchangeRateRefreshJob;
import az.ideanest.fx.infrastructure.ExchangeRateRepository;
import az.ideanest.pledge.application.DraftPledge;
import az.ideanest.pledge.application.PledgeDetail;
import az.ideanest.pledge.application.PledgePayments;
import az.ideanest.pledge.application.PledgeService;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.money.Money;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.ScriptedRateSource;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * §4.2's P-10, currency half, over HTTP — issue #327.
 *
 * <p>Three surfaces and the one record they exist for:
 *
 * <ul>
 *   <li>{@code GET /v1/exchange-rates} — public, cacheable, and empty rather than absent
 *       when the platform has nothing to offer.
 *   <li>{@code PATCH /v1/me/currency} — refuses what the platform cannot honour <em>today</em>,
 *       and says what it can.
 *   <li>{@link #aConfirmedPledgeRecordsTheRateItWasShownAt()} — §21.2's rate retention, and
 *       the reason the whole feature is more than a screen.
 * </ul>
 */
class DisplayCurrencyApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private ScriptedRateSource source;

    @Autowired
    private ExchangeRateRefreshJob refresh;

    @Autowired
    private ExchangeRateRepository rates;

    @Autowired
    private PledgeService pledges;

    @Autowired
    private PledgePayments payments;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    private String handle;

    @BeforeEach
    void aFreshTableAndScript() {
        handle = "fx-" + SEQUENCE.incrementAndGet();
        source.reset();
        rates.deleteAll();
    }

    /**
     * In dependency order, and {@code outbox_events} first.
     *
     * <p>The order is not tidiness. A confirmation records {@code pledge.confirmed} (#235),
     * and V19 deliberately gives {@code outbox_events} no foreign key to the aggregate it
     * describes — so deleting a campaign while its event is still unrelayed leaves a row
     * naming a project that no longer exists. The next suite to drive the relay picks it up
     * globally, tries to attribute a referral to that project, and fails on a foreign key
     * with this suite's name nowhere in the message. That is exactly what happened.
     *
     * <p>Scoped to this suite's own campaigns everywhere, including the outbox — which has no
     * column to scope on, so it is matched through the pledges its rows describe.
     */
    @AfterEach
    void leaveNothingBehind() {
        jdbc().update(
                """
                DELETE FROM outbox_events
                 WHERE aggregate_id IN (
                     SELECT id FROM pledges
                      WHERE project_id IN (SELECT id FROM projects WHERE slug LIKE 'fx-%'))
                """);
        jdbc().update("DELETE FROM pledges WHERE project_id IN (SELECT id FROM projects WHERE slug LIKE 'fx-%')");
        jdbc().update("DELETE FROM projects WHERE slug LIKE 'fx-%'");
    }

    // ------------------------------------------------------------------
    // The public read
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the rates are public, cacheable, and say what they are priced in")
    void theRatesArePublic() {
        source.publishes(today(), Map.of("USD", "1.7000000000", "EUR", "1.9877000000"));
        refresh.refresh();

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/exchange-rates", HttpMethod.GET, null, new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        // Nothing personal here -- it is what a central bank published -- so this is one of
        // the few reads on the platform a shared cache may hold.
        assertThat(response.getHeaders().getCacheControl()).contains("public");
        assertThat(response.getBody()).containsEntry("base", "AZN");

        assertThat(ratesIn(response))
                .extracting(rate -> rate.get("currency"))
                .containsExactlyInAnyOrder("USD", "EUR");
        assertThat(ratesIn(response))
                .filteredOn(rate -> "USD".equals(rate.get("currency")))
                .singleElement()
                .satisfies(rate -> {
                    // §10.3 keeps money out of JSON numbers; a rate is what money is computed
                    // from, so it crosses as a string for the same reason one step earlier.
                    assertThat(rate.get("rate")).isInstanceOf(String.class).isEqualTo("1.7000000000");
                    assertThat(rate.get("publishedFor")).isEqualTo(today().toString());
                });
    }

    @Test
    @DisplayName("a platform with no rates answers an empty list rather than a failure")
    void noRatesIsAnAnswer() {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/exchange-rates", HttpMethod.GET, null, new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        // The clients read this as "no display currency is offered" and draw nothing, which
        // is the honest surface. A 404 or a 503 would make every client invent its own.
        assertThat(ratesIn(response)).isEmpty();
        assertThat(response.getBody()).containsEntry("base", "AZN");
    }

    // ------------------------------------------------------------------
    // The preference
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a reader may choose a currency the platform can price today")
    void aReaderMayChooseAnAvailableCurrency() {
        source.publishes(today(), Map.of("USD", "1.7000000000"));
        refresh.refresh();
        UUID accountId = register(handle + "-reader");

        assertThat(setCurrency(accountId, "USD").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(me(accountId)).containsEntry("currency", "USD");
    }

    /**
     * The refusal, and the list that comes with it.
     *
     * <p>Which currencies are available is a property of what a central bank published and
     * when the platform last reached it — so a client that cached the list at build time is
     * wrong on exactly the day this refusal happens. The available set therefore travels in
     * §10.4's {@code meta}.
     */
    @Test
    @DisplayName("a currency the platform cannot price is refused, with the ones it can")
    void anUnavailableCurrencyIsRefused() {
        source.publishes(today(), Map.of("USD", "1.7000000000"));
        refresh.refresh();
        UUID accountId = register(handle + "-reader");

        ResponseEntity<Map<String, Object>> refusal = setCurrencyRaw(accountId, "EUR");

        assertThat(refusal.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refusal.getBody()).containsEntry("code", "DISPLAY_CURRENCY_UNAVAILABLE");
        assertThat(available(refusal)).containsExactlyInAnyOrder("AZN", "USD");
    }

    /**
     * The platform's own currency is always allowed, whatever the source is doing.
     *
     * <p>It is how somebody turns the preference off, and a reader who cannot undo a setting
     * because a third party is down is a reader stuck with a stale approximation.
     */
    @Test
    @DisplayName("the platform's own currency is accepted even with no rates at all")
    void theBaseCurrencyIsAlwaysAvailable() {
        UUID accountId = register(handle + "-reader");

        assertThat(setCurrency(accountId, "AZN").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(me(accountId)).containsEntry("currency", "AZN");
    }

    @Test
    @DisplayName("something that is not a currency code is refused as a bad request")
    void aMalformedCurrencyIsRefused() {
        UUID accountId = register(handle + "-reader");

        assertThat(setCurrencyRaw(accountId, "dollars").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("an anonymous request cannot change anybody's currency")
    void anonymousCannotSetIt() {
        ResponseEntity<String> response = rest.exchange(
                "/v1/me/currency",
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("currency", "USD"), jsonHeaders()),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // §21.2's rate retention
    // ------------------------------------------------------------------

    /**
     * <strong>The record the whole feature exists for.</strong>
     *
     * <p>§21.2: "the rate used is stored on the pledge, for audit". It is the answer to "what
     * did we tell them this would cost", asked months later by somebody holding a complaint
     * that the figure moved — and nobody can reconstruct it afterwards, because the rate has
     * moved too.
     */
    @Test
    @DisplayName("a confirmed pledge records the rate it was shown at")
    void aConfirmedPledgeRecordsTheRateItWasShownAt() {
        source.publishes(today(), Map.of("USD", "1.7000000000"));
        refresh.refresh();

        UUID backerId = register(handle + "-backer");
        setCurrency(backerId, "USD");
        UUID pledgeId = confirmAPledge(backerId, "50.00");

        Map<String, Object> row = pledgeRow(pledgeId);
        assertThat(row.get("display_currency")).isEqualTo("USD");
        assertThat((BigDecimal) row.get("display_rate")).isEqualByComparingTo("1.7");
        // The rate and never the converted amount. The amount is a product of total_amount
        // and this, and storing both would be storing a figure that can disagree with its
        // own inputs.
        assertThat(row).doesNotContainKey("display_amount");

        // And it reaches the screen that has to draw it, as a string: §10.3 keeps money out
        // of JSON numbers, and a rate is what money is computed from.
        Map<String, Object> response = readPledge(backerId, pledgeId);
        assertThat(response).containsEntry("displayCurrency", "USD");
        assertThat(response.get("displayRate"))
                .isInstanceOf(String.class)
                .isEqualTo("1.7000000000");
    }

    @Test
    @DisplayName("a backer who reads amounts in the campaign's own currency records nothing")
    void noApproximationRecordsNothing() {
        source.publishes(today(), Map.of("USD", "1.7000000000"));
        refresh.refresh();

        // Every account starts here, which makes this the ordinary case rather than the edge
        // one. There was no approximation, so recording a rate of 1 would be recording a
        // conversion that did not happen -- V60's constraint refuses it.
        UUID backerId = register(handle + "-backer");
        UUID pledgeId = confirmAPledge(backerId, "50.00");

        Map<String, Object> row = pledgeRow(pledgeId);
        assertThat(row.get("display_currency")).isNull();
        assertThat(row.get("display_rate")).isNull();
    }

    @Test
    @DisplayName("a preference whose rate has aged out records nothing rather than a stale rate")
    void aStaleRateIsNotRecorded() {
        source.publishes(today(), Map.of("USD", "1.7000000000"));
        refresh.refresh();
        UUID backerId = register(handle + "-backer");
        setCurrency(backerId, "USD");

        // The rate ages out from under a preference somebody set last month. A false entry
        // in an audit record is worse than an absent one.
        rates.deleteAll();
        source.publishes(today().minusDays(30), Map.of("USD", "1.7000000000"));
        refresh.refresh();

        UUID pledgeId = confirmAPledge(backerId, "50.00");

        Map<String, Object> row = pledgeRow(pledgeId);
        assertThat(row.get("display_currency")).isNull();
        assertThat(row.get("display_rate")).isNull();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static LocalDate today() {
        return LocalDate.now(ZoneOffset.UTC);
    }

    /**
     * A pledge drafted through the service and paid for as the provider's callback settles it.
     *
     * <p>Driven rather than written, unlike {@code Pledges.confirmed}: what is under test is
     * what the payment stamps on the row, so a fixture that wrote the row would assert
     * against itself. Until #45 this went through the stored-card model's {@code confirm},
     * which stamped the same rate.
     */
    private UUID confirmAPledge(UUID backerId, String amount) {
        UUID creatorId = Campaigns.creator(dataSource, handle + "-creator");
        UUID projectId = Campaigns.seed(dataSource, creatorId, handle + "-campaign-" + SEQUENCE.incrementAndGet())
                .state("LIVE")
                .goal("1000.00")
                .insert();

        PledgeDetail draft = pledges.draft(new DraftPledge(
                projectId,
                backerId,
                null,
                List.of(),
                Money.of(new BigDecimal(amount), "AZN"),
                null,
                false,
                null,
                "fx-" + UUID.randomUUID()));

        UUID pledgeId = draft.pledge().getId();
        new TransactionTemplate(transactions)
                .executeWithoutResult(status -> payments.recordPaid(pledgeId, Instant.now()));
        return pledgeId;
    }

    /** The pledge as its own screen reads it — `GET /v1/pledges/{id}`. */
    private Map<String, Object> readPledge(UUID backerId, UUID pledgeId) {
        return rest.exchange(
                        "/v1/pledges/" + pledgeId,
                        HttpMethod.GET,
                        new HttpEntity<>(null, bearer(backerId)),
                        new ParameterizedTypeReference<Map<String, Object>>() {})
                .getBody();
    }

    private Map<String, Object> pledgeRow(UUID pledgeId) {
        return jdbc().queryForMap(
                        "SELECT display_currency, display_rate FROM pledges WHERE id = ?", pledgeId);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> ratesIn(ResponseEntity<Map<String, Object>> response) {
        return (List<Map<String, Object>>) response.getBody().get("rates");
    }

    @SuppressWarnings("unchecked")
    private static List<String> available(ResponseEntity<Map<String, Object>> refusal) {
        Map<String, Object> meta = (Map<String, Object>) refusal.getBody().get("meta");
        return (List<String>) meta.get("available");
    }

    private ResponseEntity<String> setCurrency(UUID accountId, String currency) {
        return rest.exchange(
                "/v1/me/currency",
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("currency", currency), bearer(accountId)),
                String.class);
    }

    private ResponseEntity<Map<String, Object>> setCurrencyRaw(UUID accountId, String currency) {
        return rest.exchange(
                "/v1/me/currency",
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("currency", currency), bearer(accountId)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private Map<String, Object> me(UUID accountId) {
        return rest.exchange(
                        "/v1/me",
                        HttpMethod.GET,
                        new HttpEntity<>(null, bearer(accountId)),
                        new ParameterizedTypeReference<Map<String, Object>>() {})
                .getBody();
    }

    private UUID register(String name) {
        EmailAddress address = EmailAddress.of(name + "@example.com");
        if (users.findByEmailAndDeletedAtIsNull(address).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", address.value(), "password", PASSWORD, "name", "Test " + name),
                    String.class);
        }
        return users.findByEmailAndDeletedAtIsNull(address).orElseThrow().getId();
    }

    private HttpHeaders bearer(UUID accountId) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(tokens.issue(
                        accountId,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value());
        return headers;
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }
}
