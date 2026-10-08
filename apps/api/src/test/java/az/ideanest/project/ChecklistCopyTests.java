package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.api.ChecklistCopy;
import az.ideanest.project.domain.CampaignCompleteness;
import az.ideanest.project.domain.ChecklistItem;
import az.ideanest.project.domain.ChecklistRequirement;
import az.ideanest.project.domain.ChecklistResult;
import az.ideanest.project.domain.CoverImage;
import az.ideanest.project.domain.SubmissionChecklist;
import az.ideanest.project.domain.SubmissionLimits;
import az.ideanest.shared.ReaderLocale;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.context.support.ResourceBundleMessageSource;

/**
 * That the completeness checklist speaks every language, and says the same thing in each.
 *
 * <p>The bug this exists for: the checklist's labels and details were English sentences built in
 * the domain, and every client rendered them verbatim, so the Azerbaijani editor's review tab was
 * an English list. They are now {@code checklist.*} keys in {@code messages*.properties}, resolved
 * by {@link ChecklistCopy}. What can go wrong with that is quiet -- a missing row falls back to
 * English without an error, a placeholder nothing fills prints as {@code {0}}, an apostrophe
 * swallows the number after it -- so every row {@link SubmissionChecklist} can produce is rendered
 * here in every language and checked for each of those shapes.
 *
 * <p><strong>A plain unit test</strong>, like {@link SubmissionChecklistTests}: the message source
 * is built the way Spring Boot builds it ({@code messages} basename, UTF-8, no fallback to the
 * JVM's locale -- see {@code application.yml}), with no context and no container.
 */
class ChecklistCopyTests {

    private static final SubmissionLimits LIMITS =
            new SubmissionLimits(new BigDecimal("250.00"), new BigDecimal("50000.00"), new BigDecimal("2.00"));

    private static final List<Locale> LANGUAGES =
            ReaderLocale.SUPPORTED.stream().map(Locale::forLanguageTag).toList();

    private static final List<String> TRANSLATED =
            ReaderLocale.SUPPORTED.stream().filter(tag -> !"en".equals(tag)).toList();

    private static final Locale AZ = Locale.forLanguageTag("az");

    private static final String PREFIX = "checklist.";

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{(\\d+)");

    private final ChecklistCopy copy = new ChecklistCopy(messageSource());

    // ------------------------------------------------------------------
    // Every row, rendered
    // ------------------------------------------------------------------

    @ParameterizedTest
    @EnumSource(ChecklistRequirement.class)
    @DisplayName("every requirement has a label in every language")
    void everyRequirementIsNamed(ChecklistRequirement requirement) throws IOException {
        for (String file : bundleFiles()) {
            assertThat(bundle(file).getProperty(PREFIX + requirement.name() + ".label"))
                    .as("%s names %s", file, requirement)
                    .isNotBlank();
        }
    }

    @Test
    @DisplayName("every detail the checklist can produce renders completely in every language")
    void everyDetailRenders() {
        for (Locale locale : LANGUAGES) {
            for (ChecklistItem item : everyUnmetItem()) {
                String detail = copy.detail(item, locale);
                String key = keyOf(item);

                assertThat(detail).as("%s in %s", key, locale).isNotBlank();
                assertThat(detail).as("%s fills every placeholder in %s", key, locale).doesNotContain("{");
                assertThat(detail).as("%s has no null fact in %s", key, locale).doesNotContain("null");
                assertThat(detail).as("%s has no stray quote in %s", key, locale).doesNotContain("'");
                assertThat(detail).as("%s leaves no gap in %s", key, locale).doesNotContain("  ");

                // The campaign's own numbers are what make a row actionable, and money is quoted
                // exactly as SubmissionChecklist wrote it -- never through a number format.
                for (Object argument : item.detail().arguments()) {
                    assertThat(detail)
                            .as("%s quotes %s in %s", key, argument, locale)
                            .contains(String.valueOf(argument));
                }
            }
        }
    }

    @Test
    @DisplayName("every checklist key in the bundle is one the checklist can actually produce")
    void noKeyIsOrphaned() throws IOException {
        Set<String> produced = everyUnmetItem().stream().map(ChecklistCopyTests::keyOf).collect(Collectors.toSet());
        for (ChecklistRequirement requirement : ChecklistRequirement.values()) {
            produced.add(PREFIX + requirement.name() + ".label");
        }

        assertThat(new TreeSet<>(checklistKeys(bundle("messages.properties"))))
                .as("the English checklist keys are exactly the ones SubmissionChecklist produces")
                .isEqualTo(new TreeSet<>(produced));
    }

    // ------------------------------------------------------------------
    // The bundles themselves
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every language carries exactly the checklist keys English does")
    void everyLanguageIsComplete() throws IOException {
        Set<String> english = checklistKeys(bundle("messages.properties"));

        for (String tag : TRANSLATED) {
            Set<String> translated = checklistKeys(bundle("messages_" + tag + ".properties"));
            assertThat(new TreeSet<>(translated))
                    .as("messages_%s carries the same checklist keys as English", tag)
                    .isEqualTo(new TreeSet<>(english));
        }
    }

    @Test
    @DisplayName("a translation quotes exactly the arguments its English key does")
    void placeholdersAgree() throws IOException {
        Properties english = bundle("messages.properties");

        for (String tag : TRANSLATED) {
            Properties translated = bundle("messages_" + tag + ".properties");
            for (String key : checklistKeys(english)) {
                assertThat(placeholders(translated.getProperty(key)))
                        .as("%s %s uses the arguments English does", tag, key)
                        .isEqualTo(placeholders(english.getProperty(key)));
            }
        }
    }

    @Test
    @DisplayName("no checklist line carries an apostrophe, doubled or not")
    void noApostrophes() throws IOException {
        // A key with arguments is a MessageFormat pattern and one without is returned verbatim,
        // so no single spelling of an apostrophe is right for both. See messages.properties.
        for (String file : bundleFiles()) {
            Properties properties = bundle(file);
            for (String key : checklistKeys(properties)) {
                assertThat(properties.getProperty(key)).as("%s %s", file, key).doesNotContain("'");
            }
        }
    }

    @Test
    @DisplayName("Azerbaijani never glues a suffix onto a placeholder")
    void azerbaijaniSuffixesLandOnNouns() throws IOException {
        // "{0}-dan" reads its suffix off the last digit of a number nobody has seen yet, and is
        // wrong for half of them. The sentences are built so the suffix lands on a noun instead.
        Properties azerbaijani = bundle("messages_az.properties");
        for (String key : checklistKeys(azerbaijani)) {
            assertThat(azerbaijani.getProperty(key)).as(key).doesNotContainPattern("\\}[-\\p{L}]");
        }
    }

    // ------------------------------------------------------------------
    // What a reader actually sees
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an Azerbaijani reader reads the checklist in Azerbaijani")
    void azerbaijani() {
        ChecklistItem story = unmet(campaign().storyCharacters(140).build(), ChecklistRequirement.STORY);
        ChecklistItem cover = unmet(campaign().cover(null).build(), ChecklistRequirement.COVER_IMAGE);

        assertThat(copy.label(ChecklistRequirement.STORY, AZ)).isEqualTo("Hekayə");
        assertThat(copy.detail(story, AZ)).isEqualTo("Hekayə 140 simvoldan ibarətdir. Ən azı 500 simvol lazımdır.");
        assertThat(copy.label(ChecklistRequirement.COVER_IMAGE, AZ)).isEqualTo("Örtük şəkli");
        assertThat(copy.detail(cover, AZ))
                .isEqualTo("Örtük şəkli mütləqdir. Kampaniya göstərildiyi hər yerdə bu şəkillə təmsil olunur.");
    }

    @Test
    @DisplayName("English still reads as it did, and counts its plurals")
    void english() {
        Locale en = Locale.ENGLISH;
        ChecklistItem story = unmet(campaign().storyCharacters(140).build(), ChecklistRequirement.STORY);
        ChecklistItem oneCharacter = unmet(campaign().storyCharacters(1).build(), ChecklistRequirement.STORY);
        ChecklistItem oneUnderpriced = unmet(
                campaign().prices(List.of(new BigDecimal("0.10"), new BigDecimal("25.00"))).build(),
                ChecklistRequirement.REWARD_PRICES);
        ChecklistItem twoUnderpriced = unmet(
                campaign().prices(List.of(new BigDecimal("0.10"), new BigDecimal("1.00"))).build(),
                ChecklistRequirement.REWARD_PRICES);
        ChecklistItem goal = unmet(campaign().goal(new BigDecimal("10.00")).build(), ChecklistRequirement.GOAL);
        ChecklistItem cover = unmet(
                campaign().cover(new CoverImage("https://x/c.jpg", 800, 450)).build(),
                ChecklistRequirement.COVER_IMAGE_SIZE);

        assertThat(copy.label(ChecklistRequirement.COVER_IMAGE, en)).isEqualTo("Cover image");
        assertThat(copy.detail(story, en)).isEqualTo("The story is 140 characters. At least 500 are needed.");
        assertThat(copy.detail(oneCharacter, en)).startsWith("The story is 1 character.");
        assertThat(copy.detail(oneUnderpriced, en)).startsWith("1 reward is priced below 2 AZN,");
        assertThat(copy.detail(twoUnderpriced, en)).startsWith("2 rewards are priced below 2 AZN,");
        assertThat(copy.detail(goal, en))
                .isEqualTo("The goal is 10 AZN. The smallest goal a campaign can run with is 250 AZN.");
        // 1024, never 1,024: a dimension is quoted as written, not as a number.
        assertThat(copy.detail(cover, en)).startsWith("The cover image is 800×450. Anything below 1024×576 ");
    }

    @Test
    @DisplayName("a met requirement has no detail in any language")
    void aMetRequirementSaysNothing() {
        ChecklistItem met = ChecklistItem.met(ChecklistRequirement.STORY);
        for (Locale locale : LANGUAGES) {
            assertThat(copy.detail(met, locale)).isNull();
        }
    }

    @Test
    @DisplayName("the language is negotiated as every other localised read negotiates it")
    void negotiation() {
        assertThat(ChecklistCopy.localeOf("az")).isEqualTo(AZ);
        assertThat(ChecklistCopy.localeOf("ru-RU,ru;q=0.9,en;q=0.8")).isEqualTo(Locale.forLanguageTag("ru"));
        assertThat(ChecklistCopy.localeOf("en-GB")).isEqualTo(Locale.ENGLISH);
        assertThat(ChecklistCopy.localeOf("tr")).isEqualTo(Locale.forLanguageTag("tr"));
        // Absent, unsupported and malformed all answer in the primary language rather than fail.
        assertThat(ChecklistCopy.localeOf(null)).isEqualTo(AZ);
        assertThat(ChecklistCopy.localeOf("de-DE")).isEqualTo(AZ);
        assertThat(ChecklistCopy.localeOf(";;;q=nonsense")).isEqualTo(AZ);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /**
     * Every (requirement, reason) {@link SubmissionChecklist} can produce, at least once.
     *
     * <p>Three campaigns: one with nothing in it, one with everything overdone, and one whose
     * goal is too large. {@link #noKeyIsOrphaned} is what notices if a new reason is added
     * without a campaign here that produces it.
     */
    private static List<ChecklistItem> everyUnmetItem() {
        List<CampaignCompleteness> campaigns = List.of(
                new CampaignCompleteness(
                        null, null, null, null, null, null, "AZN", null, null, 0, 0, null, List.of()),
                campaign()
                        .title("t".repeat(61))
                        .summary("s".repeat(136))
                        .cover(new CoverImage("https://x/c.jpg", 800, 450))
                        .goal(new BigDecimal("10.00"))
                        .duration(61)
                        .storyCharacters(140)
                        .risks("r".repeat(80))
                        .prices(IntStream.range(0, 101)
                                .mapToObj(index -> new BigDecimal(index == 0 ? "0.10" : "10.00"))
                                .toList())
                        .build(),
                campaign().goal(new BigDecimal("75000.50")).build());

        List<ChecklistItem> items = new ArrayList<>();
        for (CampaignCompleteness campaign : campaigns) {
            SubmissionChecklist.evaluate(campaign, LIMITS).items().stream()
                    .filter(item -> !item.satisfied())
                    .forEach(items::add);
        }
        return items;
    }

    private static ChecklistItem unmet(CampaignCompleteness campaign, ChecklistRequirement requirement) {
        ChecklistResult result = SubmissionChecklist.evaluate(campaign, LIMITS);
        return result.items().stream()
                .filter(item -> item.requirement() == requirement && !item.satisfied())
                .findFirst()
                .orElseThrow(() -> new AssertionError(requirement + " was expected to be unmet"));
    }

    private static String keyOf(ChecklistItem item) {
        return PREFIX + item.requirement().name() + "." + item.detail().reason();
    }

    private static Set<Integer> placeholders(String pattern) {
        Set<Integer> found = new TreeSet<>();
        Matcher matcher = PLACEHOLDER.matcher(pattern);
        while (matcher.find()) {
            found.add(Integer.parseInt(matcher.group(1)));
        }
        return found;
    }

    private static Set<String> checklistKeys(Properties properties) {
        return properties.stringPropertyNames().stream()
                .filter(key -> key.startsWith(PREFIX))
                .collect(Collectors.toSet());
    }

    private static List<String> bundleFiles() {
        List<String> files = new ArrayList<>();
        files.add("messages.properties");
        TRANSLATED.forEach(tag -> files.add("messages_" + tag + ".properties"));
        return files;
    }

    /** One bundle read as the file it is, so a missing row is not hidden by the fallback. */
    private static Properties bundle(String name) throws IOException {
        Properties properties = new Properties();
        try (InputStream in = ChecklistCopyTests.class.getResourceAsStream("/" + name)) {
            assertThat(in).as("%s is on the classpath", name).isNotNull();
            properties.load(new InputStreamReader(in, StandardCharsets.UTF_8));
        }
        return properties;
    }

    /** As Spring Boot configures it from {@code spring.messages} in {@code application.yml}. */
    private static ResourceBundleMessageSource messageSource() {
        ResourceBundleMessageSource source = new ResourceBundleMessageSource();
        source.setBasename("messages");
        source.setDefaultEncoding(StandardCharsets.UTF_8.name());
        source.setFallbackToSystemLocale(false);
        return source;
    }

    private static Campaign campaign() {
        return new Campaign();
    }

    /** A complete campaign to break one thing in, as {@link SubmissionChecklistTests} builds one. */
    private static final class Campaign {

        private String title = "A field recorder for birdsong";
        private String summary = "A pocket recorder built for the dawn chorus.";
        private CoverImage cover = new CoverImage("https://cdn.example.com/cover.jpg", 1600, 900);
        private BigDecimal goal = new BigDecimal("5000.00");
        private Integer duration = 30;
        private int storyCharacters = 900;
        private String risks = "r".repeat(300);
        private List<BigDecimal> prices = List.of(new BigDecimal("25.00"), new BigDecimal("60.00"));

        Campaign title(String value) {
            this.title = value;
            return this;
        }

        Campaign summary(String value) {
            this.summary = value;
            return this;
        }

        Campaign cover(CoverImage value) {
            this.cover = value;
            return this;
        }

        Campaign goal(BigDecimal value) {
            this.goal = value;
            return this;
        }

        Campaign duration(Integer value) {
            this.duration = value;
            return this;
        }

        Campaign storyCharacters(int value) {
            this.storyCharacters = value;
            return this;
        }

        Campaign risks(String value) {
            this.risks = value;
            return this;
        }

        Campaign prices(List<BigDecimal> value) {
            this.prices = value;
            return this;
        }

        CampaignCompleteness build() {
            return new CampaignCompleteness(
                    title,
                    summary,
                    UUID.randomUUID(),
                    UUID.randomUUID(),
                    cover,
                    goal,
                    "AZN",
                    duration,
                    Instant.parse("2026-09-01T09:00:00Z"),
                    storyCharacters,
                    2,
                    risks,
                    prices);
        }
    }
}
