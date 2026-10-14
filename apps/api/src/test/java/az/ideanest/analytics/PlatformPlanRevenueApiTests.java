package az.ideanest.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.shared.Identifiers;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The platform dashboard counts what creators paid for plans — #478.
 *
 * <p>Read as a difference against the figure before the rows went in, because other suites
 * write to {@code subscription_payments} in the same database.
 */
class PlatformPlanRevenueApiTests extends AbstractIntegrationTest {

    private static final String PASSWORD = "a-long-enough-password";

    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    private static String accessToken;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("plan payments in the platform currency are counted, net of reversals")
    void planPaymentsAreCountedNetOfReversals() {
        Map<String, Object> before = totals();

        UUID paid = payment("149.00", "AZN", null);
        payment("49.00", "AZN", null);
        payment("-49.00", "AZN", paid);
        payment("20.00", "USD", null);

        Map<String, Object> after = totals();

        assertThat(amount(after).subtract(amount(before))).isEqualByComparingTo("149.00");
        assertThat(count(after) - count(before)).isEqualTo(2);
        assertThat(currency(after)).isEqualTo("AZN");
    }

    private UUID payment(String amount, String currency, UUID reverses) {
        UUID id = Identifiers.newIdentifier();
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO subscription_payments (
                            id, subscription_id, account_id, plan_id, plan_code, plan_name,
                            amount, currency, billing_period, method, received_at, recorded_by, reverses)
                        VALUES (?, ?, ?, ?, 'PRO', 'Pro', ?::numeric, ?, 'MONTHLY', 'BANK_TRANSFER', now(), ?, ?)
                        """,
                        id,
                        Identifiers.newIdentifier(),
                        Identifiers.newIdentifier(),
                        Identifiers.newIdentifier(),
                        amount,
                        currency,
                        Identifiers.newIdentifier(),
                        reverses);
        return id;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> totals() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(staffToken());

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/v1/admin/analytics",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        return (Map<String, Object>) response.getBody().get("totals");
    }

    @SuppressWarnings("unchecked")
    private static BigDecimal amount(Map<String, Object> totals) {
        return new BigDecimal((String) ((Map<String, Object>) totals.get("planRevenue")).get("amount"));
    }

    @SuppressWarnings("unchecked")
    private static String currency(Map<String, Object> totals) {
        return (String) ((Map<String, Object>) totals.get("planRevenue")).get("currency");
    }

    private static long count(Map<String, Object> totals) {
        return ((Number) totals.get("planPayments")).longValue();
    }

    private String staffToken() {
        if (accessToken != null) {
            return accessToken;
        }
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        accessToken = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return accessToken;
    }
}
