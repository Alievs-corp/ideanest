package az.ideanest.notification;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.notification.infrastructure.ExpoPushClient;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpResponse;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * What goes to Expo, on the wire — #87 and #160.
 *
 * <p>An interceptor answers in place of the service rather than {@code MockRestServiceServer},
 * because the client installs its own request factory for the timeouts, and that replaces the
 * one the mock server binds. An interceptor sits in front of whichever factory is installed and
 * never reaches the network.
 */
@DisplayName("Expo push client")
class ExpoPushClientTests {

    private static final String TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";

    private final List<byte[]> sent = new ArrayList<>();

    private final ExpoPushClient client = new ExpoPushClient(
            new NotificationProperties(null, null, null, null, null, null),
            RestClient.builder().requestInterceptor((request, body, execution) -> {
                sent.add(body);
                MockClientHttpResponse response = new MockClientHttpResponse(
                        """
                        {"data":[{"status":"ok","id":"x"}]}"""
                                .getBytes(StandardCharsets.UTF_8),
                        HttpStatus.OK);
                response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
                return response;
            }));

    @Test
    @DisplayName("sends data verbatim: url, type and the inbox row")
    void dataIsSentAsGiven() {
        String inbox = UUID.randomUUID().toString();
        Map<String, String> data = new LinkedHashMap<>();
        data.put("url", "ideanest://settings/sessions");
        data.put("type", "NEW_DEVICE_SIGN_IN");
        data.put("notificationId", inbox);

        List<ExpoPushClient.Ticket> tickets = client.send(
                List.of(new ExpoPushClient.Push(TOKEN, "A new sign-in", "Somebody signed in", data, "key")));

        assertThat(tickets).singleElement().satisfies(ticket -> assertThat(ticket.ok()).isTrue());

        JsonNode message = onlyMessage();
        assertThat(message.get("to").asString()).isEqualTo(TOKEN);
        assertThat(message.get("title").asString()).isEqualTo("A new sign-in");
        assertThat(message.get("body").asString()).isEqualTo("Somebody signed in");

        JsonNode sentData = message.get("data");
        assertThat(sentData.propertyNames()).containsExactly("url", "type", "notificationId");
        assertThat(sentData.get("url").asString()).isEqualTo("ideanest://settings/sessions");
        assertThat(sentData.get("type").asString()).isEqualTo("NEW_DEVICE_SIGN_IN");
        assertThat(sentData.get("notificationId").asString()).isEqualTo(inbox);
    }

    @Test
    @DisplayName("sends only the url when that is all there is")
    void aDigestSendsOnlyTheUrl() {
        client.send(List.of(new ExpoPushClient.Push(
                TOKEN, "Your digest", "Three things happened", Map.of("url", "ideanest://"), "key")));

        // Absent, not null: the application reads a missing key and a null one differently.
        JsonNode sentData = onlyMessage().get("data");
        assertThat(sentData.propertyNames()).containsExactly("url");
    }

    private JsonNode onlyMessage() {
        assertThat(sent).hasSize(1);
        JsonNode batch = JsonMapper.builder().build().readTree(sent.get(0));
        assertThat(batch.isArray()).isTrue();
        assertThat(batch.size()).isEqualTo(1);
        return batch.get(0);
    }
}
