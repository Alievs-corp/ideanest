package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.infrastructure.UserCredentialRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.RecordingVerificationNotifier;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Registration and email verification over HTTP, end to end: a real request, a
 * real database, a real Argon2 hash.
 */
class RegistrationApiTests extends AbstractIntegrationTest {

    /** Every test gets its own address, because the per-email rate limit is real here. */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private RecordingVerificationNotifier notifier;

    @Autowired
    private UserAccounts users;

    @Autowired
    private UserCredentialRepository credentials;

    @BeforeEach
    void clearSentMessages() {
        notifier.clear();
    }

    private static EmailAddress uniqueEmail() {
        return EmailAddress.of("person" + SEQUENCE.incrementAndGet() + "@example.com");
    }

    private ResponseEntity<String> register(EmailAddress email, String password, String name) {
        return rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", password, "name", name),
                String.class);
    }

    private ResponseEntity<String> verify(String token) {
        return rest.postForEntity("/v1/auth/verify-email", Map.of("token", token), String.class);
    }

    @Test
    @DisplayName("registering creates an unverified account and sends a link")
    void registeringCreatesAnUnverifiedAccount() {
        EmailAddress email = uniqueEmail();

        ResponseEntity<String> response = register(email, "a-long-enough-password", "İsmət Cahangirov");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

        UserAccount account = users.findByEmail(email).orElseThrow();
        assertThat(account.emailVerified()).isFalse();
        // Azerbaijani letters have no Unicode decomposition, so this is the case
        // a library that only knows about accents would get wrong.
        assertThat(account.slug()).isEqualTo("ismet-cahangirov");
        assertThat(notifier.verificationsSentTo(email)).isEqualTo(1);
    }

    @Test
    @DisplayName("nobody gets the slug new, which is the new-campaign page (#148)")
    void theSlugNewIsReserved() {
        EmailAddress email = uniqueEmail();

        register(email, "a-long-enough-password", "New");

        // /projects/new is a static route, so a creator slugged "new" would have
        // every campaign address shadowed by it. Numbered, as a taken slug is.
        assertThat(users.findByEmail(email).orElseThrow().slug()).matches("new-[0-9]+");
    }

    @Test
    @DisplayName("the password is stored as an Argon2id hash and nothing else")
    void passwordIsHashed() {
        EmailAddress email = uniqueEmail();
        String password = "a-long-enough-password";

        register(email, password, "Test Person");

        UserAccount account = users.findByEmail(email).orElseThrow();
        String stored = credentials.findById(account.id()).orElseThrow().getPasswordHash();

        // The single most consequential assertion in this file.
        assertThat(stored).doesNotContain(password);
        assertThat(stored).startsWith("$argon2id$");
    }

    @Test
    @DisplayName("registering a known address answers exactly as an unknown one does")
    void registrationDoesNotRevealWhetherAnAddressIsKnown() {
        EmailAddress email = uniqueEmail();
        ResponseEntity<String> first = register(email, "a-long-enough-password", "Test Person");
        ResponseEntity<String> second = register(email, "another-long-password", "Someone Else");

        // Identical status and identical body. A difference here is an account
        // enumeration oracle: feed it a breach list, get back the subset who
        // are backers, and write a much better phishing email.
        assertThat(second.getStatusCode()).isEqualTo(first.getStatusCode());
        assertThat(second.getBody()).isEqualTo(first.getBody());

        // The account is untouched: no second user, no overwritten password.
        assertThat(notifier.verificationsSentTo(email)).isEqualTo(1);
        // The owner of the address is told, because they are the one who should
        // know that somebody is probing their account.
        assertThat(notifier.warningsSentTo(email)).isEqualTo(1);
    }

    @Test
    @DisplayName("a short password is refused with a reason")
    void shortPasswordIsRefused() {
        ResponseEntity<String> response = register(uniqueEmail(), "short", "Test Person");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // A user cannot fix a password they are not told the requirement for.
        assertThat(response.getBody()).contains("at least 12 characters");
    }

    @Test
    @DisplayName("a password containing the address is refused")
    void passwordContainingTheAddressIsRefused() {
        EmailAddress email = uniqueEmail();
        String localPart = email.value().substring(0, email.value().indexOf('@'));

        ResponseEntity<String> response = register(email, localPart + "-and-more-text", "Test Person");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("something that is not an address is refused with a field error")
    void invalidEmailIsRefused() {
        ResponseEntity<String> response = rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", "not-an-address", "password", "a-long-enough-password", "name", "Test Person"),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).contains("email");
        // The rejected value is not echoed: it is a field a user typed, and
        // this response is written to whatever log sits in front of us.
        assertThat(response.getBody()).doesNotContain("not-an-address");
    }

    @Test
    @DisplayName("too many attempts on one address are refused with a Retry-After")
    void repeatedAttemptsOnOneAddressAreRateLimited() {
        EmailAddress email = uniqueEmail();

        // The configured per-email limit in the test profile is three.
        for (int attempt = 0; attempt < 3; attempt++) {
            assertThat(register(email, "a-long-enough-password", "Test Person").getStatusCode())
                    .isEqualTo(HttpStatus.ACCEPTED);
        }

        ResponseEntity<String> refused = register(email, "a-long-enough-password", "Test Person");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        // Without the header a client retries immediately and spends the rest
        // of the window being refused.
        assertThat(refused.getHeaders().getFirst("Retry-After")).isNotNull();
    }

    @Test
    @DisplayName("the link from the email verifies the address, once")
    void verificationSucceedsExactlyOnce() {
        EmailAddress email = uniqueEmail();
        register(email, "a-long-enough-password", "Test Person");
        String token = notifier.tokenSentTo(email).orElseThrow();

        assertThat(verify(token).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(users.findByEmail(email).orElseThrow().emailVerified()).isTrue();

        ResponseEntity<String> second = verify(token);
        // A link that keeps working is a standing key to the account, sitting in
        // a mailbox for as long as the mailbox exists.
        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(second.getBody()).contains("already been used");
    }

    @Test
    @DisplayName("an unknown token is refused")
    void unknownTokenIsRefused() {
        ResponseEntity<String> response = verify("not-a-real-token-value");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).contains("not valid");
    }
}
