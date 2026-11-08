package az.ideanest.user;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.application.MediaProcessingJob;
import az.ideanest.media.infrastructure.MediaAssetRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.LocalObjectStore;
import az.ideanest.support.ScriptedImageTranscoder;
import az.ideanest.user.infrastructure.UserRepository;
import java.nio.charset.StandardCharsets;
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
 * A profile picture that is replaced or removed takes its upload with it (#649).
 *
 * <p>Until #649 {@code PATCH /v1/me/profile} overwrote {@code avatar_url} and left the previous
 * upload in the store, at its public address, for good. Everything here goes through the real
 * upload pipeline and the endpoint both clients call, as {@code AccountAnonymisationTests} does
 * for the deletion at anonymisation (#647), because the rules are the same ones: only the
 * account's own upload, served at exactly the old address, and shown by no campaign.
 *
 * <p>The deletion happens after the commit, and {@link TestRestTemplate} returns only once the
 * request has finished, commit included, so every assertion below reads the state after it.
 */
class AvatarReplacementApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** A JPEG signature and some filler. The scripted transcoder copies rather than reads. */
    private static final byte[] PHOTO = "ÿØÿa photograph".getBytes(StandardCharsets.ISO_8859_1);

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private LocalObjectStore objectStore;

    @Autowired
    private ScriptedImageTranscoder transcoder;

    @Autowired
    private MediaProcessingJob mediaProcessing;

    @Autowired
    private MediaAssetRepository mediaAssets;

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A registered account, signed in. */
    private record Account(UUID id, String accessToken) {
    }

    private Account account() {
        EmailAddress email = EmailAddress.of("avatar-replace" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        assertThat(signedIn.getStatusCode()).isEqualTo(HttpStatus.OK);
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account(id, (String) signedIn.getBody().get("accessToken"));
    }

    /** An upload that has been through the whole pipeline: its identifier and its public address. */
    private record Upload(UUID mediaId, String url) {

        /** The object behind the address, as the store keys it. */
        String key() {
            return url.substring("https://cdn.test/".length());
        }
    }

    /** Begins, uploads, completes and sweeps: what a browser does, in one call. */
    private Upload upload(Account account) {
        transcoder.reset();
        ResponseEntity<Map<String, Object>> issued = exchange(
                "/v1/media/uploads",
                HttpMethod.POST,
                account,
                Map.of("contentType", "image/jpeg", "byteSize", PHOTO.length));
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        UUID mediaId = UUID.fromString((String) issued.getBody().get("mediaId"));
        objectStore.put(MediaLibrary.rawKeyOf(mediaId), PHOTO);
        exchange("/v1/media/" + mediaId + "/complete", HttpMethod.POST, account, null);
        mediaProcessing.run();

        Map<String, Object> ready = exchange("/v1/media/" + mediaId, HttpMethod.GET, account, null).getBody();
        assertThat(ready).containsEntry("status", "READY");
        Upload upload = new Upload(mediaId, (String) ready.get("url"));
        assertThat(objectStore.has(upload.key())).isTrue();
        return upload;
    }

    /** Saves an address as the profile picture, the way both clients do after an upload. */
    private void useAsAvatar(Account account, String url) {
        assertThat(exchange("/v1/me/profile", HttpMethod.PATCH, account, Map.of("avatarUrl", url))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    /**
     * Removes the profile picture. Written as JSON rather than as a map: {@code Map.of} cannot
     * hold a null, and an explicit null is what "remove" is on this endpoint.
     */
    private void removeAvatar(Account account) {
        assertThat(exchange("/v1/me/profile", HttpMethod.PATCH, account, "{\"avatarUrl\":null}")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    /** A draft campaign with this upload as its cover. */
    private void useAsCover(Account account, UUID mediaId) {
        ResponseEntity<Map<String, Object>> created =
                exchange("/v1/projects", HttpMethod.POST, account, Map.of("title", "A campaign that stays"));
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(exchange(
                                "/v1/projects/" + created.getBody().get("id"),
                                HttpMethod.PATCH,
                                account,
                                Map.of("coverImage", Map.of("mediaId", mediaId.toString())))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    private String avatarOf(Account account) {
        return users.findById(account.id()).orElseThrow().getAvatarUrl();
    }

    private void assertGone(Upload upload) {
        assertThat(objectStore.has(upload.key())).as("object of %s", upload.mediaId()).isFalse();
        assertThat(mediaAssets.existsById(upload.mediaId())).as("row of %s", upload.mediaId()).isFalse();
    }

    private void assertKept(Upload upload) {
        assertThat(objectStore.has(upload.key())).as("object of %s", upload.mediaId()).isTrue();
        assertThat(mediaAssets.existsById(upload.mediaId())).as("row of %s", upload.mediaId()).isTrue();
    }

    private ResponseEntity<Map<String, Object>> exchange(
            String path, HttpMethod method, Account account, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(account.accessToken());
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    // ------------------------------------------------------------------
    // Replaced and removed
    // ------------------------------------------------------------------

    @Test
    @DisplayName("replacing the avatar deletes the previous upload and keeps the new one")
    void replacingTheAvatarDeletesThePreviousUpload() {
        Account account = account();
        Upload before = upload(account);
        useAsAvatar(account, before.url());
        Upload after = upload(account);

        useAsAvatar(account, after.url());

        assertThat(avatarOf(account)).isEqualTo(after.url());
        assertGone(before);
        assertKept(after);
    }

    @Test
    @DisplayName("removing the avatar deletes its upload")
    void removingTheAvatarDeletesItsUpload() {
        Account account = account();
        Upload avatar = upload(account);
        useAsAvatar(account, avatar.url());

        removeAvatar(account);

        assertThat(avatarOf(account)).isNull();
        assertGone(avatar);
    }

    @Test
    @DisplayName("saving the avatar the profile already shows deletes nothing, however the address is written")
    void reSavingTheSameAvatarKeepsIt() {
        Account account = account();
        Upload avatar = upload(account);
        useAsAvatar(account, avatar.url());

        useAsAvatar(account, avatar.url());
        assertThat(avatarOf(account)).isEqualTo(avatar.url());
        assertKept(avatar);

        // The same upload behind a different address: the address changed, the picture did not.
        String sameUpload = avatar.url() + "?v=2";
        useAsAvatar(account, sameUpload);
        assertThat(avatarOf(account)).isEqualTo(sameUpload);
        assertKept(avatar);
    }

    // ------------------------------------------------------------------
    // What is never deleted
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an old avatar that a campaign also uses as its cover is kept")
    void anOldAvatarACampaignAlsoShowsIsKept() {
        Account account = account();
        Upload both = upload(account);
        useAsCover(account, both.mediaId());
        useAsAvatar(account, both.url());
        Upload replacement = upload(account);

        useAsAvatar(account, replacement.url());

        // The profile lets go of it; the campaign does not.
        assertThat(avatarOf(account)).isEqualTo(replacement.url());
        assertKept(both);
    }

    @Test
    @DisplayName("another account's upload, used as an avatar and then replaced, is never touched")
    void anotherAccountsUploadIsNeverTouched() {
        Account owner = account();
        Upload ownersAvatar = upload(owner);
        useAsAvatar(owner, ownersAvatar.url());

        // The profile takes any https address, an address copied from somebody else's profile
        // included. Replacing it must not delete the other person's picture.
        Account copier = account();
        useAsAvatar(copier, ownersAvatar.url());
        Upload copiersOwn = upload(copier);
        useAsAvatar(copier, copiersOwn.url());
        removeAvatar(copier);

        assertThat(avatarOf(owner)).isEqualTo(ownersAvatar.url());
        assertKept(ownersAvatar);
        // The copier's own upload is theirs, and it went when they removed it.
        assertGone(copiersOwn);
    }

    @Test
    @DisplayName("an avatar hosted elsewhere, or whose file is already gone, does not stop the save")
    void aForeignOrMissingAvatarDoesNotStopTheSave() {
        Account account = account();
        useAsAvatar(account, "https://pictures.example.com/me.jpg");
        Upload avatar = upload(account);
        // From a picture this platform never had to one it has: nothing to delete, and no error.
        useAsAvatar(account, avatar.url());
        assertThat(avatarOf(account)).isEqualTo(avatar.url());

        // Gone from the store already. Deleting an absent object is a success.
        objectStore.delete(avatar.key());
        removeAvatar(account);

        assertThat(avatarOf(account)).isNull();
        assertThat(mediaAssets.existsById(avatar.mediaId())).isFalse();
    }

    @Test
    @DisplayName("a store that refuses the deletion does not fail the profile update")
    void aStoreOutageDoesNotFailTheSave() {
        Account account = account();
        Upload before = upload(account);
        useAsAvatar(account, before.url());
        Upload after = upload(account);

        objectStore.refuseDeletes(true);
        try {
            useAsAvatar(account, after.url());
        } finally {
            objectStore.refuseDeletes(false);
        }

        // Saved and answered 200 (useAsAvatar asserts it). The deletion was attempted after the
        // commit -- the row is gone -- and the object the store refused is left orphaned and
        // logged, not retried and not reported to the person saving their profile.
        assertThat(avatarOf(account)).isEqualTo(after.url());
        assertThat(mediaAssets.existsById(before.mediaId())).isFalse();
        assertThat(objectStore.has(before.key())).isTrue();
        assertKept(after);
    }
}
