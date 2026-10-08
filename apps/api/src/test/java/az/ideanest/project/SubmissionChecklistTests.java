package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.domain.CampaignCompleteness;
import az.ideanest.project.domain.ChecklistItem;
import az.ideanest.project.domain.ChecklistRequirement;
import az.ideanest.project.domain.ChecklistResult;
import az.ideanest.project.domain.ChecklistSeverity;
import az.ideanest.project.domain.CoverImage;
import az.ideanest.project.domain.EditorSection;
import az.ideanest.project.domain.SubmissionChecklist;
import az.ideanest.project.domain.SubmissionLimits;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * §5.3, checked against the specification rather than against itself.
 *
 * <p>{@link #SPECIFICATION} is transcribed from {@code docs/architecture.md} §5.3
 * by hand, for the reason {@code ProjectStateMachineTests} gives: a test that read
 * the bounds out of {@link SubmissionChecklist} and compared them with themselves
 * would pass for any numbers at all, including a story minimum of five. Two
 * independent statements of the same rule are what makes a disagreement visible.
 *
 * <p><strong>A plain unit test.</strong> No Spring, no container, no HTTP. That is
 * the whole reason the rules were written as a pure type taking a record: the
 * check that decides whether a campaign may be put in front of moderation is
 * worth being able to run in milliseconds, and worth being able to state as
 * "this campaign, this bound, this answer" rather than as a fixture.
 */
class SubmissionChecklistTests {

    /** §5.3, transcribed. Only the rules the checklist is responsible for. */
    private static final String SPECIFICATION =
            """
            Title                 1-60 characters
            Summary               1-135 characters
            Goal                  configurable minimum and maximum
            Duration              1-60 days
            Cover image           required, minimum 1024x576
            Story                 minimum 500 characters
            Risks and challenges  required, minimum 200 characters
            Reward tiers          0-100
            Reward price          at least the smallest chargeable amount
            """;

    /** Deliberately not the production defaults: a rule that only works at 100.00 is not a rule. */
    private static final SubmissionLimits LIMITS =
            new SubmissionLimits(new BigDecimal("250.00"), new BigDecimal("50000.00"), new BigDecimal("2.00"));

    // ------------------------------------------------------------------
    // The transcription
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the bounds are the ones §5.3 states")
    void theBoundsMatchTheSpecification() {
        // Read off the transcription above rather than compared with the constants
        // directly, so that editing a constant to make a test pass has to edit the
        // copy of the specification as well — which is the moment somebody notices.
        assertThat(SPECIFICATION).contains("1-60 characters");
        assertThat(SubmissionChecklist.TITLE_MAX_CHARACTERS).isEqualTo(60);
        assertThat(SPECIFICATION).contains("1-135 characters");
        assertThat(SubmissionChecklist.SUMMARY_MAX_CHARACTERS).isEqualTo(135);
        assertThat(SPECIFICATION).contains("1-60 days");
        assertThat(SubmissionChecklist.DURATION_MIN_DAYS).isEqualTo(1);
        assertThat(SubmissionChecklist.DURATION_MAX_DAYS).isEqualTo(60);
        assertThat(SPECIFICATION).contains("minimum 1024x576");
        assertThat(SubmissionChecklist.COVER_MIN_WIDTH).isEqualTo(1024);
        assertThat(SubmissionChecklist.COVER_MIN_HEIGHT).isEqualTo(576);
        assertThat(SPECIFICATION).contains("minimum 500 characters");
        assertThat(SubmissionChecklist.STORY_MIN_CHARACTERS).isEqualTo(500);
        assertThat(SPECIFICATION).contains("minimum 200 characters");
        assertThat(SubmissionChecklist.RISKS_MIN_CHARACTERS).isEqualTo(200);
        assertThat(SPECIFICATION).contains("0-100");
        assertThat(SubmissionChecklist.REWARD_TIER_MAX).isEqualTo(100);
    }

    @Test
    @DisplayName("every requirement §5.3 states is on the checklist, and every checklist item is evaluated")
    void everyRequirementIsEvaluated() {
        ChecklistResult result = SubmissionChecklist.evaluate(complete().build(), LIMITS);

        // Every value of the enum appears exactly once. A requirement declared and
        // never evaluated is a row a creator never sees and a rule nothing enforces
        // — the failure mode of a checklist that grew one branch at a time.
        assertThat(result.items())
                .extracting(item -> item.requirement())
                .containsExactly(ChecklistRequirement.values());
    }

    @Test
    @DisplayName("the rules §5.3 states as requirements are the blocking ones")
    void severityMatchesTheSpecification() {
        Set<ChecklistRequirement> blocking = Arrays.stream(ChecklistRequirement.values())
                .filter(ChecklistRequirement::isBlocking)
                .collect(Collectors.toCollection(() -> EnumSet.noneOf(ChecklistRequirement.class)));

        // Exactly the nine rows of §5.3's table that describe a campaign's contents,
        // with the tier count and the tier price counted separately because a
        // campaign can fail one without the other. Everything else on the checklist
        // is advice, and advice must never refuse a submission.
        assertThat(blocking)
                .containsExactlyInAnyOrder(
                        ChecklistRequirement.TITLE,
                        ChecklistRequirement.SUMMARY,
                        ChecklistRequirement.CATEGORY,
                        ChecklistRequirement.COVER_IMAGE,
                        ChecklistRequirement.GOAL,
                        ChecklistRequirement.DURATION,
                        ChecklistRequirement.STORY,
                        ChecklistRequirement.RISKS,
                        ChecklistRequirement.REWARD_TIER_COUNT,
                        ChecklistRequirement.REWARD_PRICES);
    }

    @ParameterizedTest
    @EnumSource(ChecklistRequirement.class)
    @DisplayName("every requirement says which editor section fixes it")
    void everyRequirementRoutesSomewhere(ChecklistRequirement requirement) {
        // A checklist that says what is wrong and not where to fix it is a list of
        // complaints. The section is what turns each failing row into a link.
        // Its label is copy, in four languages, and ChecklistCopyTests holds that every
        // requirement has one in each.
        assertThat(requirement.section()).isNotNull();
        assertThat(requirement.severity()).isNotNull();
    }

    // ------------------------------------------------------------------
    // A complete campaign
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a campaign meeting every rule is submittable and scores full marks")
    void aCompleteCampaignIsSubmittable() {
        ChecklistResult result = SubmissionChecklist.evaluate(complete().build(), LIMITS);

        assertThat(result.isSubmittable()).isTrue();
        assertThat(result.unmetBlocking()).isEmpty();
        assertThat(result.items()).allSatisfy(item -> assertThat(item.satisfied()).isTrue());
        assertThat(result.score()).isEqualTo(100);
    }

    @Test
    @DisplayName("a satisfied requirement explains nothing and an unmet one always does")
    void unmetRequirementsCarryTheirReason() {
        ChecklistResult result = SubmissionChecklist.evaluate(complete().risks(null).build(), LIMITS);

        assertThat(result.items()).allSatisfy(item -> {
            if (item.satisfied()) {
                // Prose beside a tick reads as a complaint about something that is
                // fine, so there is none.
                assertThat(item.detail()).isNull();
            } else {
                assertThat(item.detail()).isNotNull();
                assertThat(item.detail().reason()).isNotBlank();
            }
        });
    }

    @Test
    @DisplayName("a refusal quotes the campaign's own numbers, not the rule")
    void detailsAreAboutThisCampaign() {
        ChecklistResult result = SubmissionChecklist.evaluate(
                complete().storyCharacters(140).cover(new CoverImage("https://x/c.jpg", 800, 450)).build(),
                LIMITS);

        // "The story is too short" is a restatement of the rule. What a creator can
        // act on is how far off they are -- so the detail carries both numbers, and
        // ChecklistCopyTests holds that every language quotes them.
        assertThat(argumentsOf(result, ChecklistRequirement.STORY)).containsExactly(140, 500);
        assertThat(argumentsOf(result, ChecklistRequirement.COVER_IMAGE_SIZE))
                .containsExactly("800×450", "1024×576");
    }

    // ------------------------------------------------------------------
    // Each blocking rule, on its own
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a missing or over-long title is blocking")
    void title() {
        assertBlocks(complete().title(null), ChecklistRequirement.TITLE);
        assertBlocks(complete().title("   "), ChecklistRequirement.TITLE);
        assertBlocks(complete().title("t".repeat(61)), ChecklistRequirement.TITLE);
        assertPasses(complete().title("t".repeat(60)), ChecklistRequirement.TITLE);
    }

    @Test
    @DisplayName("a title is counted in code points, as the column counts it")
    void titleIsCountedInCodePoints() {
        // Sixty emoji are sixty characters to PostgreSQL and a hundred and twenty to
        // String.length. Counting UTF-16 units here would refuse a title the
        // database was perfectly happy with.
        assertPasses(complete().title("🚀".repeat(60)), ChecklistRequirement.TITLE);
        assertBlocks(complete().title("🚀".repeat(61)), ChecklistRequirement.TITLE);
    }

    @Test
    @DisplayName("a missing or over-long summary is blocking")
    void summary() {
        assertBlocks(complete().summary(null), ChecklistRequirement.SUMMARY);
        assertBlocks(complete().summary("s".repeat(136)), ChecklistRequirement.SUMMARY);
        assertPasses(complete().summary("s".repeat(135)), ChecklistRequirement.SUMMARY);
    }

    @Test
    @DisplayName("an unfiled campaign is blocking, and a missing subcategory is only advice")
    void category() {
        assertBlocks(complete().categoryId(null), ChecklistRequirement.CATEGORY);

        ChecklistResult result = SubmissionChecklist.evaluate(complete().subcategoryId(null).build(), LIMITS);
        assertThat(itemOf(result, ChecklistRequirement.SUBCATEGORY).satisfied()).isFalse();
        // Advice never refuses anything. This is the assertion that stands between
        // the checklist and an interface that treats a suggestion as a barrier.
        assertThat(result.isSubmittable()).isTrue();
    }

    @Test
    @DisplayName("a missing cover image is blocking")
    void coverImage() {
        assertBlocks(complete().cover(null), ChecklistRequirement.COVER_IMAGE);
        assertPasses(
                complete().cover(new CoverImage("https://x/c.jpg", 800, 450)), ChecklistRequirement.COVER_IMAGE);
    }

    @Test
    @DisplayName("an undersized cover image is advice, and does not refuse the submission")
    void coverImageSize() {
        // The change the media pipeline made. This used to be part of COVER_IMAGE and used
        // to block: the dimensions came from the creator's browser, so the rule caught the
        // honest and missed everybody else, and it stopped people at the first screen of the
        // editor on a platform with nowhere to upload a larger file.
        ChecklistResult result =
                SubmissionChecklist.evaluate(complete().cover(new CoverImage("https://x/c.jpg", 800, 450)).build(), LIMITS);

        assertThat(itemOf(result, ChecklistRequirement.COVER_IMAGE_SIZE).satisfied()).isFalse();
        assertThat(result.isSubmittable()).isTrue();

        assertPasses(
                complete().cover(new CoverImage("https://x/c.jpg", 1024, 576)), ChecklistRequirement.COVER_IMAGE_SIZE);
        assertThat(itemOf(
                                SubmissionChecklist.evaluate(
                                        complete().cover(new CoverImage("https://x/c.jpg", 1023, 576)).build(), LIMITS),
                                ChecklistRequirement.COVER_IMAGE_SIZE)
                        .satisfied())
                .isFalse();
    }

    @Test
    @DisplayName("a campaign with no cover reports one problem, not two")
    void coverSizeIsSilentWhenThereIsNoCover() {
        // Both rows are about the cover, and a creator who has not set one has one thing to
        // do. Reporting the size rule as unmet as well would put a second red row on the
        // screen that disappears when the first is fixed.
        ChecklistResult result = SubmissionChecklist.evaluate(complete().cover(null).build(), LIMITS);

        assertThat(itemOf(result, ChecklistRequirement.COVER_IMAGE).satisfied()).isFalse();
        assertThat(itemOf(result, ChecklistRequirement.COVER_IMAGE_SIZE).satisfied()).isTrue();
    }

    @Test
    @DisplayName("a goal outside the configured bounds is blocking")
    void goal() {
        assertBlocks(complete().goal(null), ChecklistRequirement.GOAL);
        assertBlocks(complete().goal(new BigDecimal("0.00")), ChecklistRequirement.GOAL);
        assertBlocks(complete().goal(new BigDecimal("249.99")), ChecklistRequirement.GOAL);
        assertBlocks(complete().goal(new BigDecimal("50000.01")), ChecklistRequirement.GOAL);

        // The bounds come from configuration, so the boundaries are the configured
        // ones and not a pair of literals somebody chose here.
        assertPasses(complete().goal(LIMITS.goalMinimum()), ChecklistRequirement.GOAL);
        assertPasses(complete().goal(LIMITS.goalMaximum()), ChecklistRequirement.GOAL);
    }

    @Test
    @DisplayName("the goal refusal names the bound in the campaign's own currency")
    void goalRefusalIsInMoney() {
        ChecklistResult result =
                SubmissionChecklist.evaluate(complete().goal(new BigDecimal("10.00")).build(), LIMITS);

        // "A goal is at least 250" is a number whose units a creator has to guess,
        // and guessing wrong by a factor of a hundred is plausible on a funding
        // platform.
        assertThat(argumentsOf(result, ChecklistRequirement.GOAL)).containsExactly("10 AZN", "250 AZN");
    }

    @Test
    @DisplayName("a duration outside 1-60 days is blocking")
    void duration() {
        assertBlocks(complete().duration(null), ChecklistRequirement.DURATION);
        assertBlocks(complete().duration(0), ChecklistRequirement.DURATION);
        assertBlocks(complete().duration(61), ChecklistRequirement.DURATION);
        assertPasses(complete().duration(1), ChecklistRequirement.DURATION);
        assertPasses(complete().duration(60), ChecklistRequirement.DURATION);
    }

    @Test
    @DisplayName("a story below five hundred characters is blocking")
    void story() {
        assertBlocks(complete().storyCharacters(0), ChecklistRequirement.STORY);
        assertBlocks(complete().storyCharacters(499), ChecklistRequirement.STORY);
        assertPasses(complete().storyCharacters(500), ChecklistRequirement.STORY);
    }

    @Test
    @DisplayName("risks and challenges are required, and at least two hundred characters")
    void risks() {
        // The one rule §5.3 emphasises. A campaign that says nothing about what could
        // go wrong is the campaign that produces the refund requests.
        assertBlocks(complete().risks(null), ChecklistRequirement.RISKS);
        assertBlocks(complete().risks("   "), ChecklistRequirement.RISKS);
        assertBlocks(complete().risks("r".repeat(199)), ChecklistRequirement.RISKS);
        assertPasses(complete().risks("r".repeat(200)), ChecklistRequirement.RISKS);
    }

    @Test
    @DisplayName("more than a hundred reward tiers is blocking")
    void rewardTierCount() {
        assertPasses(complete().prices(prices(100, "10.00")), ChecklistRequirement.REWARD_TIER_COUNT);
        assertBlocks(complete().prices(prices(101, "10.00")), ChecklistRequirement.REWARD_TIER_COUNT);
    }

    @Test
    @DisplayName("a tier priced below the smallest chargeable amount is blocking")
    void rewardPrices() {
        assertPasses(complete().prices(List.of(new BigDecimal("2.00"))), ChecklistRequirement.REWARD_PRICES);
        assertBlocks(complete().prices(List.of(new BigDecimal("1.99"))), ChecklistRequirement.REWARD_PRICES);

        // One bad tier among good ones still refuses: a backer who can select it
        // reaches a charge the provider will not take.
        assertBlocks(
                complete().prices(List.of(new BigDecimal("50.00"), new BigDecimal("0.50"))),
                ChecklistRequirement.REWARD_PRICES);
    }

    @Test
    @DisplayName("a campaign with no rewards passes the price rule and is only advised against")
    void noRewardsIsLegalAndWeak() {
        ChecklistResult result = SubmissionChecklist.evaluate(complete().prices(List.of()).build(), LIMITS);

        // §5.3 permits zero tiers, and "every tier is priced correctly" is true of no
        // tiers. Reporting the absence as a price failure would refuse a campaign the
        // specification allows.
        assertThat(itemOf(result, ChecklistRequirement.REWARD_PRICES).satisfied()).isTrue();
        assertThat(itemOf(result, ChecklistRequirement.REWARD_TIER_COUNT).satisfied()).isTrue();
        assertThat(itemOf(result, ChecklistRequirement.REWARDS_OFFERED).satisfied()).isFalse();
        assertThat(result.isSubmittable()).isTrue();
    }

    // ------------------------------------------------------------------
    // The score
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the score counts advisory items, so a bare but legal campaign is not reported as finished")
    void theScoreIsNotABoolean() {
        // Everything §5.3 requires, and none of the advice. Built only from blockers
        // this would read 100 and tell the creator of an empty-but-legal campaign
        // that there was nothing left to do.
        ChecklistResult bare = SubmissionChecklist.evaluate(
                complete().subcategoryId(null).scheduledLaunchAt(null).storyMedia(0).prices(List.of()).build(),
                LIMITS);

        assertThat(bare.isSubmittable()).isTrue();
        assertThat(bare.score()).isLessThan(100);
        // Ten blocking requirements at weight two, plus the one advisory item this bare
        // campaign does satisfy -- its cover is large enough -- out of a total of
        // twenty-five.
        assertThat(bare.score()).isEqualTo(84);
    }

    @Test
    @DisplayName("the score never reads a hundred while anything is undone")
    void theScoreRoundsDown() {
        for (ChecklistRequirement requirement : ChecklistRequirement.values()) {
            ChecklistResult result = SubmissionChecklist.evaluate(failing(requirement), LIMITS);
            assertThat(result.score())
                    .withFailMessage("%s unmet still scored 100", requirement)
                    .isLessThan(100);
        }
    }

    @Test
    @DisplayName("an empty campaign blocks on everything §5.3 can be asked about")
    void anEmptyCampaignBlocksOnEverything() {
        CampaignCompleteness empty = new CampaignCompleteness(
                null, null, null, null, null, null, "AZN", null, null, 0, 0, null, List.of());

        ChecklistResult result = SubmissionChecklist.evaluate(empty, LIMITS);

        assertThat(result.isSubmittable()).isFalse();
        // Eight of the ten blocking rules. The two about rewards are satisfied by a
        // campaign with no tiers, vacuously and correctly — §5.3 permits zero, and
        // the absence is reported as advice instead.
        assertThat(result.unmetBlocking()).hasSize(8);
        // Not zero, and it should not be: those rules are genuinely met. A score that read
        // zero here would be measuring effort rather than completeness.
        //
        // COVER_IMAGE_SIZE is among the ones met, vacuously: a campaign with no cover has
        // one thing to do about its cover, and reporting the size rule as unmet as well
        // would put a second red row on the screen that vanishes when the first is fixed.
        assertThat(result.score()).isEqualTo(20);
    }

    // ------------------------------------------------------------------
    // Blocking and advisory stay apart
    // ------------------------------------------------------------------

    @Test
    @DisplayName("blocking and advisory partition the checklist, and only blocking refuses")
    void theTwoListsPartitionTheChecklist() {
        ChecklistResult result = SubmissionChecklist.evaluate(
                complete().title(null).prices(List.of()).build(), LIMITS);

        assertThat(result.blocking()).hasSize(10);
        // Five since the cover-size rule stopped blocking -- see COVER_IMAGE_SIZE.
        assertThat(result.advisory()).hasSize(5);
        assertThat(result.blocking().size() + result.advisory().size())
                .isEqualTo(result.items().size());

        assertThat(result.advisory())
                .allSatisfy(item -> assertThat(item.requirement().severity())
                        .isEqualTo(ChecklistSeverity.ADVISORY));
        // The refusal list is blocking items only, however many advisory ones are
        // unmet beside them.
        assertThat(result.unmetBlocking())
                .extracting(item -> item.requirement())
                .containsExactly(ChecklistRequirement.TITLE);
    }

    @Test
    @DisplayName("reward rules point at the rewards tab and story rules at the story tab")
    void requirementsPointAtTheTabThatFixesThem() {
        assertThat(ChecklistRequirement.COVER_IMAGE.section()).isEqualTo(EditorSection.BASICS);
        assertThat(ChecklistRequirement.RISKS.section()).isEqualTo(EditorSection.STORY);
        assertThat(ChecklistRequirement.REWARD_PRICES.section()).isEqualTo(EditorSection.REWARDS);
        // The keys are the campaign editor's route segments, so a rename here is a
        // rename in tabs.ts as well.
        assertThat(EditorSection.BASICS.key()).isEqualTo("basics");
        assertThat(EditorSection.REWARDS.key()).isEqualTo("rewards");
        assertThat(EditorSection.STORY.key()).isEqualTo("story");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static void assertBlocks(Campaign campaign, ChecklistRequirement requirement) {
        ChecklistResult result = SubmissionChecklist.evaluate(campaign.build(), LIMITS);

        assertThat(itemOf(result, requirement).satisfied())
                .withFailMessage("%s was expected to be unmet", requirement)
                .isFalse();
        assertThat(result.unmetBlocking()).extracting(item -> item.requirement()).contains(requirement);
        assertThat(result.isSubmittable()).isFalse();
    }

    private static void assertPasses(Campaign campaign, ChecklistRequirement requirement) {
        ChecklistResult result = SubmissionChecklist.evaluate(campaign.build(), LIMITS);

        assertThat(itemOf(result, requirement).satisfied())
                .withFailMessage("%s was expected to be met", requirement)
                .isTrue();
    }

    private static ChecklistItem itemOf(ChecklistResult result, ChecklistRequirement requirement) {
        return result.items().stream()
                .filter(item -> item.requirement() == requirement)
                .findFirst()
                .orElseThrow(() -> new AssertionError(requirement + " is not on the checklist"));
    }

    /** What the unmet requirement quotes, in the order its message numbers them. */
    private static List<Object> argumentsOf(ChecklistResult result, ChecklistRequirement requirement) {
        return itemOf(result, requirement).detail().arguments();
    }

    private static List<BigDecimal> prices(int count, String each) {
        return IntStream.range(0, count)
                .mapToObj(index -> new BigDecimal(each))
                .toList();
    }

    /** A campaign with exactly one requirement broken. */
    private static CampaignCompleteness failing(ChecklistRequirement requirement) {
        Campaign campaign = complete();
        return switch (requirement) {
            case TITLE -> campaign.title(null).build();
            case SUMMARY -> campaign.summary(null).build();
            case CATEGORY -> campaign.categoryId(null).build();
            case SUBCATEGORY -> campaign.subcategoryId(null).build();
            case COVER_IMAGE -> campaign.cover(null).build();
            case COVER_IMAGE_SIZE -> campaign.cover(new CoverImage("https://x/c.jpg", 800, 450)).build();
            case GOAL -> campaign.goal(null).build();
            case DURATION -> campaign.duration(null).build();
            case SCHEDULED_LAUNCH -> campaign.scheduledLaunchAt(null).build();
            case STORY -> campaign.storyCharacters(10).build();
            case STORY_MEDIA -> campaign.storyMedia(0).build();
            case RISKS -> campaign.risks(null).build();
            case REWARDS_OFFERED -> campaign.prices(List.of()).build();
            case REWARD_TIER_COUNT -> campaign.prices(prices(101, "10.00")).build();
            case REWARD_PRICES -> campaign.prices(List.of(new BigDecimal("0.10"))).build();
        };
    }

    /**
     * A campaign that satisfies everything, as a starting point.
     *
     * <p>Every test below breaks exactly one thing, which is what makes a failure
     * name the rule it is about. A fixture per case would eventually differ in two
     * ways and the test would pass for the wrong reason.
     */
    private static Campaign complete() {
        return new Campaign();
    }

    /**
     * A mutable builder, because {@link CampaignCompleteness} has thirteen
     * components and a test that rewrote all thirteen to change one would hide the
     * change among the twelve that did not matter.
     */
    private static final class Campaign {

        private String title = "A field recorder for birdsong";
        private String summary = "A pocket recorder built for the dawn chorus.";
        private UUID categoryId = UUID.randomUUID();
        private UUID subcategoryId = UUID.randomUUID();
        private CoverImage cover = new CoverImage("https://cdn.example.com/cover.jpg", 1600, 900);
        private BigDecimal goal = new BigDecimal("5000.00");
        private final String currency = "AZN";
        private Integer duration = 30;
        private Instant scheduledLaunchAt = Instant.parse("2026-09-01T09:00:00Z");
        private int storyCharacters = 900;
        private int storyMedia = 2;
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

        Campaign categoryId(UUID value) {
            this.categoryId = value;
            return this;
        }

        Campaign subcategoryId(UUID value) {
            this.subcategoryId = value;
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

        Campaign scheduledLaunchAt(Instant value) {
            this.scheduledLaunchAt = value;
            return this;
        }

        Campaign storyCharacters(int value) {
            this.storyCharacters = value;
            return this;
        }

        Campaign storyMedia(int value) {
            this.storyMedia = value;
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
                    categoryId,
                    subcategoryId,
                    cover,
                    goal,
                    currency,
                    duration,
                    scheduledLaunchAt,
                    storyCharacters,
                    storyMedia,
                    risks,
                    prices);
        }
    }
}
