package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.project.domain.CoverImage;
import az.ideanest.project.domain.ProjectEditLocks;
import az.ideanest.project.domain.ProjectRevision;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.project.domain.RevisionContent;
import az.ideanest.project.domain.RevisionStatus;
import java.time.Instant;
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
                Map.of());
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
                Map.of());

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
                "T", null, null, null, JSON.createObjectNode().put("a", 1).put("b", 2), null, null, null, List.of("AZ"), null);
        RevisionContent reordered = new RevisionContent(
                "T", null, null, null, JSON.createObjectNode().put("b", 2).put("a", 1), null, null, null, List.of("AZ"), null);

        assertThat(reordered.changedFrom(live)).isEmpty();
    }

    @Test
    @DisplayName("a reward tier's writing is a change only for a tier the campaign still has, and only if it differs")
    void rewardWritingIsComparedAgainstTheLiveTiers() {
        UUID kept = UUID.randomUUID();
        UUID edited = UUID.randomUUID();
        UUID deleted = UUID.randomUUID();
        Map<UUID, RevisionContent.Reward> tiers = new LinkedHashMap<>();
        tiers.put(kept, new RevisionContent.Reward("Mug", "A mug", null, null));
        tiers.put(edited, new RevisionContent.Reward("Poster", null, null, null));
        RevisionContent live = withRewards(tiers);

        RevisionContent proposed = live
                .withReward(kept, new RevisionContent.Reward("Mug", "A mug", null, null))
                .withReward(edited, new RevisionContent.Reward("Signed poster", null, UUID.randomUUID(), null))
                .withReward(deleted, new RevisionContent.Reward("Gone", null, null, null));

        assertThat(proposed.changedFrom(live)).containsExactly(RevisionContent.REWARDS);
        assertThat(proposed.changedRewardsFrom(live)).containsExactly(edited);
        assertThat(proposed.heldAgainst(live).rewards()).containsOnlyKeys(edited);

        RevisionContent onlyGone = withRewards(Map.of(deleted, new RevisionContent.Reward("Gone", null, null, null)));
        assertThat(onlyGone.changedFrom(live)).isEmpty();
        assertThat(onlyGone.heldAgainst(live).rewards()).isEmpty();
    }

    @Test
    @DisplayName("content written before reward tiers were held reads with none, and tiers survive a round trip")
    void rewardsRoundTripThroughJson() {
        UUID tier = UUID.randomUUID();
        RevisionContent held = content().withReward(tier, new RevisionContent.Reward("Mug", null, null, UUID.randomUUID()));

        RevisionContent read = JSON.readValue(JSON.writeValueAsString(held), RevisionContent.class);
        assertThat(read.rewards()).isEqualTo(held.rewards());

        RevisionContent older = JSON.readValue(
                "{\"title\":\"T\",\"countries\":[\"AZ\"]}", RevisionContent.class);
        assertThat(older.rewards()).isEmpty();
    }

    private static RevisionContent withRewards(Map<UUID, RevisionContent.Reward> rewards) {
        RevisionContent base = content();
        return new RevisionContent(
                base.title(),
                base.blurb(),
                base.categoryId(),
                base.subcategoryId(),
                base.story(),
                base.risks(),
                base.coverImage(),
                base.videoMediaId(),
                base.countries(),
                rewards);
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
