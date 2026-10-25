package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.project.domain.CoverImage;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.ProjectRevision;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.RevisionContent;
import az.ideanest.project.domain.RevisionStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

/** The parts of a revision that need no database: what differs, and which moves are allowed. */
class ProjectRevisionTests {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static RevisionContent content() {
        return new RevisionContent(
                "Title",
                "A summary",
                null,
                null,
                JSON.createObjectNode().put("version", 1),
                "Risks",
                new CoverImage("https://cdn.example/cover.jpg", 1600, 900),
                null,
                List.of("AZ"),
                Map.of(),
                null,
                null,
                null);
    }

    @Test
    @DisplayName("identical content differs in nothing")
    void identicalContentHasNoChanges() {
        assertThat(content().changedFrom(content())).isEmpty();
    }

    @Test
    @DisplayName("each changed field is named, in a stable order")
    void changedFieldsAreNamed() {
        RevisionContent live = content();
        RevisionContent edited = new RevisionContent(
                "New title",
                live.blurb(),
                live.categoryId(),
                live.subcategoryId(),
                JSON.createObjectNode().put("version", 2),
                live.risks(),
                null,
                UUID.randomUUID(),
                List.of("AZ", "TR"),
                Map.of(),
                null,
                null,
                null);

        assertThat(edited.changedFrom(live))
                .containsExactly(
                        RevisionContent.TITLE,
                        RevisionContent.STORY,
                        RevisionContent.COVER_IMAGE,
                        RevisionContent.VIDEO,
                        RevisionContent.COUNTRIES);
    }

    @Test
    @DisplayName("a story whose keys were reordered is not a change")
    void keyOrderIsNotAnEdit() {
        RevisionContent live = new RevisionContent(
                "T", null, null, null, JSON.createObjectNode().put("a", 1).put("b", 2), null, null, null, List.of("AZ"), null,
                null, null, null);
        RevisionContent reordered = new RevisionContent(
                "T", null, null, null, JSON.createObjectNode().put("b", 2).put("a", 1), null, null, null, List.of("AZ"), null,
                null, null, null);

        assertThat(reordered.changedFrom(live)).isEmpty();
    }

    @Test
    @DisplayName("a reward tier's proposed state is a change only for a tier the campaign still has, and only if it differs")
    void rewardWritingIsComparedAgainstTheLiveTiers() {
        UUID kept = UUID.randomUUID();
        UUID edited = UUID.randomUUID();
        UUID deleted = UUID.randomUUID();
        Map<UUID, RevisionContent.Reward> tiers = new LinkedHashMap<>();
        tiers.put(kept, reward("Mug", "A mug", null, terms(null)));
        tiers.put(edited, reward("Poster", null, null, terms(null)));
        RevisionContent live = withRewards(tiers);

        RevisionContent proposed = live
                .withReward(kept, reward("Mug", "A mug", null, terms(null)))
                .withReward(edited, reward("Signed poster", null, UUID.randomUUID(), terms(null)))
                .withReward(deleted, reward("Gone", null, null, terms(null)));

        assertThat(proposed.changedFrom(live)).containsExactly(RevisionContent.REWARDS);
        assertThat(proposed.changedRewardsFrom(live)).containsExactly(edited);
        assertThat(proposed.heldAgainst(live).rewards()).containsOnlyKeys(edited);

        RevisionContent onlyGone = withRewards(Map.of(deleted, reward("Gone", null, null, terms(null))));
        assertThat(onlyGone.changedFrom(live)).isEmpty();
        assertThat(onlyGone.heldAgainst(live).rewards()).isEmpty();
    }

    @Test
    @DisplayName("a tier's limit, composition or rates are a change like its title (#569)")
    void rewardTermsAreCompared() {
        UUID tier = UUID.randomUUID();
        RevisionContent live = withRewards(Map.of(tier, reward("Mug", null, null, terms(10))));

        RevisionContent raised = live.withReward(tier, reward("Mug", null, null, terms(20)));

        assertThat(raised.changedFrom(live)).containsExactly(RevisionContent.REWARDS);
        assertThat(raised.heldAgainst(live).rewards().get(tier).terms().limitQuantity()).isEqualTo(20);
        assertThat(live.withReward(tier, reward("Mug", null, null, terms(10))).changedFrom(live)).isEmpty();
    }

    @Test
    @DisplayName("a deleted, created or moved tier is a change to the rewards, and only while it still is one")
    void deletedCreatedAndMovedTiersAreChanges() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID created = UUID.randomUUID();
        Map<UUID, RevisionContent.Reward> tiers = new LinkedHashMap<>();
        tiers.put(first, reward("First", null, null, terms(null)));
        tiers.put(second, reward("Second", null, null, terms(null)));
        RevisionContent live = withRewards(tiers);

        RevisionContent deleting = live.withRewardChanges(Map.of(), List.of(second, UUID.randomUUID()), null, null);
        assertThat(deleting.changedFrom(live)).containsExactly(RevisionContent.REWARDS);
        assertThat(deleting.heldAgainst(live).deletedRewards()).containsExactly(second);
        assertThat(deleting.proposedRewardOrder(live)).containsExactly(first);

        RevisionContent creating = live.withCreatedRewards(List.of(created));
        assertThat(creating.changedFrom(live)).containsExactly(RevisionContent.REWARDS);
        assertThat(creating.proposedRewardOrder(live)).containsExactly(first, second, created);

        RevisionContent moving = live.withRewardChanges(Map.of(), null, null, List.of(second, first));
        assertThat(moving.reordersFrom(live)).isTrue();
        assertThat(moving.changedFrom(live)).containsExactly(RevisionContent.REWARDS);
        assertThat(moving.proposedRewardOrder(live)).containsExactly(second, first);

        RevisionContent notMoving = live.withRewardChanges(Map.of(), null, null, List.of(first, second));
        assertThat(notMoving.changedFrom(live)).isEmpty();
        assertThat(notMoving.heldAgainst(live).rewardOrder()).isNull();

        RevisionContent createdFirst =
                live.withRewardChanges(Map.of(), null, List.of(created), List.of(created, first, second));
        assertThat(createdFirst.reordersFrom(live)).as("the approved tiers keep their order").isFalse();
        assertThat(createdFirst.heldAgainst(live).rewardOrder()).containsExactly(created, first, second);
        assertThat(createdFirst.proposedRewardOrder(live)).containsExactly(created, first, second);
    }

    @Test
    @DisplayName("content written before tiers were held reads with none, and tiers survive a round trip")
    void rewardsRoundTripThroughJson() {
        UUID tier = UUID.randomUUID();
        RevisionContent held = content()
                .withRewardChanges(
                        Map.of(tier, reward("Mug", null, null, terms(5))),
                        List.of(UUID.randomUUID()),
                        List.of(UUID.randomUUID()),
                        List.of(tier));

        RevisionContent read = JSON.readValue(JSON.writeValueAsString(held), RevisionContent.class);
        assertThat(read.rewards()).isEqualTo(held.rewards());
        assertThat(read.deletedRewards()).isEqualTo(held.deletedRewards());
        assertThat(read.createdRewards()).isEqualTo(held.createdRewards());
        assertThat(read.rewardOrder()).isEqualTo(held.rewardOrder());

        RevisionContent older = JSON.readValue("{\"title\":\"T\",\"countries\":[\"AZ\"]}", RevisionContent.class);
        assertThat(older.rewards()).isEmpty();
        assertThat(older.deletedRewards()).isEmpty();
        assertThat(older.createdRewards()).isEmpty();
        assertThat(older.rewardOrder()).isNull();
    }

    @Test
    @DisplayName("a tier's writing held before #569 still reads, and keeps the rest of the tier as it is")
    void writingHeldBefore569IsCompletedFromTheTier() {
        UUID tier = UUID.randomUUID();
        RevisionContent older = JSON.readValue(
                "{\"title\":\"T\",\"countries\":[\"AZ\"],\"rewards\":{\"" + tier
                        + "\":{\"title\":\"Signed mug\",\"description\":null,\"imageMediaId\":null,\"videoMediaId\":null}}}",
                RevisionContent.class);
        assertThat(older.rewards().get(tier).terms()).isNull();

        RevisionContent live = withRewards(Map.of(tier, reward("Mug", null, null, terms(10))));
        RevisionContent held = older.heldAgainst(live);

        assertThat(held.rewards().get(tier).title()).isEqualTo("Signed mug");
        assertThat(held.rewards().get(tier).terms()).isEqualTo(terms(10));
        assertThat(older.changedRewardsFrom(live)).containsExactly(tier);
    }

    private static RevisionContent.Reward reward(
            String title, String description, UUID imageMediaId, RevisionContent.Terms terms) {
        return new RevisionContent.Reward(title, description, imageMediaId, null, terms);
    }

    private static RevisionContent.Terms terms(Integer limit) {
        return new RevisionContent.Terms(
                LocalDate.parse("2027-03-01"),
                limit,
                "DOMESTIC",
                false,
                false,
                false,
                null,
                null,
                Instant.parse("2027-01-01T00:00:00Z"),
                List.of(new RevisionContent.Terms.Line(UUID.fromString("00000000-0000-0000-0000-000000000001"), 2)),
                List.of(new RevisionContent.Terms.CountryRate(
                        "AZ", new BigDecimal("5.00"), new BigDecimal("1.50"), new BigDecimal("0.00"))),
                List.of());
    }

    private static RevisionContent withRewards(Map<UUID, RevisionContent.Reward> rewards) {
        return content().withRewardChanges(rewards, null, null, null);
    }

    @Test
    @DisplayName("only states the public has seen hold an edit for review")
    void onlyLaunchedStatesHoldEdits() {
        for (ProjectState state : ProjectState.values()) {
            boolean launched = state != ProjectState.DRAFT
                    && state != ProjectState.PRELAUNCH
                    && state != ProjectState.SUBMITTED
                    && state != ProjectState.CHANGES_REQUESTED
                    && state != ProjectState.APPROVED
                    && state != ProjectState.SCHEDULED
                    && state != ProjectState.REJECTED;
            assertThat(ProjectEditLocks.isLaunched(state)).as(state.name()).isEqualTo(launched);
        }
    }

    @Test
    @DisplayName("a revision is a draft, then pending, then decided once")
    void aRevisionIsDecidedOnce() {
        UUID author = UUID.randomUUID();
        UUID moderator = UUID.randomUUID();
        ProjectRevision revision = ProjectRevision.draft(UUID.randomUUID(), "{}", author);
        assertThat(revision.getStatus()).isEqualTo(RevisionStatus.DRAFT);
        assertThatThrownBy(() -> revision.approve(moderator, Instant.now(), null))
                .isInstanceOf(IllegalStateException.class);

        revision.submit(Instant.parse("2026-10-24T10:00:00Z"));
        assertThat(revision.getStatus()).isEqualTo(RevisionStatus.PENDING);

        revision.approve(moderator, Instant.parse("2026-10-24T11:00:00Z"), null);
        assertThat(revision.getStatus()).isEqualTo(RevisionStatus.APPROVED);
        assertThatThrownBy(() -> revision.reject(moderator, Instant.now(), "no"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> revision.rewrite("{}", author)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("rewriting a submitted revision makes it a draft again")
    void rewritingWithdrawsTheSubmission() {
        UUID author = UUID.randomUUID();
        ProjectRevision revision = ProjectRevision.draft(UUID.randomUUID(), "{}", author);
        revision.submit(Instant.parse("2026-10-24T10:00:00Z"));

        revision.rewrite("{\"x\":1}", author);

        assertThat(revision.getStatus()).isEqualTo(RevisionStatus.DRAFT);
        assertThat(revision.getSubmittedAt()).isNull();
        assertThat(revision.getContent()).isEqualTo("{\"x\":1}");
    }
}
