package az.ideanest.payment;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.AbstractIntegrationTest;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * #359: Payriff sends the backer's browser to the callback address with a GET, and this sends it on.
 *
 * <p>A client that never follows redirects, because the assertion is the redirect itself.
 */
class ProviderReturnApiTests extends AbstractIntegrationTest {

    private static final String SITE = "http://localhost:3000/";

    @LocalServerPort
    private int port;

    private final HttpClient browser = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

    @Test
    @DisplayName("a return address on the site is where the backer goes next")
    void aSiteAddressIsFollowed() throws Exception {
        String back = "http://localhost:3000/en/pledges/01a125c0-1014-78ab-aa0f-cb16655b6936?payment=returned";

        HttpResponse<Void> answer = get("payriff", back);

        assertThat(answer.statusCode()).isEqualTo(303);
        assertThat(answer.headers().firstValue("location")).contains(back);
    }

    @Test
    @DisplayName("an address with several parameters arrives whole, as the native app's return needs")
    void severalParametersSurvive() throws Exception {
        String back = "http://localhost:3000/en/pledges/x?payment=returned&via=app";

        HttpResponse<Void> answer = get("payriff", back);

        assertThat(answer.headers().firstValue("location")).contains(back);
    }

    @Test
    @DisplayName("a return that is not base64url, as an attacker would write it, goes to the site")
    void aPlainAddressIsNotTrusted() throws Exception {
        String query = "?return=" + URLEncoder.encode("http://localhost:3000/en/x", StandardCharsets.UTF_8);
        HttpResponse<Void> answer = browser.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v1/webhooks/psp/payriff" + query))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.discarding());

        assertThat(answer.statusCode()).isEqualTo(303);
        assertThat(answer.headers().firstValue("location")).contains(SITE);
    }

    @Test
    @DisplayName("an address off the site goes to the site instead, so the endpoint is not an open redirect")
    void anAddressOffTheSiteIsNotFollowed() throws Exception {
        for (String back : new String[] {"https://evil.example/steal", "javascript:alert(1)", "//evil.example/", "not a uri"}) {
            HttpResponse<Void> answer = get("payriff", back);

            assertThat(answer.statusCode()).as(back).isEqualTo(303);
            assertThat(answer.headers().firstValue("location")).as(back).contains(SITE);
        }
    }

    @Test
    @DisplayName("no return address goes to the site")
    void noAddressGoesToTheSite() throws Exception {
        HttpResponse<Void> answer = get("payriff", null);

        assertThat(answer.statusCode()).isEqualTo(303);
        assertThat(answer.headers().firstValue("location")).contains(SITE);
    }

    @Test
    @DisplayName("every provider name gets the same answer, so a GET reveals no adapter")
    void everyProviderNameIsAnsweredAlike() throws Exception {
        String back = "http://localhost:3000/en/pledges/x?payment=returned";

        for (String provider : new String[] {"payriff", "epoint", "azericard", "nobody"}) {
            HttpResponse<Void> answer = get(provider, back);

            assertThat(answer.statusCode()).as(provider).isEqualTo(303);
            assertThat(answer.headers().firstValue("location")).as(provider).contains(back);
        }
    }

    private HttpResponse<Void> get(String provider, String back) throws Exception {
        String query = back == null
                ? ""
                : "?return=" + Base64.getUrlEncoder().withoutPadding().encodeToString(back.getBytes(StandardCharsets.UTF_8));
        HttpRequest request = HttpRequest.newBuilder(
                        URI.create("http://localhost:" + port + "/v1/webhooks/psp/" + provider + query))
                .GET()
                .build();
        return browser.send(request, HttpResponse.BodyHandlers.discarding());
    }
}
