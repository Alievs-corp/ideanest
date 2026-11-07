package az.ideanest.analytics.domain;

import java.util.regex.Pattern;

/**
 * Whether a {@code User-Agent} is a machine rather than a reader — #633.
 *
 * <p>An audience figure counts people. Crawlers, link previews, uptime checks and
 * scripts all fetch pages, and a beacon reached by one of them would count it, so an
 * event whose agent says it is one writes nothing. The web client also skips sending
 * when {@code navigator.webdriver} is set, which catches automated browsers that
 * present an ordinary agent; this is the server's half.
 *
 * <p><strong>A blank agent is a machine.</strong> Every browser and both mobile clients
 * send one; the only callers that send none are scripts.
 *
 * <p>Deliberately not on the list: {@code okhttp}, which is what React Native on Android
 * sends — the app's own readers. And {@code cubot}, a phone brand whose model name ends
 * in "bot", is let through by the lookbehind.
 *
 * <p>A list, so it is never complete, and a bot that lies about itself is counted. That
 * is the accepted trade: the figures are for judging traffic, not for billing it.
 */
public final class BotUserAgents {

    private static final Pattern MACHINE = Pattern.compile(
            "(?<!cu)bot|crawl|spider|slurp|scrap|headless|phantomjs|lighthouse|pagespeed|gtmetrix"
                    + "|pingdom|uptime|monitor|preview|facebookexternalhit|meta-externalagent|embedly|whatsapp"
                    + "|ia_archiver|bytespider|gptbot|ccbot|anthropic-ai|claude-web|perplexity|python|curl/|wget"
                    + "|httpie|axios|node-fetch|undici|go-http-client|java/|apache-httpclient|libwww",
            Pattern.CASE_INSENSITIVE);

    private BotUserAgents() {
    }

    public static boolean isMachine(String userAgent) {
        return userAgent == null || userAgent.isBlank() || MACHINE.matcher(userAgent).find();
    }
}
