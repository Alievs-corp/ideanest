package az.ideanest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.domain.IdentityProvider;
import az.ideanest.auth.domain.ProviderIdentity;
import az.ideanest.auth.infrastructure.ProviderIdentityRepository;
import az.ideanest.auth.infrastructure.UserCredentialRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.auth.domain.Totp;
import az.ideanest.support.OidcProviderStub;
import az.ideanest.support.RecordingVerificationNotifier;
import az.ideanest.user.application.UserAccount;
import az.ideanest.user.application.UserAccounts;
import az.ideanest.user.application.UserDirectory;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
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
import org.springframework.security.oauth2.jwt.JwtDecoder;

/**
 * Signing in with Google and Apple, over HTTP, against a stubbed provider.
 *
 * <p>Two tests here are the reason the rest exist.
 * {@link #theSameProviderAccountKeepsTheSameAccountWhenTheAddressChanges()} is
 * the subject-not-email decision, and
 * {@link #aVerifiedAddressDoesNotLinkToAnUnverifiedAccount()} is the
 * pre-registration attack. Everything else is the token verification that has to
 * hold for either of them to mean anything.
 */
class SocialSignInApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String NONCE = "a-nonce-the-client-sent";
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserAccounts users;

    @Autowired
    private UserCredentialRepository credentials;

    @Autowired
    private ProviderIdentityRepository identities;

    @Autowired
    private RecordingVerificationNotifier notifier;

    @Autowired
    private JwtDecoder jwtDecoder;

    @Autowired
    private javax.sql.DataSource dataSource;

    @Autowired
    private java.time.Clock clock;

    @Autowired
    private UserDirectory directory;

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static String uniqueSubject() {
        return "provider-subject-" + SEQUENCE.incrementAndGet();
    }

    private static EmailAddress uniqueEmail() {
        return EmailAddress.of("social" + SEQUENCE.incrementAndGet() + "@example.com");
    }

    private ResponseEntity<Map<String, Object>> signIn(String provider, String idToken, String nonce, String name) {
        Map<String, String> body = new HashMap<>();
        body.put("idToken", idToken);
        body.put("nonce", nonce);
        body.put("name", name);
        // The refresh token comes back in the body, exactly as a native client
        // asks for it on password sign-in.
        body.put("tokenDelivery", "body");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        return rest.exchange(
                "/v1/auth/oauth/" + provider,
                HttpMethod.POST,
                new HttpEntity<>(body, headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private ResponseEntity<Map<String, Object>> signInWithGoogle(String idToken) {
        return signIn("google", idToken, NONCE, null);
    }

    private static String accessTokenOf(ResponseEntity<Map<String, Object>> response) {
        return (String) response.getBody().get("accessToken");
    }

    private UUID userIdOf(ResponseEntity<Map<String, Object>> response) {
        return UUID.fromString(jwtDecoder.decode(accessTokenOf(response)).getSubject());
    }

    /** An account here whose address has been proven, the ordinary way. */
    private UserAccount verifiedLocalAccount(EmailAddress email) {
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Local Person"),
                String.class);
        String token = notifier.tokenSentTo(email).orElseThrow();
        rest.postForEntity("/v1/auth/verify-email", Map.of("token", token), String.class);
        return users.findByEmail(email).orElseThrow();
    }

    private UserAccount unverifiedLocalAccount(EmailAddress email) {
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Local Person"),
                String.class);
        return users.findByEmail(email).orElseThrow();
    }

    // ------------------------------------------------------------------
    // The happy path
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a first sign-in creates the account, with the address already verified and no password")
    void aFirstSignInCreatesTheAccount() {
        EmailAddress email = uniqueEmail();

        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .email(email.value())
                .emailVerified(true)
                .name("Aygün Məmmədova")
                .nonce(NONCE)
                .sign());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(accessTokenOf(response)).isNotBlank();
        assertThat(response.getBody().get("refreshToken")).isNotNull();

        UserAccount account = users.findByEmail(email).orElseThrow();
        // The provider proved the address; asking the user to prove it again
        // would leave them unable to pledge until they opened an email about
        // something they had just done.
        assertThat(account.emailVerified()).isTrue();
        assertThat(account.name()).isEqualTo("Aygün Məmmədova");
        // No password, and no empty row pretending to be one. This is what
        // user_credentials being a separate table is for.
        assertThat(credentials.findById(account.id())).isEmpty();
    }

    @Test
    @DisplayName("the session is the same one a password sign-in produces")
    void theSessionIsTheOrdinaryKind() {
        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .email(uniqueEmail().value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        HttpHeaders bearer = new HttpHeaders();
        bearer.setBearerAuth(accessTokenOf(response));
        assertThat(rest.exchange("/v1/me", HttpMethod.GET, new HttpEntity<>(bearer), String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // Rotation included. A provider sign-in that produced a session refresh
        // could not rotate would be a second kind of session with a second set
        // of rules, and only one of them would be the one anybody reasons about.
        HttpHeaders json = new HttpHeaders();
        json.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> refreshed = rest.exchange(
                "/v1/auth/refresh",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("refreshToken", response.getBody().get("refreshToken")), json),
                String.class);

        assertThat(refreshed.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("the same provider account keeps the same account here after the address changes")
    void theSameProviderAccountKeepsTheSameAccountWhenTheAddressChanges() {
        String subject = uniqueSubject();
        EmailAddress first = uniqueEmail();
        EmailAddress second = uniqueEmail();

        UUID initial = userIdOf(signInWithGoogle(OidcProviderStub.googleToken(subject)
                .email(first.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign()));

        // The person changed the address on their Google account. The subject
        // did not change, because it never does.
        UUID afterChange = userIdOf(signInWithGoogle(OidcProviderStub.googleToken(subject)
                .email(second.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign()));

        assertThat(afterChange).isEqualTo(initial);
        // And no second account was created for the new address. Matching on the
        // address would have made one -- and would have handed this account to
        // whoever ends up holding the old address.
        assertThat(users.findByEmail(second)).isEmpty();

        ProviderIdentity link = identities
                .findByProviderAndSubject(IdentityProvider.GOOGLE, subject)
                .orElseThrow();
        // The address on the link follows the provider. The address on the
        // account does not: nobody asked us to change where their receipts go.
        assertThat(link.getEmail()).isEqualTo(second);
        assertThat(users.findById(initial).orElseThrow().email()).isEqualTo(first);
    }

    // ------------------------------------------------------------------
    // Verifying the token
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a token signed by a key the provider does not publish is refused")
    void aTokenSignedByTheWrongKeyIsRefused() {
        EmailAddress email = uniqueEmail();

        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .email(email.value())
                .emailVerified(true)
                .nonce(NONCE)
                // Same key identifier as the published key, so this fails on the
                // signature rather than on key selection. Anything less would
                // not prove the signature is checked.
                .signWithWrongKey());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(users.findByEmail(email)).isEmpty();
    }

    @Test
    @DisplayName("a token issued to another application is refused")
    void aTokenForAnotherAudienceIsRefused() {
        EmailAddress email = uniqueEmail();

        // Correctly signed by Google, entirely valid, and issued to somebody
        // else's application. Without the audience check, any developer with a
        // Google client could sign our users in.
        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .audience("someone-elses-app.apps.googleusercontent.com")
                .email(email.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(users.findByEmail(email)).isEmpty();
    }

    @Test
    @DisplayName("a token from another issuer is refused")
    void aTokenFromAnotherIssuerIsRefused() {
        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .issuer("https://accounts.example.com")
                .email(uniqueEmail().value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("an expired token is refused")
    void anExpiredTokenIsRefused() {
        Instant anHourAgo = Instant.now().minusSeconds(3600);

        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .email(uniqueEmail().value())
                .emailVerified(true)
                .nonce(NONCE)
                .issuedAt(anHourAgo)
                .expiresAt(anHourAgo.plusSeconds(60))
                .sign());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a token that is still valid but too old to be this sign-in is refused")
    void aStaleTokenIsRefused() {
        Instant longEnoughAgo = Instant.now().minusSeconds(1800);

        // Inside the provider's expiry -- Google's ID tokens last an hour -- and
        // far outside ours. A token this old was not minted by the sign-in that
        // is presenting it; it has been sitting somewhere it could be read.
        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .email(uniqueEmail().value())
                .emailVerified(true)
                .nonce(NONCE)
                .issuedAt(longEnoughAgo)
                .expiresAt(longEnoughAgo.plusSeconds(3600))
                .sign());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("an unsigned token is refused")
    void anUnsignedTokenIsRefused() {
        // alg: none. Every claim is correct and there is no signature at all.
        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .email(uniqueEmail().value())
                .emailVerified(true)
                .nonce(NONCE)
                .unsigned());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a token bound to a different nonce is refused")
    void aMismatchedNonceIsRefused() {
        String idToken = OidcProviderStub.googleToken(uniqueSubject())
                .email(uniqueEmail().value())
                .emailVerified(true)
                .nonce("the-nonce-some-other-session-sent")
                .sign();

        assertThat(signIn("google", idToken, NONCE, null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a token with no nonce at all is refused")
    void aMissingNonceIsRefused() {
        String idToken = OidcProviderStub.googleToken(uniqueSubject())
                .email(uniqueEmail().value())
                .emailVerified(true)
                .sign();

        assertThat(signIn("google", idToken, null, null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // Linking
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a verified provider address links to an account that has verified the same address")
    void aVerifiedAddressLinksToAVerifiedAccount() {
        EmailAddress email = uniqueEmail();
        UserAccount local = verifiedLocalAccount(email);
        String subject = uniqueSubject();

        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(subject)
                .email(email.value())
                .emailVerified(true)
                .name("A Different Name")
                .nonce(NONCE)
                .sign());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        // Both sides proved the same address, so both are the same person.
        assertThat(userIdOf(response)).isEqualTo(local.id());
        assertThat(identities.findByProviderAndSubject(IdentityProvider.GOOGLE, subject))
                .get()
                .extracting(ProviderIdentity::getUserId)
                .isEqualTo(local.id());
        // The provider's name does not overwrite one the person already chose.
        assertThat(users.findById(local.id()).orElseThrow().name()).isEqualTo("Local Person");
    }

    @Test
    @DisplayName("a verified provider address does not link to an account that has not verified it")
    void aVerifiedAddressDoesNotLinkToAnUnverifiedAccount() {
        EmailAddress email = uniqueEmail();
        UserAccount local = unverifiedLocalAccount(email);
        String subject = uniqueSubject();

        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(subject)
                .email(email.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        // The pre-registration attack: anybody can register this address and
        // choose the password, because registration does not require the address
        // to be proven first. Linking would hand them an account that has since
        // become somebody else's.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(identities.findByProviderAndSubject(IdentityProvider.GOOGLE, subject))
                .isEmpty();
        assertThat(users.findById(local.id()).orElseThrow().emailVerified()).isFalse();
    }

    @Test
    @DisplayName("verifying the address afterwards is what makes the link work")
    void verifyingTheAddressUnblocksTheLink() {
        EmailAddress email = uniqueEmail();
        UserAccount local = unverifiedLocalAccount(email);

        assertThat(signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                                .email(email.value())
                                .emailVerified(true)
                                .nonce(NONCE)
                                .sign())
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);

        // The escape hatch the refusal points at, and the reason refusing is a
        // delay rather than a dead end: the verification email is already in the
        // inbox the provider has just proven they control.
        rest.postForEntity(
                "/v1/auth/verify-email",
                Map.of("token", notifier.tokenSentTo(email).orElseThrow()),
                String.class);

        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .email(email.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(userIdOf(response)).isEqualTo(local.id());
    }

    @Test
    @DisplayName("an address the provider has not verified creates nothing and links to nothing")
    void anUnverifiedProviderAddressIsRefused() {
        EmailAddress unknown = uniqueEmail();
        EmailAddress known = uniqueEmail();
        verifiedLocalAccount(known);

        ResponseEntity<Map<String, Object>> forUnknownAddress =
                signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                        .email(unknown.value())
                        .emailVerified(false)
                        .nonce(NONCE)
                        .sign());

        ResponseEntity<Map<String, Object>> forKnownAddress =
                signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                        .email(known.value())
                        .emailVerified(false)
                        .nonce(NONCE)
                        .sign());

        assertThat(forUnknownAddress.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(users.findByEmail(unknown)).isEmpty();

        // And identical for an address that does have an account here. The
        // caller has proven nothing, so the answer must tell them nothing: a
        // different status or message would answer "is this person a backer
        // here?" for anybody with a provider account and a list of addresses.
        assertThat(forKnownAddress.getStatusCode()).isEqualTo(forUnknownAddress.getStatusCode());
        assertThat(forKnownAddress.getBody()).isEqualTo(forUnknownAddress.getBody());
    }

    @Test
    @DisplayName("a token with no address at all is refused")
    void aTokenWithoutAnAddressIsRefused() {
        ResponseEntity<Map<String, Object>> response = signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // Apple
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Apple's string booleans, relay address, and name-only-once are all handled")
    void appleSignInWorks() {
        EmailAddress relay = EmailAddress.of("aygun" + SEQUENCE.incrementAndGet() + "@privaterelay.appleid.com");
        String subject = uniqueSubject();

        // Apple sends email_verified as the string "true", never sends a name in
        // the token, and may hand out a relay address. The name arrives once, in
        // the first authorisation response, and the client forwards it here.
        ResponseEntity<Map<String, Object>> response = signIn(
                "apple",
                OidcProviderStub.appleToken(subject)
                        .email(relay.value())
                        .emailVerified("true")
                        .privateEmail("true")
                        .nonce(NONCE)
                        .sign(),
                NONCE,
                "Aygün Məmmədova");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

        UserAccount account = users.findByEmail(relay).orElseThrow();
        // "true" read as false would have refused this sign-in outright.
        assertThat(account.emailVerified()).isTrue();
        assertThat(account.name()).isEqualTo("Aygün Məmmədova");

        ProviderIdentity link = identities
                .findByProviderAndSubject(IdentityProvider.APPLE, subject)
                .orElseThrow();
        // Worth knowing before somebody wonders why a shipping survey bounced.
        assertThat(link.isPrivateEmail()).isTrue();
    }

    @Test
    @DisplayName("an Apple token is not accepted as a Google one")
    void tokensAreNotInterchangeableBetweenProviders() {
        String idToken = OidcProviderStub.appleToken(uniqueSubject())
                .email(uniqueEmail().value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign();

        // Same key set in the stub, so what refuses this is the issuer and the
        // audience -- which is exactly what would refuse it in production.
        assertThat(signIn("google", idToken, NONCE, null).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("second sign-in with a provider account somebody else already linked is refused")
    void aSecondProviderAccountForTheSamePersonIsRefused() {
        EmailAddress email = uniqueEmail();
        verifiedLocalAccount(email);

        assertThat(signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                                .email(email.value())
                                .emailVerified(true)
                                .nonce(NONCE)
                                .sign())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // A different Google account claiming the same proven address. One
        // person has one Google account here; a second is a support question,
        // not something to resolve by guessing.
        assertThat(signInWithGoogle(OidcProviderStub.googleToken(uniqueSubject())
                                .email(email.value())
                                .emailVerified(true)
                                .nonce(NONCE)
                                .sign())
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    // ------------------------------------------------------------------
    // The endpoint itself
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a provider nobody has heard of is a 404")
    void anUnknownProviderIsNotFound() {
        assertThat(signIn("facebook", "does-not-matter", NONCE, null).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("something that is not a token at all is refused, not a server error")
    void gibberishIsRefused() {
        assertThat(signInWithGoogle("not-a-jwt").getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // The second factor
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a provider sign-in still demands the second factor")
    void twoFactorAppliesToProviderSignInToo() {
        // An account that has proven its address here and turned two-factor on.
        EmailAddress email = uniqueEmail();
        UserAccount account = verifiedLocalAccount(email);
        byte[] secret = enrolTwoFactor(email, account.id());

        // Now sign in with Google, as the same person, with the address the
        // provider has verified.
        ResponseEntity<Map<String, Object>> provider = signInWithGoogle(
                OidcProviderStub.googleToken(uniqueSubject())
                        .email(email.value())
                        .emailVerified(true)
                        .nonce(NONCE)
                        .sign());

        // A provider proves which Google account is calling. It says nothing
        // about the second factor this user enrolled, and letting the button
        // skip it would make two-factor advisory — which is the same as not
        // having it, since somebody who reached the Google account is exactly
        // who it was turned on for.
        assertThat(provider.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(provider.getBody()).containsEntry("twoFactorRequired", true);
        assertThat(provider.getBody()).doesNotContainKey("accessToken");

        // And the challenge completes the same way a password one does.
        ResponseEntity<Map<String, Object>> completed = rest.exchange(
                "/v1/auth/2fa/verify",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of(
                                "challenge", (String) provider.getBody().get("challenge"),
                                // The next step's code, not this one's: the code
                                // that confirmed the enrolment a moment ago has
                                // been spent, and offering it again is the replay
                                // the implementation refuses. One step ahead is
                                // within the accepted skew and is what an
                                // authenticator would show thirty seconds later.
                                "code", Totp.codeAt(secret, Totp.stepAt(clock.instant()) + 1),
                                "tokenDelivery", "body"),
                        jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        assertThat(completed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(accessTokenOf(completed)).isNotBlank();
        assertThat(userIdOf(completed)).isEqualTo(account.id());
    }

    // ------------------------------------------------------------------
    // Suspension (#576)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a suspended account gets no session from the provider account already linked to it")
    void aSuspendedAccountIsRefusedByItsLinkedProvider() {
        String subject = uniqueSubject();
        EmailAddress email = uniqueEmail();
        ResponseEntity<Map<String, Object>> first = signInWithGoogle(OidcProviderStub.googleToken(subject)
                .email(email.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());
        UUID userId = userIdOf(first);
        suspend(userId);
        int sessionsBefore = sessionsOf(userId);

        // The hole this closes: a ban revokes every session, and the account's own
        // Google button used to hand it a fresh one a second later.
        ResponseEntity<Map<String, Object>> again = signInWithCookie(OidcProviderStub.googleToken(subject)
                .email(email.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        assertSuspended(again);
        assertThat(sessionsOf(userId)).isEqualTo(sessionsBefore);
    }

    @Test
    @DisplayName("a suspended account is not linked to a provider and gets no session from it")
    void aSuspendedAccountIsNotLinkedToANewProvider() {
        EmailAddress email = uniqueEmail();
        UserAccount local = verifiedLocalAccount(email);
        suspend(local.id());
        int sessionsBefore = sessionsOf(local.id());
        String subject = uniqueSubject();

        ResponseEntity<Map<String, Object>> response = signInWithCookie(OidcProviderStub.googleToken(subject)
                .email(email.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        assertSuspended(response);
        assertThat(sessionsOf(local.id())).isEqualTo(sessionsBefore);
        // Refused as a whole: a link left behind would be a way back in the day the
        // check moved, and it was made by somebody the platform had just stopped.
        assertThat(identities.findByProviderAndSubject(IdentityProvider.GOOGLE, subject))
                .isEmpty();
    }

    @Test
    @DisplayName("a suspended account with two-factor on is not handed a challenge by a provider sign-in")
    void aSuspendedAccountIsNotChallengedByAProvider() {
        EmailAddress email = uniqueEmail();
        UserAccount account = verifiedLocalAccount(email);
        enrolTwoFactor(email, account.id());
        suspend(account.id());
        int sessionsBefore = sessionsOf(account.id());

        ResponseEntity<Map<String, Object>> response = signInWithCookie(OidcProviderStub.googleToken(uniqueSubject())
                .email(email.value())
                .emailVerified(true)
                .nonce(NONCE)
                .sign());

        // "No session, no tokens, no two-factor challenge", as the password path has
        // said since #104: asking for a code only to refuse after it is the loop the
        // 403 exists to avoid.
        assertSuspended(response);
        assertThat(response.getBody()).doesNotContainKey("challenge");
        assertThat(outstandingChallengesOf(account.id())).isZero();
        assertThat(sessionsOf(account.id())).isEqualTo(sessionsBefore);
    }

    /** A provider sign-in with the default delivery, so a refresh cookie would show. */
    private ResponseEntity<Map<String, Object>> signInWithCookie(String idToken) {
        return rest.exchange(
                "/v1/auth/oauth/google",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("idToken", idToken, "nonce", NONCE), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static void assertSuspended(ResponseEntity<Map<String, Object>> response) {
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).containsEntry("code", "ACCOUNT_SUSPENDED");
        assertThat(response.getBody()).doesNotContainKey("accessToken");
        assertThat(response.getHeaders().get(HttpHeaders.SET_COOKIE)).isNull();
    }

    /** AD-04's ban as the user module records it, by an account other than the one banned. */
    private void suspend(UUID userId) {
        UUID moderator = verifiedLocalAccount(uniqueEmail()).id();
        directory.suspend(userId, moderator, "Counterfeit goods.");
    }

    /** Every session the account has ever had, revoked or not: what a refusal must not add to. */
    private int sessionsOf(UUID userId) {
        Integer count = new org.springframework.jdbc.core.JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM sessions WHERE user_id = ?", Integer.class, userId);
        return count == null ? 0 : count;
    }

    private int outstandingChallengesOf(UUID userId) {
        Integer count = new org.springframework.jdbc.core.JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM two_factor_challenges WHERE user_id = ? AND consumed_at IS NULL",
                        Integer.class,
                        userId);
        return count == null ? 0 : count;
    }

    /**
     * Two-factor switched on and confirmed for an account with a password, the way its
     * owner would: sign in, enable, confirm with the current code.
     *
     * @return the secret, as the server stores it
     */
    private byte[] enrolTwoFactor(EmailAddress email, UUID userId) {
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"),
                        jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        String accessToken = (String) signedIn.getBody().get("accessToken");

        HttpHeaders bearer = jsonHeaders();
        bearer.setBearerAuth(accessToken);
        rest.exchange(
                "/v1/auth/2fa/enable",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("password", PASSWORD), bearer),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        byte[] secret = new org.springframework.jdbc.core.JdbcTemplate(dataSource)
                .queryForObject("SELECT secret FROM user_two_factor WHERE user_id = ?", byte[].class, userId);
        rest.exchange(
                "/v1/auth/2fa/confirm",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("code", Totp.codeAt(secret, Totp.stepAt(clock.instant()))), bearer),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        return secret;
    }
}
