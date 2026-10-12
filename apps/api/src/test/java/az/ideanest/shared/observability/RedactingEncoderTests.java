package az.ideanest.shared.observability;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.encoder.JsonEncoder;
import ch.qos.logback.classic.encoder.PatternLayoutEncoder;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.core.encoder.Encoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Redaction where it has to happen: in the pipeline, not at the call site.
 *
 * <p>Every test here encodes the same event <em>twice</em> — once with the bare
 * delegate and once through {@link RedactingEncoder} — and asserts that the bare
 * encoder does write the secret. Without that half, "the output does not contain
 * the password" would also pass for an encoder that wrote nothing, for a log
 * level that suppressed the event, and for a test whose input was wrong.
 */
class RedactingEncoderTests {

    private static final String MARKER = "checkout-line";

    private LoggerContext context;

    @BeforeEach
    void startContext() {
        context = new LoggerContext();
        context.start();
    }

    @AfterEach
    void stopContext() {
        context.stop();
    }

    @Test
    @DisplayName("the console encoder masks what the delegate would have written")
    void masksThePatternLayoutOutput() {
        ILoggingEvent event = event("%s sign-in for nurlan@example.com".formatted(MARKER), null, Map.of());

        assertThat(encodeWith(patternEncoder(), event)).contains(MARKER).contains("nurlan@example.com");
        assertThat(encodeWith(redacting(patternEncoder()), event))
                .contains(MARKER)
                .doesNotContain("nurlan@example.com")
                .contains(Redaction.MASK);
    }

    @Test
    @DisplayName("the JSON encoder masks what the delegate would have written")
    void masksTheJsonOutput() {
        ILoggingEvent event = event("%s password=correct-horse".formatted(MARKER), null, Map.of());

        assertThat(encodeWith(jsonEncoder(), event)).contains(MARKER).contains("correct-horse");
        assertThat(encodeWith(redacting(jsonEncoder()), event))
                .contains(MARKER)
                .doesNotContain("correct-horse");
    }

    @Test
    @DisplayName("a value nested inside a logged object is masked")
    void masksNestedObjects() {
        Object pledge = new Object() {
            @Override
            public String toString() {
                return "DraftPledge[backer=User[email=nurlan@example.com, name=Nurlan Aliyev], amount=50.00]";
            }
        };
        ILoggingEvent event = event(MARKER + " " + pledge, null, Map.of());

        assertThat(encodeWith(jsonEncoder(), event)).contains("Nurlan Aliyev");
        assertThat(encodeWith(redacting(jsonEncoder()), event))
                .contains(MARKER)
                .doesNotContain("nurlan@example.com", "Nurlan Aliyev");
    }

    @Test
    @DisplayName("an exception message and its stack trace are masked")
    void masksThrowables() {
        IllegalStateException cause = new IllegalStateException("card 4111111111111111 was declined");
        RuntimeException thrown = new RuntimeException("charge failed for +994 50 123 45 67", cause);
        ILoggingEvent event = event(MARKER + " charge failed", thrown, Map.of());

        String bare = encodeWith(patternEncoder(), event);
        assertThat(bare)
                .contains("4111111111111111")
                .contains("+994 50 123 45 67")
                // The stack trace was actually rendered, so masking it is a real
                // requirement rather than a vacuous one.
                .contains("Caused by")
                .contains("az.ideanest.shared.observability.RedactingEncoderTests");

        assertThat(encodeWith(redacting(patternEncoder()), event))
                .contains(MARKER)
                .contains("Caused by")
                .contains("az.ideanest.shared.observability.RedactingEncoderTests")
                .doesNotContain("4111111111111111", "+994 50 123 45 67");
    }

    @Test
    @DisplayName("#394: an IBAN is masked written solid and printed in groups, and its hint is not")
    void masksIbans() {
        ILoggingEvent event = event(
                "%s paying AZ21NABZ00000000137010001944, statement shows AZ21 NABZ 0000 0000 1370 1000 1944"
                        .formatted(MARKER),
                null,
                Map.of());

        assertThat(encodeWith(patternEncoder(), event))
                .contains("AZ21NABZ00000000137010001944")
                .contains("AZ21 NABZ 0000 0000 1370 1000 1944");
        assertThat(encodeWith(redacting(patternEncoder()), event))
                .contains(MARKER)
                .doesNotContain("NABZ00000000137010001944", "NABZ 0000 0000 1370 1000 1944", "1370 1000");

        // The masked hint is what every screen and audit row carries instead, and it is too
        // short to be an account number. Asked of the rules directly, so the platform's default
        // charset cannot decide the answer.
        assertThat(Redaction.redact("account=AZ21…1944 filed")).isEqualTo("account=AZ21…1944 filed");
    }

    @Test
    @DisplayName("a value that reached the MDC is masked too")
    void masksMdcValues() {
        Map<String, String> mdc = new LinkedHashMap<>();
        mdc.put(Correlation.REQUEST_ID, "0192f0c1-8f3a-7c2b-9d4e-1a2b3c4d5e6f");
        mdc.put("email", "nurlan@example.com");
        ILoggingEvent event = event(MARKER + " reached the appender", null, mdc);

        assertThat(encodeWith(jsonEncoder(), event)).contains("nurlan@example.com");
        assertThat(encodeWith(redacting(jsonEncoder()), event))
                .contains(MARKER)
                // The correlation identifier is the point of the line and is not
                // personal data. It stays.
                .contains("0192f0c1-8f3a-7c2b-9d4e-1a2b3c4d5e6f")
                .doesNotContain("nurlan@example.com");
    }

    @Test
    @DisplayName("an encoder with nothing to wrap refuses to start")
    void refusesToStartWithoutADelegate() {
        RedactingEncoder encoder = new RedactingEncoder();
        encoder.setContext(context);

        encoder.start();

        assertThat(encoder.isStarted()).isFalse();
    }

    private ILoggingEvent event(String message, Throwable throwable, Map<String, String> mdc) {
        Logger logger = context.getLogger("az.ideanest.pledge.application.PledgeService");
        LoggingEvent event = new LoggingEvent(Logger.class.getName(), logger, Level.INFO, message, throwable, null);
        event.setMDCPropertyMap(mdc);
        return event;
    }

    private Encoder<ILoggingEvent> patternEncoder() {
        PatternLayoutEncoder encoder = new PatternLayoutEncoder();
        encoder.setContext(context);
        encoder.setPattern("%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{39} : %msg%n%ex");
        encoder.start();
        return encoder;
    }

    private Encoder<ILoggingEvent> jsonEncoder() {
        JsonEncoder encoder = new JsonEncoder();
        encoder.setContext(context);
        encoder.start();
        return encoder;
    }

    private RedactingEncoder redacting(Encoder<ILoggingEvent> delegate) {
        RedactingEncoder encoder = new RedactingEncoder();
        encoder.setContext(context);
        encoder.setEncoder(delegate);
        encoder.start();
        return encoder;
    }

    private static String encodeWith(Encoder<ILoggingEvent> encoder, ILoggingEvent event) {
        return new String(encoder.encode(event), StandardCharsets.UTF_8);
    }
}
