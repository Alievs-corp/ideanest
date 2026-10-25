package az.ideanest.staff;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.RecordingVerificationNotifier;
import az.ideanest.user.infrastructure.UserRepository;
import java.util.List;
import java.util.Map;
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

/**
 * A listed bootstrap address is nobody until its account has proven it — #577.
 *
 * <p>Over HTTP and through the real registration, sign-in and verification endpoints, because
 * the hole was in how they fit together: registration takes any address, sign-in does not wait
 * for verification, and the bootstrap compared addresses only. Each piece was correct alone, and
 * a unit test of {@code StaffDirectory} with a hand-built account would not have shown that an
 * attacker reaches the console in three requests.
 *
 * <p>The address is the second entry of {@code application-test.yml}'s list and belongs to this
 * suite alone. The first is the shared moderator fixture, whose link
 * {@code FixtureAdministratorInbox} redeems on its behalf; using it here would assert the
 * fixture, not the rule.
 */
class BootstrapAdministratorApiTests extends AbstractIntegrationTest {

    private static final EmailAddress UNPROVEN = EmailAddress.of("unproven-administrator@ideanest.test");
    private static final String PASSWORD = "a-long-enough-password";

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<>() {};

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private RecordingVerificationNotifier notifier;

    @Test
    @DisplayName("an account holding a listed address is not staff until it verifies, and a super admin after")
    void aListedAddressIsAnAdministratorOnlyOnceProven() {
        // Fresh container per run and nothing else registers this address; a row already here
        // would mean the precondition this test is about was decided somewhere else.
        assertThat(users.findByEmailAndDeletedAtIsNull(UNPROVEN)).isEmpty();

        // The attack, exactly: register the listed address, never open the link, sign in.
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", UNPROVEN.value(), "password", PASSWORD, "name", "Not The Operator"),
                String.class);
        assertThat(users.findByEmailAndDeletedAtIsNull(UNPROVEN).orElseThrow().isEmailVerified()).isFalse();
        String accessToken = signIn();

        Map<String, Object> before = get("/v1/admin/me", accessToken).getBody();
        assertThat(before).containsEntry("staff", false).containsEntry("bootstrapped", false);
        assertThat(before.get("roles")).isEqualTo(List.of());
        // A route that does more than describe the caller: the roster needs ADMINISTER_STAFF,
        // which is what the bootstrap would have conferred.
        assertThat(get("/v1/admin/staff", accessToken).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);

        // The operator, who reads that inbox, redeems the link.
        ResponseEntity<String> verified = rest.postForEntity(
                "/v1/auth/verify-email",
                Map.of("token", notifier.tokenSentTo(UNPROVEN).orElseThrow()),
                String.class);
        assertThat(verified.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        // The same token: the standing is read from the account on every request, so nobody has
        // to sign in again for the proof to count.
        Map<String, Object> after = get("/v1/admin/me", accessToken).getBody();
        assertThat(after).containsEntry("staff", true).containsEntry("bootstrapped", true);
        assertThat(after.get("roles")).isEqualTo(List.of("SUPER_ADMIN"));
        assertThat(get("/v1/admin/staff", accessToken).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private String signIn() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", UNPROVEN.value(), "password", PASSWORD, "tokenDelivery", "body"), headers),
                OBJECT);
        assertThat(signedIn.getStatusCode()).isEqualTo(HttpStatus.OK);
        return (String) signedIn.getBody().get("accessToken");
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(headers), OBJECT);
    }
}
