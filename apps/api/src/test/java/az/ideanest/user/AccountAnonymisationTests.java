package az.ideanest.user;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.domain.EmailChangeRequest;
import az.ideanest.auth.domain.IdentityProvider;
import az.ideanest.auth.domain.ProviderIdentity;
import az.ideanest.auth.domain.RecoveryCode;
import az.ideanest.auth.domain.Totp;
import az.ideanest.auth.domain.TwoFactorChallenge;
import az.ideanest.auth.domain.TwoFactorSecret;
import az.ideanest.auth.infrastructure.EmailChangeRequestRepository;
import az.ideanest.auth.infrastructure.ProviderIdentityRepository;
import az.ideanest.auth.infrastructure.RecoveryCodeRepository;
import az.ideanest.auth.infrastructure.RefreshTokenRepository;
import az.ideanest.auth.infrastructure.SessionRepository;
import az.ideanest.auth.infrastructure.TwoFactorChallengeRepository;
import az.ideanest.auth.infrastructure.TwoFactorSecretRepository;
import az.ideanest.auth.infrastructure.UserCredentialRepository;
import az.ideanest.auth.infrastructure.VerificationTokenRepository;
import az.ideanest.notification.domain.DevicePlatform;
import az.ideanest.notification.domain.PushDevice;
import az.ideanest.notification.infrastructure.PushDeviceRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.user.application.AccountAnonymisationJob;
import az.ideanest.user.application.AccountAnonymiser;
import az.ideanest.user.application.AccountDeletionService;
import az.ideanest.user.domain.User;
import az.ideanest.user.infrastructure.UserRepository;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
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

/**
 * What happens when the grace period runs out.
 *
 * <p>Time is supplied to the job rather than waited for: the deadline is thirty
 * days away, and a test that sleeps for it is a test nobody runs. The scheduled
 * trigger is switched off under the {@code test} profile — see
 * {@code application-test.yml} — precisely so that the only thing that moves
 * here is the instant these tests pass in.
 */
class AccountAnonymisationTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    private static final Duration WITHIN_THE_GRACE_PERIOD = Duration.ofDays(29);
    private static final Duration AFTER_THE_GRACE_PERIOD = Duration.ofDays(31);

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private AccountDeletionService deletions;

    @Autowired
    private AccountAnonymisationJob job;

    /**
     * Used where the assertion is about one account rather than about the batch.
     * The suite shares one database, so other tests' closing accounts fall due
     * in the same runs and a count would be asserting on them too.
     */
    @Autowired
    private AccountAnonymiser anonymiser;

    @Autowired
    private UserRepository users;

    @Autowired
    private SessionRepository sessions;

    @Autowired
    private RefreshTokenRepository refreshTokens;

    @Autowired
    private UserCredentialRepository credentials;

    @Autowired
    private VerificationTokenRepository verificationTokens;

    @Autowired
    private PushDeviceRepository pushDevices;

    @Autowired
    private TwoFactorSecretRepository twoFactorSecrets;

    @Autowired
    private RecoveryCodeRepository recoveryCodes;

    @Autowired
    private TwoFactorChallengeRepository twoFactorChallenges;

    @Autowired
    private ProviderIdentityRepository providerIdentities;

    @Autowired
    private EmailChangeRequestRepository emailChanges;

    private static final SecureRandom RANDOM = new SecureRandom();

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A registered account with a session, a refresh token, and a verification link. */
    private EmailAddress closingAccount() {
        EmailAddress email = registeredUser();
        signIn(email);
        deletions.request(userId(email), PASSWORD);
        return email;
    }

    private EmailAddress registeredUser() {
        EmailAddress email = EmailAddress.of("anonymise" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        return email;
    }

    private ResponseEntity<Map<String, Object>> signIn(EmailAddress email) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static String accessToken(ResponseEntity<Map<String, Object>> signedIn) {
        return (String) signedIn.getBody().get("accessToken");
    }

    /** One of the shape Expo issues, unique so that no other suite's row collides with it. */
    private static String pushToken() {
        return "ExponentPushToken[anonymise" + SEQUENCE.incrementAndGet() + "]";
    }

    private ResponseEntity<Map<String, Object>> registerDevice(String accessToken, String token, String platform) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(accessToken);
        return rest.exchange(
                "/v1/me/devices",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("token", token, "platform", platform), headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private UUID userId(EmailAddress email) {
        return users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
    }

    private static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    /**
     * The identifiers of one account's rows in each table #645 is about.
     *
     * <p>Written through the repositories rather than through enrolment, social sign-in and
     * the address-change endpoint: each of those has its own suite, and what is under test here
     * is only whether anonymisation reaches the rows, however they got there.
     */
    private record SignInData(UUID twoFactor, UUID recoveryCode, UUID challenge, UUID providerLink, UUID emailChange) {
    }

    private SignInData signInDataFor(UUID userId) {
        Instant now = Instant.now();
        TwoFactorSecret enrolment = TwoFactorSecret.enrol(userId, randomBytes(Totp.SECRET_BYTES));
        enrolment.confirm(now, 1L);
        twoFactorSecrets.save(enrolment);
        RecoveryCode code =
                recoveryCodes.save(RecoveryCode.issue(userId, randomBytes(RecoveryCode.HASH_LENGTH), now));
        TwoFactorChallenge challenge = twoFactorChallenges.save(TwoFactorChallenge.issue(
                        userId, randomBytes(TwoFactorChallenge.HASH_LENGTH), now, now.plus(Duration.ofMinutes(5)))
                .describedAs("Pixel 8", "IdeyaNest/1.0", "203.0.113.7"));
        ProviderIdentity link = providerIdentities.save(ProviderIdentity.link(
                userId, IdentityProvider.GOOGLE, "google-subject-" + SEQUENCE.incrementAndGet(), now));
        EmailChangeRequest change = emailChanges.save(EmailChangeRequest.issue(
                userId,
                EmailAddress.of("moving" + SEQUENCE.incrementAndGet() + "@example.com"),
                randomBytes(32),
                now.plus(Duration.ofDays(1))));
        return new SignInData(userId, code.getId(), challenge.getId(), link.getId(), change.getId());
    }

    private void assertGone(SignInData rows) {
        assertThat(twoFactorSecrets.existsById(rows.twoFactor())).isFalse();
        assertThat(recoveryCodes.existsById(rows.recoveryCode())).isFalse();
        assertThat(twoFactorChallenges.existsById(rows.challenge())).isFalse();
        assertThat(providerIdentities.existsById(rows.providerLink())).isFalse();
        assertThat(emailChanges.existsById(rows.emailChange())).isFalse();
    }

    private void assertKept(SignInData rows) {
        assertThat(twoFactorSecrets.existsById(rows.twoFactor())).isTrue();
        assertThat(recoveryCodes.existsById(rows.recoveryCode())).isTrue();
        assertThat(twoFactorChallenges.existsById(rows.challenge())).isTrue();
        assertThat(providerIdentities.existsById(rows.providerLink())).isTrue();
        assertThat(emailChanges.existsById(rows.emailChange())).isTrue();
    }

    private User row(UUID userId) {
        return users.findById(userId).orElseThrow();
    }

    private static Instant nowPlus(Duration duration) {
        return Instant.now().plus(duration);
    }

    // ------------------------------------------------------------------
    // The grace period is a grace period
    // ------------------------------------------------------------------

    @Test
    @DisplayName("nothing is touched before the grace period has elapsed")
    void nothingHappensInsideTheGracePeriod() {
        EmailAddress email = closingAccount();
        UUID userId = userId(email);

        job.anonymiseDueAccounts(nowPlus(WITHIN_THE_GRACE_PERIOD));
        // Asked directly as well, so that "nothing happened" is a decision about
        // this account and not a batch that happened to skip it.
        assertThat(anonymiser.anonymise(userId, nowPlus(WITHIN_THE_GRACE_PERIOD)))
                .isFalse();

        User user = row(userId);
        assertThat(user.isAnonymised()).isFalse();
        assertThat(user.getEmail()).isEqualTo(email);
        // Still recoverable, which is the entire purpose of the delay.
        assertThat(user.isDeletionPending()).isTrue();
        assertThat(credentials.findById(userId)).isPresent();
    }

    @Test
    @DisplayName("a cancelled deletion is never carried out")
    void cancellingRemovesTheAccountFromTheQueue() {
        EmailAddress email = closingAccount();
        UUID userId = userId(email);

        deletions.cancel(userId);

        // The job works from the schedule, so cancelling has to clear it. A
        // cancellation that only set a flag somewhere else would leave the
        // account queued and delete it a month later anyway.
        job.anonymiseDueAccounts(nowPlus(AFTER_THE_GRACE_PERIOD));
        assertThat(anonymiser.anonymise(userId, nowPlus(AFTER_THE_GRACE_PERIOD)))
                .isFalse();
        assertThat(row(userId).isAnonymised()).isFalse();
    }

    @Test
    @DisplayName("an account nobody asked to delete is never in the queue")
    void anUntouchedAccountIsNeverAnonymised() {
        UUID userId = userId(registeredUser());

        job.anonymiseDueAccounts(nowPlus(AFTER_THE_GRACE_PERIOD));

        assertThat(row(userId).isAnonymised()).isFalse();
    }

    // ------------------------------------------------------------------
    // Anonymisation
    // ------------------------------------------------------------------

    @Test
    @DisplayName("once the grace period has elapsed, identity is overwritten and the row survives")
    void theAccountIsAnonymisedNotDeleted() {
        EmailAddress email = closingAccount();
        UUID userId = userId(email);
        Instant runAt = nowPlus(AFTER_THE_GRACE_PERIOD);

        // At least this one. The count is not asserted: the suite shares a
        // database and other tests leave accounts that fall due in the same run.
        assertThat(job.anonymiseDueAccounts(runAt)).isPositive();

        // The row is still there, and that is the point. A pledge is a financial
        // record; "pledge #123 was made by user X" has to stay true after X
        // leaves, and every such row is a foreign key to this one.
        User user = row(userId);
        assertThat(user.isAnonymised()).isTrue();
        assertThat(user.getId()).isEqualTo(userId);
        assertThat(user.getCreatedAt()).isNotNull();

        // Nothing identifying survives.
        assertThat(user.getEmail().value()).isEqualTo("deleted-" + userId.toString().replace("-", "")
                // RFC 2606 reserves .invalid, so no queue or retry anywhere can
                // ever deliver to this address by accident.
                + "@anonymised.invalid");
        assertThat(user.getName()).isEqualTo(User.ANONYMOUS_NAME);
        assertThat(user.getSlug()).startsWith("deleted-");
        assertThat(user.getSlug()).doesNotContain("test");
        assertThat(user.getAvatarUrl()).isNull();
        assertThat(user.getBio()).isNull();
        assertThat(user.getEmailVerifiedAt()).isNull();
        // Soft-deleted at the same moment, which is what keeps it out of every
        // finder in the module — and a database constraint refuses the pair the
        // other way round.
        assertThat(user.getDeletedAt()).isNotNull().isEqualTo(user.getAnonymisedAt());

        // The credential goes outright. It is not a record of anything; it is a
        // hash of a password the person probably uses elsewhere.
        assertThat(credentials.findById(userId)).isEmpty();
        // So do the links, each of which is a key to a door that no longer opens.
        assertThat(verificationTokens.findByUserIdOrderByCreatedAt(userId)).isEmpty();

        // Sessions stay, stripped. That one existed and when it ended is a
        // security record with no person left in it; the IP address is the
        // person, so the IP address goes.
        assertThat(sessions.findByUserIdOrderByCreatedAtDesc(userId))
                .isNotEmpty()
                .allSatisfy(session -> {
                    assertThat(session.getIpAddress()).isNull();
                    assertThat(session.getUserAgent()).isNull();
                    assertThat(session.getDeviceLabel()).isNull();
                    assertThat(session.getCreatedAt()).isNotNull();
                });

        // Refresh token rows are untouched: a SHA-256 of 256 bits we generated
        // identifies nobody, and V2 keeps spent tokens so that a replay stays
        // distinguishable from a token that never existed.
        assertThat(sessions.findByUserIdOrderByCreatedAtDesc(userId))
                .allSatisfy(session -> assertThat(refreshTokens.findBySessionIdOrderByIssuedAtAscIdAsc(session.getId()))
                        .isNotEmpty());
    }

    @Test
    @DisplayName("anonymisation deletes the account's push registrations and nobody else's")
    void pushRegistrationsGoWithTheIdentity() {
        // #643. push_devices cascades from users, and that cascade never fires because the
        // row is never deleted -- so without the anonymiser asking, these would wait out the
        // 180-day retention sweep under an identifier whose person asked to be forgotten.
        EmailAddress email = registeredUser();
        signIn(email);
        EmailAddress bystander = registeredUser();
        String bystanderPhone = pushToken();
        assertThat(registerDevice(accessToken(signIn(bystander)), bystanderPhone, "ios").getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        UUID userId = userId(email);
        UUID bystanderId = userId(bystander);
        deletions.request(userId, PASSWORD);

        // The request deletes them now (#645), and a closing account cannot register again, so
        // these are what an account closed before #645 still has: written in directly, because
        // no endpoint can put them there any more.
        String phone = pushToken();
        String tablet = pushToken();
        pushDevices.save(PushDevice.register(userId, phone, DevicePlatform.IOS, null, null, Instant.now()));
        pushDevices.save(PushDevice.register(userId, tablet, DevicePlatform.ANDROID, null, null, Instant.now()));

        assertThat(anonymiser.anonymise(userId, nowPlus(WITHIN_THE_GRACE_PERIOD))).isFalse();
        assertThat(pushDevices.findByUserId(userId)).hasSize(2);

        assertThat(anonymiser.anonymise(userId, nowPlus(AFTER_THE_GRACE_PERIOD))).isTrue();

        assertThat(pushDevices.findByUserId(userId)).isEmpty();
        assertThat(pushDevices.findByToken(phone)).isEmpty();
        assertThat(pushDevices.findByToken(tablet)).isEmpty();
        // Deleted by account, not by anything wider.
        assertThat(pushDevices.findByUserId(bystanderId))
                .singleElement()
                .satisfies(device -> assertThat(device.getToken()).isEqualTo(bystanderPhone));
    }

    @Test
    @DisplayName("requesting deletion deletes the account's push registrations at once, and nobody else's")
    void requestingDeletionForgetsPushRegistrationsAtOnce() {
        // #645. The sessions end when deletion is requested; without this the registrations
        // stayed for the thirty days of the grace period, and a notification addressed to the
        // closing account kept reaching a phone it may no longer control.
        EmailAddress email = registeredUser();
        String accessToken = accessToken(signIn(email));
        String phone = pushToken();
        String tablet = pushToken();
        assertThat(registerDevice(accessToken, phone, "ios").getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(registerDevice(accessToken, tablet, "android").getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        EmailAddress bystander = registeredUser();
        String bystanderPhone = pushToken();
        assertThat(registerDevice(accessToken(signIn(bystander)), bystanderPhone, "ios").getStatusCode())
                .isEqualTo(HttpStatus.CREATED);

        UUID userId = userId(email);
        UUID bystanderId = userId(bystander);
        assertThat(deletions.request(userId, PASSWORD)).isPresent();

        assertThat(pushDevices.findByUserId(userId)).isEmpty();
        assertThat(pushDevices.findByToken(phone)).isEmpty();
        assertThat(pushDevices.findByToken(tablet)).isEmpty();
        assertThat(pushDevices.findByUserId(bystanderId))
                .singleElement()
                .satisfies(device -> assertThat(device.getToken()).isEqualTo(bystanderPhone));

        // Nor can they come back inside the grace period: signing in is the way back, but the
        // token it issues carries the deletion claim, and registering a device is not one of
        // the three things a closing account may do.
        assertThat(registerDevice(accessToken(signIn(email)), phone, "ios").getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(pushDevices.findByUserId(userId)).isEmpty();

        // A cancellation does not restore them; the application's next signed-in launch does,
        // with a token issued after the cancellation.
        deletions.cancel(userId);
        assertThat(registerDevice(accessToken(signIn(email)), phone, "ios").getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
        assertThat(pushDevices.findByUserId(userId)).hasSize(1);
    }

    @Test
    @DisplayName("anonymisation deletes the second factor, provider links and address changes, and nobody else's")
    void signInDataGoesWithTheIdentity() {
        // #645. Each of these tables cascades from users, and the cascade never fires: a TOTP
        // secret and recovery codes are credentials for an account nobody can sign in to, a
        // challenge carries a device, user agent and IP address, a provider link is the
        // person's identifier at Google or Apple, and an address change is a capability plus
        // an address.
        EmailAddress email = closingAccount();
        UUID userId = userId(email);
        SignInData closing = signInDataFor(userId);
        SignInData bystander = signInDataFor(userId(registeredUser()));

        // Inside the grace period nothing is touched: a cancellation restores the account
        // whole, second factor and Google sign-in included.
        assertThat(anonymiser.anonymise(userId, nowPlus(WITHIN_THE_GRACE_PERIOD))).isFalse();
        assertKept(closing);

        assertThat(anonymiser.anonymise(userId, nowPlus(AFTER_THE_GRACE_PERIOD))).isTrue();

        assertGone(closing);
        // Deleted by account, not by anything wider.
        assertKept(bystander);
    }

    @Test
    @DisplayName("running the job again changes nothing")
    void anonymisationIsIdempotent() {
        EmailAddress email = closingAccount();
        UUID userId = userId(email);

        assertThat(anonymiser.anonymise(userId, nowPlus(AFTER_THE_GRACE_PERIOD))).isTrue();
        Instant firstRun = row(userId).getAnonymisedAt();

        // What happens on every other instance, and after every restart. It has
        // to find nothing to do rather than rewrite the row with a later
        // timestamp — or worse, run forget() against an account whose sessions
        // some other tenant of that identifier now owns.
        assertThat(anonymiser.anonymise(userId, nowPlus(AFTER_THE_GRACE_PERIOD.plusDays(1))))
                .isFalse();
        job.anonymiseDueAccounts(nowPlus(AFTER_THE_GRACE_PERIOD.plusDays(1)));

        assertThat(row(userId).getAnonymisedAt()).isEqualTo(firstRun);
    }

    @Test
    @DisplayName("an anonymised account cannot be signed in to")
    void anAnonymisedAccountCannotSignIn() {
        EmailAddress email = closingAccount();

        job.anonymiseDueAccounts(nowPlus(AFTER_THE_GRACE_PERIOD));

        assertThat(signIn(email).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // The address
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the address is held through the grace period and released by anonymisation")
    void theAddressIsReleasedOnlyWhenNothingLinksItToTheOldAccount() {
        EmailAddress email = closingAccount();
        UUID original = userId(email);

        // While the deletion is pending the row still holds the address, so it
        // is not free. It must not be: the account can still come back, and
        // whoever registered it in the meantime would be sitting on top of it.
        assertThat(users.existsByEmail(email)).isTrue();

        job.anonymiseDueAccounts(nowPlus(AFTER_THE_GRACE_PERIOD));

        // Afterwards nothing anywhere maps this address to the old account —
        // the address was overwritten, the credential deleted, and every
        // outstanding link removed — so holding it in reserve would mean keeping
        // the address, or a hash of it, forever. Retaining personal data in
        // order to prove we no longer hold it is not anonymisation.
        assertThat(users.existsByEmail(email)).isFalse();

        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Someone Else"),
                String.class);

        UUID reused = userId(email);
        // A new account, with a new identifier. It inherits nothing: the old
        // rows still point at the old identifier, which is exactly why the old
        // row had to survive.
        assertThat(reused).isNotEqualTo(original);
        assertThat(row(reused).isAnonymised()).isFalse();
    }
}
