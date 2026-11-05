package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.discovery.application.RankingWeightStore;
import az.ideanest.support.AdjustableClock;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Curations;
import az.ideanest.support.Weights;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code sort=relevance}: §11.2's composite, term by term.
 *
 * <h2>What this suite is actually asserting</h2>
 *
 * <p>A ranking is a sum, and a sum is the one shape in which every part can be wrong
 * while the whole looks plausible. A test that seeded four campaigns and asserted an
 * order under the default weights would pass with the completion term inverted, with the
 * editorial term reading the wrong view, or with three of the four terms silently
 * dropped — because some order always comes back and every order looks like a ranking.
 *
 * <p>So <strong>every term is tested in isolation, with the other weights at
 * zero</strong>. Each test says "this term, alone, orders these campaigns this way, and
 * this is the direction the term claims". What the terms do together is then a property
 * of arithmetic rather than of this code.
 *
 * <p>The other half is the negative space, and it is the half §11.2's last sentence is
 * about: a weight of zero removes a term's influence entirely, an inactive term
 * contributes exactly nothing, and five of §11.2's eight terms are inert and are
 * <em>visibly</em> so rather than quietly missing. The last of those is asserted in
 * {@code RankingApiTests}, against the diagnostic, because that is where somebody tuning
 * would find out.
 *
 * <h2>The fixture</h2>
 *
 * <p>Deliberately non-collinear: the campaign that wins on completion is not the one
 * that wins on recency, is not the one that wins on the badge, is not the one that wins
 * on text. A fixture in which one campaign led on everything would pass with any three
 * of the four terms broken.
 */
class RankingRelevanceTests extends DiscoveryTestSupport {

    @Autowired
    private RankingWeightStore weightStore;

    @Autowired
    private AdjustableClock clock;

    @BeforeEach
    void seedCampaignsAndWeights() {
        Campaigns.clear(dataSource);
        Weights.restoreDefaults(dataSource);
        weightStore.refresh();

        UUID creator = Campaigns.creator(dataSource, "ranking-creator");
        Instant old = Instant.now().minus(40, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        Instant recent = Instant.now().minus(1, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS);

        // Wins on completion, and on nothing else: old, unbadged, and its text says
        // nothing about robots.
        campaign("nearly-funded", "1000.00", "900.00", old, "Az qalıb");
        // Wins on recency, and on nothing else.
        campaign("just-launched", "1000.00", "100.00", recent, "Təzə layihə");
        // Wins on the editorial badge, and on nothing else.
        UUID badged = campaign("badged-pick", "1000.00", "100.00", old, "Seçilmiş layihə");
        // Wins on nothing at all. The control.
        campaign("plain-campaign", "1000.00", "100.00", old, "Adi layihə");
        // Wins on the text term when the reader types "robot" — in the title, which
        // V13 weights above the blurb.
        campaign("robot-title", "1000.00", "100.00", old, "Robot dostum");
        // And the same word in the blurb only, so the text term has two campaigns to
        // put in an order rather than one to find.
        Campaigns.seed(dataSource, creator, "robot-blurb")
                .title("Başqa layihə")
                .blurb("A summary about a robot that fits inside a hundred and thirty-five characters.")
                .state("LIVE")
                .category("games")
                .goal("1000.00")
                .pledged("100.00")
                .backers(5)
                .launchedAt(old)
                .deadline(old.plus(90, ChronoUnit.DAYS))
                .tags("ranked")
                .insert();

        UUID picks = Curations.collection(dataSource, "ranking-picks")
                .kind("STAFF_SELECTION")
                .grantsBadge()
                .published()
                .title("az", "Redaksiya seçimi")
                .insert();
        Curations.members(dataSource, picks, badged);
    }

    @AfterEach
    void restoreWeightsAndClock() {
        // The context, and therefore the weights table, is shared with every other
        // suite in the run. A class that left the editorial weight at 1 would silently
        // change what any later relevance assertion means.
        clock.reset();
        Weights.restoreDefaults(dataSource);
        weightStore.refresh();
    }

    private UUID campaign(String slug, String goal, String pledged, Instant launched, String title) {
        return Campaigns.seed(dataSource, Campaigns.creator(dataSource, "ranking-creator"), slug)
                .title(title)
                .state("LIVE")
                .category("games")
                .goal(goal)
                .pledged(pledged)
                .backers(5)
                .launchedAt(launched)
                .deadline(launched.plus(90, ChronoUnit.DAYS))
                .tags("ranked")
                .insert();
    }

    /** Switches everything off but one term, and makes the running service believe it. */
    private void only(String term) {
        Weights.only(dataSource, term);
        weightStore.refresh();
    }

    // ------------------------------------------------------------------
    // Each live term, alone
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the completion term ranks a campaign nearer its goal above one further from it")
    void completionMovesTheOrderInTheDirectionItClaims() {
        only("completion");

        // 90% funded above 10% funded, and every 10% campaign tied behind it.
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("nearly-funded");

        // And it saturates rather than running away, which is why §11.2 asks for a
        // sigmoid: a campaign at fifty times its goal is above one at 90% and is not
        // fifty times above it. Without saturation one runaway campaign would sit at
        // the top of every feed on the platform for ever.
        campaign("runaway", "1000.00", "50000.00", Instant.now().minus(40, ChronoUnit.DAYS), "Çox uğurlu");
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("runaway", "nearly-funded");
    }

    @Test
    @DisplayName("the recency term ranks a campaign that launched an hour ago above one from last month")
    void recencyMovesTheOrderInTheDirectionItClaims() {
        only("recency");

        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("just-launched");
    }

    @Test
    @DisplayName("the editorial term ranks a badged campaign above an unbadged one")
    void theEditorialTermMovesTheOrderInTheDirectionItClaims() {
        only("editorial");

        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("badged-pick");
    }

    @Test
    @DisplayName("the text term is best_match: a title hit outranks a blurb hit")
    void theTextTermIsTheOneBestMatchAlreadyComputed() {
        only("text_match");

        // #43 said this would happen — "best_match becomes its text term rather than
        // being replaced by it" — and this is what makes it true rather than intended:
        // the composite's text term is the same ts_rank over the same vector, so V13's
        // weights (title A, blurb B) decide the order here exactly as they do under
        // sort=best_match.
        assertThat(slugs(search("?limit=100&q=robot&sort=relevance")))
                .containsExactly("robot-title", "robot-blurb");
        assertThat(slugs(search("?limit=100&q=robot&sort=best_match")))
                .containsExactly("robot-title", "robot-blurb");
    }

    @Test
    @DisplayName("with no query the text term is zero for everybody rather than absent")
    void theTextTermIsZeroOnABrowsingFeed() {
        only("text_match");

        // Every campaign scores zero, so the order collapses to the id tiebreaker —
        // which is total, so the feed is still complete and still pageable rather than
        // arbitrary. The assertion that matters is that nothing is lost and nothing
        // errors: an expression that referenced a bound `:text` parameter that was
        // never set would fail the statement outright.
        List<String> returned = slugs(feed("?limit=100&sort=relevance"));
        assertThat(returned).hasSize(6);
        assertThat(new LinkedHashSet<>(returned)).hasSize(6);
    }

    // ------------------------------------------------------------------
    // The negative space
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a weight of zero removes that term's influence entirely")
    void aWeightOfZeroRemovesTheTerm() {
        // Two live terms pulling in opposite directions: the badged campaign is at 10%
        // funded and the nearly-funded one carries no badge. At equal weights the badge
        // wins, because the editorial term is 1 and the completion term is 0.0099.
        Weights.none(dataSource);
        Weights.set(dataSource, "editorial", "1", true);
        Weights.set(dataSource, "completion", "1", true);
        weightStore.refresh();
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("badged-pick");

        // Zero the editorial weight, leaving the term active. The badge stops mattering
        // at all — not less, none — and completion decides.
        Weights.set(dataSource, "editorial", "0", true);
        weightStore.refresh();
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("nearly-funded");
    }

    @Test
    @DisplayName("an inactive term contributes exactly nothing, whatever its weight says")
    void anInactiveTermContributesNothing() {
        Weights.none(dataSource);
        Weights.set(dataSource, "completion", "1", true);
        // A large weight on a term that is switched off. If "inactive" were implemented
        // as "multiply by zero" this would still pass; it is implemented as "omit the
        // addend", and what this pins is that the two are indistinguishable from
        // outside — which is the promise, because the difference between the two
        // columns is meant to be about intent rather than about arithmetic.
        Weights.set(dataSource, "editorial", "9", false);
        weightStore.refresh();

        List<String> returned = slugs(feed("?limit=100&sort=relevance"));
        assertThat(returned).startsWith("nearly-funded");
        // The badged campaign is at 10% funded, so with the badge counting for nothing
        // it is somewhere in the tie behind — and definitely not at the top, which is
        // where a weight of nine would have put it.
        assertThat(returned.indexOf("badged-pick")).isGreaterThan(0);
    }

    @Test
    @DisplayName("an inert term with a weight on it changes nothing, because nothing computes it")
    void anInertTermIsVisiblyZero() {
        Weights.none(dataSource);
        Weights.set(dataSource, "recency", "1", true);
        weightStore.refresh();
        List<String> before = slugs(feed("?limit=100&sort=relevance"));

        // The four terms §11.2 describes that this schema cannot compute. Their rows
        // exist and their weights are settable — which is the point, because switching
        // one on the day its data lands must not be a code change to this file — and
        // they contribute nothing today. V15's CHECK is what stops anybody making one
        // active; here they are merely weighted, which is legal and inert.
        for (String term : List.of("pledge_velocity", "backer_velocity", "conversion", "spam")) {
            Weights.set(dataSource, term, "9", false);
        }
        weightStore.refresh();

        assertThat(slugs(feed("?limit=100&sort=relevance"))).isEqualTo(before);
    }

    @Test
    @DisplayName("every weight at zero is a legal configuration and still pages to the end")
    void everyTermOffIsStillATotalOrder() {
        Weights.none(dataSource);
        weightStore.refresh();

        // A score of zero for everybody. The order falls back on the id tiebreaker,
        // which every sort in this module carries — so the feed is still total, the
        // cursor is still exact, and a whole walk still terminates with nothing seen
        // twice. This is how somebody isolates one term while tuning, so it has to work.
        List<String> seen = walk("?limit=1&sort=relevance");
        assertThat(seen).hasSize(6);
        assertThat(new LinkedHashSet<>(seen)).hasSize(6);
    }

    // ------------------------------------------------------------------
    // Picking up a change
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a weight change reaches a running application within the documented window")
    void aWeightChangeIsPickedUpWithinTheStalenessWindow() {
        only("completion");
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("nearly-funded");

        // Written straight to the table, exactly as a second instance's change would
        // arrive: this instance's cache knows nothing about it.
        Weights.set(dataSource, "editorial", "9", true);

        // Still the old order, and that is the cache doing its job rather than a bug.
        // Reading the table on every request would put a thousand extra round trips a
        // second on the hot path of the feed for nine rows that change monthly.
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("nearly-funded");

        // Past the window RankingWeightStore documents, and the change is in force
        // without a deployment — which is the whole of §11.2's requirement.
        clock.advance(RankingWeightStore.STALENESS_WINDOW.plus(Duration.ofSeconds(1)));

        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("badged-pick");
    }

    // ------------------------------------------------------------------
    // Composition
    // ------------------------------------------------------------------

    @Test
    @DisplayName("relevance composes with every filter and with the text query")
    void relevanceComposesWithEveryFilter() {
        only("completion");

        assertThat(slugs(feed("?limit=100&sort=relevance&category=games"))).hasSize(6);
        assertThat(items(feed("?limit=100&sort=relevance&category=art"))).isEmpty();
        assertThat(slugs(feed("?limit=100&sort=relevance&tag=ranked"))).hasSize(6);
        assertThat(slugs(feed("?limit=100&sort=relevance&status=live"))).hasSize(6);
        assertThat(slugs(feed("?limit=100&sort=relevance&completion=75_to_100")))
                .containsExactly("nearly-funded");
        assertThat(slugs(feed("?limit=100&sort=relevance&raisedBand=under_1000"))).hasSize(6);
        assertThat(slugs(feed("?limit=100&sort=relevance&showOnly=featured")))
                .containsExactly("badged-pick");
        assertThat(slugs(search("?limit=100&q=robot&sort=relevance")))
                .containsExactlyInAnyOrder("robot-title", "robot-blurb");
        // Several at once, and an empty answer that is empty rather than falling back
        // to one of the filters.
        assertThat(slugs(feed("?limit=100&sort=relevance&category=games&tag=ranked&completion=75_to_100")))
                .containsExactly("nearly-funded");
        assertThat(items(feed("?limit=100&sort=relevance&showOnly=featured&completion=75_to_100")))
                .isEmpty();
    }

    @Test
    @DisplayName("the facet counts do not depend on the sort order")
    void facetCountsAreUnaffectedBySort() {
        only("editorial");

        // A count is over everything the filter matches; the order one page of it comes
        // back in cannot change how many there are. Asserted rather than assumed
        // because relevance is the first sort whose expression appears in the SELECT
        // list, and a facet query that had picked it up would be counting a score.
        Map<String, Object> byRelevance = facets("?sort=relevance");
        Map<String, Object> byNewest = facets("?sort=newest");

        assertThat(count(byRelevance, "categories", "games")).isEqualTo(count(byNewest, "categories", "games"));
        assertThat(count(byRelevance, "showOnly", "featured")).isEqualTo(count(byNewest, "showOnly", "featured"));
        assertThat(count(byRelevance, "completion", "75_to_100"))
                .isEqualTo(count(byNewest, "completion", "75_to_100"));
        assertThat(count(byRelevance, "status", "live")).isEqualTo(count(byNewest, "status", "live"));
        assertThat(count(byRelevance, "categories", "games")).isEqualTo(6);
    }

    // ------------------------------------------------------------------
    // The cursor
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a walk of the relevance order is stable when a campaign's pledged amount changes")
    void theCursorWalkSurvivesAPledgeMidScroll() {
        only("completion");

        // Page one, then a pledge lands on a campaign the scroll has not reached, which
        // is the case a keyset cursor exists for and the case #42 pinned the clock
        // against. The score is not pinnable — no cursor can pin pledged_amount without
        // materialising the whole result set — so the guarantee is DiscoveryCursor's:
        // a row that moves is seen once or not at all, and NO ROW THAT STAYED STILL is
        // ever duplicated or dropped.
        List<String> seen = new ArrayList<>();
        String cursor = null;
        boolean pledged = false;
        for (int page = 0; page < 20; page++) {
            Map<String, Object> body =
                    feed("?limit=1&sort=relevance" + (cursor == null ? "" : "&cursor=" + cursor));
            seen.addAll(slugs(body));
            cursor = nextCursor(body);
            if (cursor == null) {
                break;
            }
            if (!pledged) {
                // `plain-campaign` goes from 10% to 95% funded between two pages, which
                // moves it from the bottom of the order to the second place. It is
                // legitimately skipped by the rest of the walk, because it moved above
                // the point the scroll had already passed.
                new JdbcTemplate(dataSource)
                        .update("UPDATE projects SET pledged_amount = 950.00 WHERE slug = 'plain-campaign'");
                pledged = true;
            }
        }

        assertThat(cursor).isNull();
        // Nothing twice.
        assertThat(new LinkedHashSet<>(seen)).hasSize(seen.size());
        // And nothing that stayed still is missing. The campaign that moved is the only
        // one this walk is allowed to lose.
        assertThat(seen)
                .contains("nearly-funded", "just-launched", "badged-pick", "robot-title", "robot-blurb");
    }

    @Test
    @DisplayName("a weight change mid-scroll is refused rather than reshuffling the feed under the reader")
    void aTuningChangeInvalidatesAnOpenCursor() {
        only("completion");

        String cursor = nextCursor(feed("?limit=2&sort=relevance"));
        assertThat(cursor).isNotNull();

        // The one thing that reorders EVERY campaign at once rather than one of them.
        // #42 pinned the decay clock in the cursor so the score could not move on its
        // own; a weight is a sort key whose definition is mutable at run time, which is
        // what "tunable without a deployment" introduces and what the version digest in
        // the fingerprint answers.
        only("recency");

        ResponseEntity<Map<String, Object>> response =
                get("/v1/discover?limit=2&sort=relevance&cursor=" + cursor, new HttpHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_CURSOR_MISMATCH");

        // And the same cursor against the weights it was issued for still works, so
        // what was refused is the change rather than the cursor.
        only("completion");
        assertThat(get("/v1/discover?limit=2&sort=relevance&cursor=" + cursor, new HttpHeaders())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // The editorial term reads #48's view
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a badge that expires with its collection stops contributing")
    void theEditorialTermExpiresWithTheCollection() {
        only("editorial");
        assertThat(slugs(feed("?limit=100&sort=relevance"))).startsWith("badged-pick");

        // The window predicate lives inside project_editorial_badges (V14), which is
        // the only definition of "editorially featured" on the platform. Closing the
        // collection therefore has to remove the badge from the ranking without this
        // term knowing the rule — and if the term had been written as a join to
        // collection_projects instead, a campaign in last spring's expired theme would
        // still be ranked as a staff pick.
        new JdbcTemplate(dataSource)
                .update("UPDATE collections SET closes_at = now() - interval '1 day' WHERE slug = 'ranking-picks'");

        List<String> after = slugs(feed("?limit=100&sort=relevance"));
        assertThat(after).hasSize(6);
        // Everything now scores zero, so nothing is above anything; what is asserted is
        // that the badged campaign has stopped being singled out.
        assertThat(slugs(feed("?limit=100&showOnly=featured"))).isEmpty();
        assertThat(after).containsAll(List.of("badged-pick", "nearly-funded"));
    }

    // ------------------------------------------------------------------
    // Arithmetic that must not fall over
    // ------------------------------------------------------------------

    @Test
    @DisplayName("no goal, no pledge, no launch, and a campaign far past its goal all score sanely")
    void boundaryArithmeticNeverDividesByZeroOrTopsTheFeed() {
        UUID creator = Campaigns.creator(dataSource, "ranking-creator");
        // PRELAUNCH has neither a goal nor a launch instant, so it is the row on which
        // both the completion divisor and the recency age are absent at once. A NULL
        // score sorts FIRST under DESC in PostgreSQL. It is not listed at all — nobody
        // has reviewed it — so whatever its score, it must not reach the feed.
        Campaigns.seed(dataSource, creator, "no-goal-no-launch")
                .state("PRELAUNCH")
                .category("games")
                .insert();
        campaign("zero-pledged", "1000.00", "0.00", Instant.now().minus(40, ChronoUnit.DAYS), "Heç nə");
        campaign("far-past-goal", "1000.00", "999999.99", Instant.now().minus(40, ChronoUnit.DAYS), "Rekord");

        // Under the seeded weights, which is the configuration a deployment starts on.
        List<String> defaults = slugs(feed("?limit=100&sort=relevance"));
        assertThat(defaults).hasSize(8);
        assertThat(defaults).doesNotHaveDuplicates();
        assertThat(defaults).doesNotContain("no-goal-no-launch");

        // And with each edge's own term alone, where a division by zero or a NaN would
        // have nothing else to hide behind.
        only("completion");
        List<String> byCompletion = slugs(feed("?limit=100&sort=relevance"));
        assertThat(byCompletion).startsWith("far-past-goal");
        assertThat(byCompletion).hasSize(8);
        assertThat(byCompletion).doesNotContain("no-goal-no-launch");
        assertThat(byCompletion.indexOf("zero-pledged")).isGreaterThan(byCompletion.indexOf("nearly-funded"));

        only("recency");
        List<String> byRecency = slugs(feed("?limit=100&sort=relevance"));
        assertThat(byRecency).startsWith("just-launched");
        assertThat(byRecency).hasSize(8);
        assertThat(byRecency).doesNotHaveDuplicates();

        // The exact amounts are still exact: a completion computed through a double
        // would put a campaign at exactly its goal on the wrong side of the band.
        assertThat(slugs(feed("?limit=100&sort=relevance&completion=over_100")))
                .containsExactly("far-past-goal");
    }

    /** Every page of a feed, in order, until the cursor runs out. */
    private List<String> walk(String query) {
        List<String> seen = new ArrayList<>();
        String cursor = null;
        for (int page = 0; page < 30; page++) {
            Map<String, Object> body = feed(query + (cursor == null ? "" : "&cursor=" + cursor));
            seen.addAll(slugs(body));
            cursor = nextCursor(body);
            if (cursor == null) {
                break;
            }
        }
        assertThat(cursor).isNull();
        return seen;
    }
}
