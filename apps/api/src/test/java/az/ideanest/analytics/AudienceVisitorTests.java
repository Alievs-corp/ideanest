package az.ideanest.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.analytics.domain.AudienceCountry;
import az.ideanest.analytics.domain.BotUserAgents;
import az.ideanest.analytics.domain.VisitorKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** #633's visitor key, bot filter and country header, without a database. */
class AudienceVisitorTests {

    private static final String CHROME =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

    @Test
    @DisplayName("the same reader on the same day is one key, and the next day's salt makes another")
    void aKeyIsStableForADayAndOnlyForADay() {
        byte[] today = VisitorKey.newSalt();
        byte[] tomorrow = VisitorKey.newSalt();

        byte[] first = VisitorKey.of(today, "203.0.113.7", CHROME);
        byte[] again = VisitorKey.of(today, "203.0.113.7", CHROME);
        byte[] nextDay = VisitorKey.of(tomorrow, "203.0.113.7", CHROME);

        assertThat(first).hasSize(VisitorKey.LENGTH).isEqualTo(again);
        assertThat(nextDay).isNotEqualTo(first);
        assertThat(VisitorKey.of(today, "203.0.113.8", CHROME)).isNotEqualTo(first);
        assertThat(VisitorKey.of(today, "203.0.113.7", CHROME + " Edg/131.0")).isNotEqualTo(first);
    }

    @Test
    @DisplayName("the key is keyed: an unsalted hash of the address and agent does not produce it")
    void theKeyIsNotAPlainHash() throws Exception {
        byte[] salt = VisitorKey.newSalt();
        byte[] plain = MessageDigest.getInstance("SHA-256")
                .digest(("203.0.113.7|" + CHROME).getBytes(StandardCharsets.UTF_8));

        assertThat(VisitorKey.of(salt, "203.0.113.7", CHROME)).isNotEqualTo(plain);
        assertThat(VisitorKey.newSalt()).hasSize(32).isNotEqualTo(salt);
        assertThatThrownBy(() -> VisitorKey.of(new byte[8], "203.0.113.7", CHROME))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest
    @DisplayName("crawlers, previews, monitors and scripts are machines")
    @ValueSource(strings = {
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        "TelegramBot (like TwitterBot)",
        "WhatsApp/2.23.20.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
        "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 Chrome-Lighthouse",
        "curl/8.4.0",
        "python-requests/2.31.0",
        "Go-http-client/1.1",
        "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)",
        "UptimeRobot/2.0",
        "",
        "   "
    })
    void machinesAreRecognised(String agent) {
        assertThat(BotUserAgents.isMachine(agent)).isTrue();
        assertThat(BotUserAgents.isMachine(null)).isTrue();
    }

    @ParameterizedTest
    @DisplayName("browsers and the mobile apps are readers")
    @ValueSource(strings = {
        CHROME,
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 14; 23078RKD5C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
        "okhttp/4.12.0",
        "IdeyaNest/1 CFNetwork/1568.100.1 Darwin/24.0.0",
        "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
    })
    void readersAreNotMachines(String agent) {
        assertThat(BotUserAgents.isMachine(agent)).isFalse();
    }

    @Test
    @DisplayName("Cloudflare's country is taken when it is one; XX, T1, ZZ, blank and junk are not")
    void cloudflareCountries() {
        assertThat(AudienceCountry.fromHeader("AZ")).contains("AZ");
        assertThat(AudienceCountry.fromHeader(" tr ")).contains("TR");
        assertThat(AudienceCountry.fromHeader("XX")).isEmpty();
        assertThat(AudienceCountry.fromHeader("T1")).isEmpty();
        assertThat(AudienceCountry.fromHeader("ZZ")).isEmpty();
        assertThat(AudienceCountry.fromHeader("")).isEmpty();
        assertThat(AudienceCountry.fromHeader(null)).isEmpty();
        assertThat(AudienceCountry.fromHeader("AZE")).isEmpty();
        assertThat(AudienceCountry.UNKNOWN).isEqualTo("ZZ");
    }
}
