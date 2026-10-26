package az.ideanest.discovery.api;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.discovery.application.DiscoveryQuery;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

/** How long a search text may be, checked without a database (#587). */
class DiscoveryQueryBinderTests {

    @Test
    @DisplayName("a search text longer than two hundred characters is cut to two hundred")
    void longTextIsCut() {
        MultiValueMap<String, String> parameters = new LinkedMultiValueMap<>();
        parameters.add("q", "a".repeat(50_000));

        DiscoveryQuery query = DiscoveryQueryBinder.bind(parameters, "az");

        // Every character of `q` goes through a full-text parse and a trigram match, so a
        // query string of tens of kilobytes was work any anonymous caller could buy.
        assertThat(query.text()).hasSize(DiscoveryQueryBinder.MAX_TEXT_LENGTH);
    }

    @Test
    @DisplayName("a text at the limit is kept whole, and a short one untouched")
    void textAtTheLimitIsKept() {
        String atTheLimit = "b".repeat(DiscoveryQueryBinder.MAX_TEXT_LENGTH);

        assertThat(DiscoveryQueryBinder.text(atTheLimit)).isEqualTo(atTheLimit);
        assertThat(DiscoveryQueryBinder.text("kitab")).isEqualTo("kitab");
        assertThat(DiscoveryQueryBinder.text(null)).isNull();
    }

    @Test
    @DisplayName("the cut never splits a character made of two code units")
    void theCutKeepsSurrogatePairsWhole() {
        String text = "c".repeat(DiscoveryQueryBinder.MAX_TEXT_LENGTH - 1) + "\uD83D\uDE00" + "tail";

        String cut = DiscoveryQueryBinder.text(text);

        assertThat(cut).hasSize(DiscoveryQueryBinder.MAX_TEXT_LENGTH - 1);
        assertThat(Character.isHighSurrogate(cut.charAt(cut.length() - 1))).isFalse();
    }
}
