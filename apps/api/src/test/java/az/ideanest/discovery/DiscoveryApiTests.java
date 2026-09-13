package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.Campaigns;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code GET /v1/discover} over HTTP: what comes back, in what order, and what is
 * refused.
 *
 * <p>The fixture is seven campaigns chosen so that no two of them share a value on
 * any sort key and every filter dimension has at least three distinguishable groups.
 * That is what lets an assertion be {@code containsExactly} rather than
 * {@code contains}: an order that is merely plausible passes a containment check, and
 * the failure this suite exists to catch — a sort whose tiebreaker is missing, so two
 * rows swap between requests — is invisible to one.
 */
class DiscoveryApiTests extends DiscoveryTestSupport {

    private Instant now;

    /**
     * Seven campaigns, all distinguishable on every axis.
     *
     * <table>
     *   <caption>The fixture</caption>
     *   <tr><th>slug</th><th>state</th><th>filed under</th><th>goal</th><th>raised</th><th>%</th><th>backers</th><th>launched</th><th>deadline</th><th>tags</th></tr>
     *   <tr><td>alpha</td><td>LIVE</td><td>games/tabletop</td><td>1000</td><td>100</td><td>10</td><td>1</td><td>-5d</td><td>+25d12h</td><td>handmade</td></tr>
     *   <tr><td>bravo</td><td>LIVE</td><td>games/video</td><td>1000</td><td>250</td><td>25</td><td>2</td><td>-4d</td><td>+10d</td><td>handmade, ceramics</td></tr>
     *   <tr><td>charlie</td><td>LIVE</td><td>art/painting</td><td>5000</td><td>2500</td><td>50</td><td>3</td><td>-3d</td><td>+20d</td><td>ceramics</td></tr>
     *   <tr><td>delta</td><td>SUCCESSFUL</td><td>music/albums</td><td>20000</td><td>20000</td><td>100</td><td>4</td><td>-40d</td><td>-1d</td><td>—</td></tr>
     *   <tr><td>echo</td><td>CANCELED</td><td>film/short</td><td>50000</td><td>37500</td><td>75</td><td>5</td><td>-60d</td><td>-2d</td><td>—</td></tr>
     *   <tr><td>foxtrot</td><td>PRELAUNCH</td><td>comics</td><td>—</td><td>0</td><td>—</td><td>0</td><td>—</td><td>—</td><td>—</td></tr>
     *   <tr><td>golf</td><td>LATE_PLEDGE</td><td>games/tabletop</td><td>1000</td><td>3000</td><td>300</td><td>6</td><td>-50d</td><td>-5d</td><td>—</td></tr>
     * </table>
     *
     * <p>{@code foxtrot} earns its place by having no goal, no launch, and no deadline.
     * It is the row that finds a sort which forgot {@code NULLS LAST}, a completion
     * band that treats "no goal" as zero percent, and a card that cannot be built
     * without a cover image.
     */
    @BeforeEach
    void seedTheFixture() {
        Campaigns.clear(dataSource);
        now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        UUID creator = Campaigns.creator(dataSource, "discovery-creator");

        Campaigns.seed(dataSource, creator, "alpha")
                .state("LIVE")
                .subcategory("games", "tabletop")
                .goal("1000.00")
                .pledged("100.00")
                .backers(1)
                .launchedAt(now.minus(5, ChronoUnit.DAYS))
                // Twenty-five and a half days, not twenty-five: the half day is what
                // makes the rounding-up rule observable, and it keeps the assertion
                // deterministic. The instant a card counts down from is truncated to
                // the cache window, so a deadline exactly a whole number of days away
                // would round to that number or to one more depending on where in the
                // minute the request landed.
                .deadline(now.plus(25, ChronoUnit.DAYS).plus(12, ChronoUnit.HOURS))
                .tags("handmade")
                .insert();
        Campaigns.seed(dataSource, creator, "bravo")
                .state("LIVE")
                .subcategory("games", "video")
                .goal("1000.00")
                .pledged("250.00")
                .backers(2)
                .launchedAt(now.minus(4, ChronoUnit.DAYS))
                .deadline(now.plus(10, ChronoUnit.DAYS))
                .tags("handmade", "ceramics")
                .insert();
        Campaigns.seed(dataSource, creator, "charlie")
                .state("LIVE")
                .subcategory("art", "painting")
                .goal("5000.00")
                .pledged("2500.00")
                .backers(3)
                .launchedAt(now.minus(3, ChronoUnit.DAYS))
                .deadline(now.plus(20, ChronoUnit.DAYS))
                .tags("ceramics")
                .insert();
        Campaigns.seed(dataSource, creator, "delta")
                .state("SUCCESSFUL")
                .subcategory("music", "albums")
                .goal("20000.00")
                .pledged("20000.00")
                .backers(4)
                .launchedAt(now.minus(40, ChronoUnit.DAYS))
                .deadline(now.minus(1, ChronoUnit.DAYS))
                .insert();
        // CANCELED rather than UNSUCCESSFUL since IDN-EXT-01 (#37): an unsuccessful campaign is
        // not listed, and echo is the row every sort and band test counts on seeing.
        Campaigns.seed(dataSource, creator, "echo")
                .state("CANCELED")
                .subcategory("film", "short")
                .goal("50000.00")
                .pledged("37500.00")
                .backers(5)
                .launchedAt(now.minus(60, ChronoUnit.DAYS))
                .deadline(now.minus(2, ChronoUnit.DAYS))
                .insert();
        Campaigns.seed(dataSource, creator, "foxtrot")
                .state("PRELAUNCH")
                .category("comics")
                .withoutCover()
                .insert();
        Campaigns.seed(dataSource, creator, "golf")
                .state("LATE_PLEDGE")
                .subcategory("games", "tabletop")
                .goal("1000.00")
                .pledged("3000.00")
                .backers(6)
                .launchedAt(now.minus(50, ChronoUnit.DAYS))
                .deadline(now.minus(5, ChronoUnit.DAYS))
                .insert();
    }

    // -----------------------------------------------------------------------
    // Sorting
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the feed defaults to newest, with the campaigns that never launched last")
    void theDefaultSortIsNewest() {
        // Documented on DiscoverySort.NEWEST, and chosen because it is the only order
        // that is meaningful with no filter: ending-soon opens an unfiltered feed on
        // whatever finished longest ago.
        assertThat(slugs(feed("?limit=100")))
                .containsExactly("charlie", "bravo", "alpha", "delta", "golf", "echo", "foxtrot");
        assertThat(slugs(feed("?limit=100&sort=newest"))).isEqualTo(slugs(feed("?limit=100")));
    }

    @Test
    @DisplayName("ending soon runs from the closest deadline, with no deadline last")
    void endingSoonOrdersByDeadline() {
        assertThat(slugs(feed("?limit=100&sort=ending_soon")))
                .containsExactly("golf", "echo", "delta", "bravo", "charlie", "alpha", "foxtrot");
    }

    @Test
    @DisplayName("most funded orders by the amount raised, not by the percentage of the goal")
    void mostFundedOrdersByAmount() {
        // golf is at 300% and echo at 75%, and echo is above it: "most funded" is an
        // amount, and a campaign that raised 37,500 raised more than one that raised
        // 3,000 however modest its goal was.
        assertThat(slugs(feed("?limit=100&sort=most_funded")))
                .containsExactly("echo", "delta", "golf", "charlie", "bravo", "alpha", "foxtrot");
    }

    @Test
    @DisplayName("most backed orders by the number of backers")
    void mostBackedOrdersByBackers() {
        assertThat(slugs(feed("?limit=100&sort=most_backed")))
                .containsExactly("golf", "echo", "delta", "charlie", "bravo", "alpha", "foxtrot");
    }

    @Test
    @DisplayName("popularity favours money raised recently over money raised long ago")
    void popularityDecaysWithAge() {
        List<String> order = slugs(feed("?limit=100&sort=popularity"));

        // charlie raised 2,500 three days ago; delta raised 20,000 forty days ago.
        // Eight times the money and thirteen times the age: the decay is what makes
        // this a velocity approximation rather than a second most-funded.
        assertThat(order).containsSubsequence("charlie", "delta");
        // And a campaign that never launched has no velocity at all.
        assertThat(order).endsWith("foxtrot");
    }

    @Test
    @DisplayName("campaigns that tie on the sort key come back in the same order every time")
    void tiesAreBrokenDeterministically() {
        // Every order ends `, id ASC`. Without it a keyset cursor over a feed where
        // thousands of campaigns share a pledged_amount of zero would repeat and drop
        // rows at every page boundary — and the symptom would be intermittent.
        new JdbcTemplate(dataSource).update("UPDATE projects SET backers_count = 0");

        List<String> first = slugs(feed("?limit=100&sort=most_backed"));
        assertThat(slugs(feed("?limit=100&sort=most_backed"))).isEqualTo(first);
        assertThat(slugs(feed("?limit=100&sort=most_backed"))).isEqualTo(first);
        assertThat(first).hasSize(7);
    }

    // -----------------------------------------------------------------------
    // Each filter alone
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the status filter groups internal states into the five words a backer uses")
    void theStatusFilterMapsGroupings() {
        assertThat(slugs(feed("?limit=100&status=live"))).containsExactlyInAnyOrder("alpha", "bravo", "charlie");
        assertThat(slugs(feed("?limit=100&status=upcoming"))).containsExactly("foxtrot");
        // A campaign left in LATE_PLEDGE reached its goal, so it is successful.
        assertThat(slugs(feed("?limit=100&status=successful"))).containsExactlyInAnyOrder("delta", "golf");
        // Several statuses are OR'd: a campaign is in one state, so AND would return
        // nothing.
        assertThat(slugs(feed("?limit=100&status=upcoming,successful")))
                .containsExactlyInAnyOrder("foxtrot", "delta", "golf");
    }

    @Test
    @DisplayName("the category filter takes slugs, and several of them are OR'd")
    void theCategoryFilterTakesSlugs() {
        assertThat(slugs(feed("?limit=100&category=games"))).containsExactlyInAnyOrder("alpha", "bravo", "golf");
        assertThat(slugs(feed("?limit=100&category=games,comics")))
                .containsExactlyInAnyOrder("alpha", "bravo", "golf", "foxtrot");
    }

    @Test
    @DisplayName("the subcategory filter narrows within a category")
    void theSubcategoryFilterNarrows() {
        assertThat(slugs(feed("?limit=100&subcategory=tabletop"))).containsExactlyInAnyOrder("alpha", "golf");
        // Independent of the category filter and AND'd with it, so both are
        // expressible and the pair is not redundant.
        assertThat(slugs(feed("?limit=100&category=games&subcategory=video"))).containsExactly("bravo");
    }

    @Test
    @DisplayName("several tags mean every one of them, not any of them")
    void tagsAreAnded() {
        assertThat(slugs(feed("?limit=100&tag=handmade"))).containsExactlyInAnyOrder("alpha", "bravo");
        assertThat(slugs(feed("?limit=100&tag=ceramics"))).containsExactlyInAnyOrder("bravo", "charlie");
        // The decision documented on DiscoveryQuery: adding a tag narrows, because
        // every other filter on the panel narrows and a tag list that widened would
        // be the one control moving the count the other way.
        assertThat(slugs(feed("?limit=100&tag=handmade,ceramics"))).containsExactly("bravo");
        // Two unrelated tags return nothing, which is the visible, self-correcting
        // cost of that choice.
        assertThat(slugs(feed("?limit=100&tag=handmade,nothing-carries-this"))).isEmpty();
    }

    @Test
    @DisplayName("the completion filter puts each campaign in exactly one band")
    void completionBandsPartitionTheFeed() {
        assertThat(slugs(feed("?limit=100&completion=under_25"))).containsExactly("alpha");
        assertThat(slugs(feed("?limit=100&completion=25_to_50"))).containsExactly("bravo");
        assertThat(slugs(feed("?limit=100&completion=50_to_75"))).containsExactly("charlie");
        assertThat(slugs(feed("?limit=100&completion=75_to_100"))).containsExactly("echo");
        assertThat(slugs(feed("?limit=100&completion=over_100"))).containsExactlyInAnyOrder("delta", "golf");

        // Every band at once is every campaign that has a goal — and foxtrot, which
        // has none, is in no band rather than in the first one. A percentage of
        // nothing is undefined, not zero.
        assertThat(slugs(feed("?limit=100&completion=under_25,25_to_50,50_to_75,75_to_100,over_100")))
                .hasSize(6)
                .doesNotContain("foxtrot");
    }

    @Test
    @DisplayName("the goal and amount-raised filters take bands and a custom range")
    void moneyFiltersTakeBandsAndRanges() {
        assertThat(slugs(feed("?limit=100&goalBand=1000_to_5000")))
                .containsExactlyInAnyOrder("alpha", "bravo", "golf");
        assertThat(slugs(feed("?limit=100&goalBand=over_50000"))).containsExactly("echo");
        assertThat(slugs(feed("?limit=100&raisedBand=under_1000"))).containsExactlyInAnyOrder("alpha", "bravo", "foxtrot");

        // The custom range is inclusive at both ends, unlike the bands. A person
        // typing "from 2500 to 20000" into two boxes means both numbers included.
        assertThat(slugs(feed("?limit=100&raisedMin=2500&raisedMax=20000")))
                .containsExactlyInAnyOrder("charlie", "golf", "delta");
        assertThat(slugs(feed("?limit=100&goalMin=20000"))).containsExactlyInAnyOrder("delta", "echo");
    }

    // -----------------------------------------------------------------------
    // Filters composing
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a status and a category compose")
    void statusAndCategoryCompose() {
        // golf is in games and is not live; foxtrot is upcoming and is not in games.
        assertThat(slugs(feed("?limit=100&status=live&category=games"))).containsExactlyInAnyOrder("alpha", "bravo");
    }

    @Test
    @DisplayName("a tag and a completion band compose")
    void tagAndCompletionCompose() {
        assertThat(slugs(feed("?limit=100&tag=ceramics&completion=50_to_75"))).containsExactly("charlie");
    }

    @Test
    @DisplayName("a status, a money band, and a sort compose")
    void statusMoneyAndSortCompose() {
        assertThat(slugs(feed("?limit=100&status=live&goalBand=1000_to_5000&sort=most_backed")))
                .containsExactly("bravo", "alpha");
    }

    @Test
    @DisplayName("five filters at once still compose, and still narrow")
    void fiveFiltersCompose() {
        assertThat(slugs(feed(
                        "?limit=100&status=live&category=games&subcategory=tabletop&tag=handmade&completion=under_25")))
                .containsExactly("alpha");
        // One more filter that alpha fails, and the result is empty rather than
        // ignored — which is what "combinable" has to mean to be worth anything.
        assertThat(slugs(feed(
                        "?limit=100&status=live&category=games&subcategory=tabletop&tag=handmade&completion=over_100")))
                .isEmpty();
    }

    // -----------------------------------------------------------------------
    // Cursor pagination
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("walking the whole feed returns every campaign exactly once")
    void aFullWalkSeesEverythingOnce() {
        for (String sort : List.of("newest", "ending_soon", "most_funded", "most_backed", "popularity")) {
            List<String> seen = new ArrayList<>();
            String cursor = null;
            for (int page = 0; page < 20; page++) {
                Map<String, Object> body = feed("?limit=2&sort=" + sort + (cursor == null ? "" : "&cursor=" + cursor));
                seen.addAll(slugs(body));
                cursor = nextCursor(body);
                if (cursor == null) {
                    break;
                }
            }

            assertThat(cursor).withFailMessage("sort=%s never reached the end of the feed", sort).isNull();
            assertThat(seen)
                    .withFailMessage("sort=%s returned a campaign twice: %s", sort, seen)
                    .hasSize(new LinkedHashSet<>(seen).size());
            assertThat(seen)
                    .withFailMessage("sort=%s lost a campaign: %s", sort, seen)
                    .containsExactlyInAnyOrder("alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf");
            // And the paged order is the unpaged order, or the cursor is resuming
            // from somewhere the sort did not put it.
            assertThat(seen).isEqualTo(slugs(feed("?limit=100&sort=" + sort)));
        }
    }

    @Test
    @DisplayName("the last page says so by carrying no cursor, not by being short")
    void theEndOfTheFeedIsSignalledByAnAbsentCursor() {
        // Seven campaigns at three per page: 3, 3, 1. The third page is short *and*
        // has no cursor; the second is full and does. A client that stopped on a short
        // page would truncate a feed whose last page happened to be full.
        Map<String, Object> first = feed("?limit=3");
        assertThat(nextCursor(first)).isNotNull();
        Map<String, Object> second = feed("?limit=3&cursor=" + nextCursor(first));
        assertThat(nextCursor(second)).isNotNull();
        Map<String, Object> third = feed("?limit=3&cursor=" + nextCursor(second));
        assertThat(items(third)).hasSize(1);
        assertThat(nextCursor(third)).isNull();
    }

    @Test
    @DisplayName("a cursor issued for one sort is refused by another")
    void aCursorFromAnotherSortIsRefused() {
        String cursor = nextCursor(feed("?limit=2&sort=newest"));

        ResponseEntity<Map<String, Object>> response =
                get("/v1/discover?limit=2&sort=most_funded&cursor=" + cursor, new HttpHeaders());

        // Not a silent restart from page one: a client that read that as "there is
        // more" would append the same cards again with nothing reporting a problem.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_CURSOR_MISMATCH");
    }

    @Test
    @DisplayName("a cursor issued for one filter set is refused by another")
    void aCursorFromAnotherFilterIsRefused() {
        String cursor = nextCursor(feed("?limit=2"));

        ResponseEntity<Map<String, Object>> response =
                get("/v1/discover?limit=2&category=games&cursor=" + cursor, new HttpHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_CURSOR_MISMATCH");
    }

    @Test
    @DisplayName("a cursor this service did not issue is refused as invalid, not as a mismatch")
    void aForgedCursorIsRefused() {
        ResponseEntity<Map<String, Object>> response =
                get("/v1/discover?cursor=not-a-real-cursor", new HttpHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // A different code from a mismatch, because the fix is different: start
        // again from the first page rather than drop the cursor on a filter change.
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_CURSOR_INVALID");
    }

    @Test
    @DisplayName("a campaign whose funding changes mid-scroll neither repeats nor hides another")
    void aKeysetSurvivesTheAmountMovingUnderneathIt() {
        // THIS IS THE TEST THAT JUSTIFIES THE DESIGN. Under OFFSET pagination,
        // promoting a campaign from the bottom of the order to the top shifts every
        // row below it down by one, so `OFFSET 2` returns a row page one already
        // showed. On a funding platform pledged_amount moves continuously, so this is
        // not a rare race — it is what the feed does all day.
        Map<String, Object> first = feed("?limit=2&sort=most_funded");
        assertThat(slugs(first)).containsExactly("echo", "delta");
        String cursor = nextCursor(first);

        // alpha was last on the amount order at 100. It is now first.
        new JdbcTemplate(dataSource)
                .update("UPDATE projects SET pledged_amount = 99999.00 WHERE slug = 'alpha'");

        List<String> rest = new ArrayList<>();
        for (int page = 0; page < 20 && cursor != null; page++) {
            Map<String, Object> body = feed("?limit=2&sort=most_funded&cursor=" + cursor);
            rest.addAll(slugs(body));
            cursor = nextCursor(body);
        }

        // Nothing from page one comes back.
        assertThat(rest).doesNotContain("echo", "delta");
        // Nothing that stayed put is lost.
        assertThat(rest).contains("golf", "charlie", "bravo", "foxtrot");
        assertThat(rest).hasSize(new LinkedHashSet<>(rest).size());
        // alpha is legitimately absent: it moved above the point the scroll had
        // already passed. A keyset cursor shows a row that moves once or not at all,
        // which is the guarantee — it is not that a moving row is shown exactly once.
        assertThat(rest).doesNotContain("alpha");
    }

    // -----------------------------------------------------------------------
    // What is refused
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("an unimplemented sort is refused by name, not answered in a different order")
    void unimplementedSortsAreRefused() {
        // `relevance` used to be on this list and is not any more, because #44 landed:
        // §11.2's composite is served, and what it is made of — three live terms out of
        // eight, and five that say what is blocking them — is asserted by
        // RankingApiTests rather than hidden behind a refusal. What has not changed is
        // that there is no third option: served, or refused by name.
        assertThat(get("/v1/discover?sort=relevance", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // `near_me` used to be on this list too, and #47 is why it is not: V16 brought
        // the locations schema and the earthdistance arithmetic, and the sort is served
        // on both endpoints. Every sort §4.3 lists is now implemented — nothing is
        // refused with DISCOVERY_OPTION_UNSUPPORTED any more — which is asserted here
        // rather than assumed, because the alternative failure is a sort that answers
        // 200 in somebody else's order.
        assertThat(get("/v1/discover?sort=near_me&near=40.41,49.87", new HttpHeaders())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // What has not changed: a sort that is not a sort is still refused with the
        // list of the ones that are.
        ResponseEntity<Map<String, Object>> response = get("/v1/discover?sort=nearest", new HttpHeaders());
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_VALUE_UNKNOWN");
    }

    @Test
    @DisplayName("near me needs an origin, and says so rather than falling back to another order")
    void nearMeNeedsAnOrigin() {
        // #47. The refusal moved rather than disappeared: `sort=near_me` alone is no
        // longer DISCOVERY_OPTION_UNSUPPORTED, because the option exists — it is
        // DISCOVERY_VALUE_UNKNOWN naming `near`, because a distance from no origin is
        // undefined and a near-me control that quietly meant newest is exactly the
        // silent fallback DiscoveryCapability exists to prevent.
        ResponseEntity<Map<String, Object>> response = get("/v1/discover?sort=near_me", new HttpHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_VALUE_UNKNOWN");
        assertThat(response.getBody().get("meta").toString()).contains("near");

        assertThat(get("/v1/discover?sort=near_me&near=40.41,49.87", new HttpHeaders())
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("free-text search is served rather than refused, and narrows the feed")
    void searchTextIsServed() {
        // This test used to assert the opposite, and the change is #43 landing: `q` was
        // refused with a problem detail naming the issue, because accepting it and
        // ignoring it would have handed a backer who typed a search term every
        // campaign on the platform and told them the search works. It is now answered.
        // What has not changed is that there is no third option.
        assertThat(get("/v1/discover?q=alpha", new HttpHeaders()).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(slugs(feed("?q=alpha&limit=100"))).containsExactly("alpha");
        // And a term nothing matches is an empty feed rather than the whole platform,
        // which is the failure that would look like success.
        assertThat(items(feed("?q=qwertyuiop&limit=100"))).isEmpty();
    }

    @Test
    @DisplayName("show-only and location filters are refused, each naming what it needs")
    void unbuiltFiltersAreRefused() {
        // `showOnly=featured` used to be on this list and is not any more, because #48
        // landed: curation brought the collections schema and the capability set grew
        // by one constant. `showOnly=recommended` stays, deliberately — it is
        // personalisation (§11.2's w6, D-07) rather than curation, and answering it
        // with the platform's staff picks would tell every reader that an editorial
        // decision was made for them personally. What has not changed is that there
        // is no third option: served, or refused by name.
        //
        // `showOnly=recommended` survived #44 as well, and the issue it names changed:
        // the composite ranks campaigns and does not know who is reading, so §11.2's w6
        // is inert and this filter now names D-07 rather than #44. See
        // DiscoveryCapability.FILTER_RECOMMENDED.
        //
        // `country` and `city` used to be on this list and are not any more, because
        // #47 landed: V16 brought the `locations` table and `projects.location_id`, so
        // there is something to filter on. They are asserted the other way round below,
        // and the whole of their behaviour is DiscoveryProximityTests'.
        Map<String, String> refused = Map.of(
                "showOnly=saved", "saved-projects table",
                "showOnly=recommended", "D-07");

        for (Map.Entry<String, String> filter : refused.entrySet()) {
            ResponseEntity<Map<String, Object>> response =
                    get("/v1/discover?" + filter.getKey(), new HttpHeaders());

            assertThat(response.getStatusCode())
                    .withFailMessage("%s was not refused", filter.getKey())
                    .isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(response.getBody()).containsEntry("code", "DISCOVERY_OPTION_UNSUPPORTED");
            assertThat(response.getBody().get("meta").toString()).contains(filter.getValue());
        }

        // The two that are served now. A slug or a code nobody is filed under is an
        // empty feed rather than a 400 — an open vocabulary, like `category` — which
        // this fixture has none of, so both answer 200 with nothing.
        for (String served : List.of("country=AZ", "city=Baku")) {
            assertThat(get("/v1/discover?" + served, new HttpHeaders()).getStatusCode())
                    .withFailMessage("%s is still refused", served)
                    .isEqualTo(HttpStatus.OK);
        }
    }

    @Test
    @DisplayName("a value that is not one of a filter's values is refused, with the list")
    void unknownFilterValuesAreRefused() {
        ResponseEntity<Map<String, Object>> response = get("/v1/discover?status=finished", new HttpHeaders());

        // Not an empty page: "no campaigns match" and "your request was wrong" look
        // identical on a screen, and the person reading it concludes the platform has
        // nothing.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_VALUE_UNKNOWN");
        assertThat(response.getBody().get("meta").toString()).contains("live", "successful", "upcoming");

        assertThat(get("/v1/discover?sort=cheapest", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(get("/v1/discover?completion=nearly", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(get("/v1/discover?limit=lots", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(get("/v1/discover?goalMin=5000&goalMax=1000", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a slug that names nothing is an empty feed, not an error")
    void anUnknownSlugIsNotAnError() {
        // Categories and tags are data and change without a deployment. A link shared
        // before a category was renamed should show an empty feed rather than an
        // error page — which is the line between a closed vocabulary the API defines
        // and an open one the platform's content defines.
        assertThat(items(feed("?category=underwater-basketweaving"))).isEmpty();
        assertThat(items(feed("?tag=nothing-carries-this"))).isEmpty();
        assertThat(items(feed("?subcategory=not-a-subcategory"))).isEmpty();
    }

    @Test
    @DisplayName("an oversized page is clamped rather than refused")
    void theLimitIsClamped() {
        assertThat(items(feed("?limit=100000"))).hasSize(7);
        assertThat(items(feed("?limit=0"))).hasSize(1);
    }

    // -----------------------------------------------------------------------
    // The card, and the response
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a card carries D-05's fields, with the money as strings")
    void theCardIsTheProjectCard() {
        Map<String, Object> card = items(feed("?status=live&category=games&subcategory=tabletop")).getFirst();

        assertThat(card).containsKeys("id", "slug", "creatorSlug", "title", "creator", "image", "state");
        assertThat(card.get("slug")).isEqualTo("alpha");
        assertThat(card.get("badge")).isEqualTo("live");
        assertThat(card.get("backersCount")).isEqualTo(1);

        // Money is a string, never a number (§10.3, CLAUDE.md). So is the completion
        // percentage, which is a ratio of two money values and is the one number a
        // backer reads as "did it make it".
        assertThat(card.get("goal")).isEqualTo(Map.of("amount", "1000.00", "currency", "AZN"));
        assertThat(card.get("pledged")).isEqualTo(Map.of("amount", "100.00", "currency", "AZN"));
        assertThat(card.get("completionPercent")).isEqualTo("10.00");

        // Twenty-five and a half days to the deadline, rounded up: a campaign with
        // eighteen hours left must read "1 day" rather than "0 days" while it is
        // still taking pledges, and the same rule gives 26 here.
        assertThat(card.get("daysLeft")).isEqualTo(26);

        @SuppressWarnings("unchecked")
        Map<String, Object> creator = (Map<String, Object>) card.get("creator");
        assertThat(creator).containsKeys("name", "slug");
    }

    @Test
    @DisplayName("IDN-EXT-01: a campaign that ended without succeeding is not listed, and its old filter words are refused")
    void anUnsuccessfulCampaignIsNotListed() {
        UUID creator = Campaigns.creator(dataSource, "unsuccessful-creator");
        Campaigns.seed(dataSource, creator, "india")
                .state("UNSUCCESSFUL")
                .category("games")
                .launchedAt(now.minus(40, ChronoUnit.DAYS))
                .deadline(now.minus(9, ChronoUnit.DAYS))
                .insert();

        assertThat(slugs(feed("?limit=100"))).doesNotContain("india").hasSize(7);
        assertThat(slugs(search("?limit=100&q={q}", "india"))).doesNotContain("india");
        // Late pledge and unsuccessful are no longer filter words, so asking for them is a
        // 400 like any other unknown word rather than a filter that quietly matches nothing.
        assertThat(get("/v1/discover?status=unsuccessful", new HttpHeaders()).getStatusCode().value())
                .isEqualTo(400);
        assertThat(get("/v1/discover?status=late_pledge", new HttpHeaders()).getStatusCode().value())
                .isEqualTo(400);
    }

    @Test
    @DisplayName("IDN-EXT-01: cards carry closingSoon and extended, and a card can carry both")
    void cardsCarryTheTwoLabels() {
        UUID creator = Campaigns.creator(dataSource, "labelled-creator");
        Campaigns.seed(dataSource, creator, "window")
                .state("CLOSING_WINDOW")
                .category("games")
                .launchedAt(now.minus(40, ChronoUnit.DAYS))
                .deadline(now.minus(2, ChronoUnit.DAYS))
                .insert();
        Campaigns.seed(dataSource, creator, "extended-soon")
                .state("EXTENDED")
                .category("games")
                .launchedAt(now.minus(40, ChronoUnit.DAYS))
                .deadline(now.minus(5, ChronoUnit.DAYS))
                .extendedUntil(now.plus(10, ChronoUnit.DAYS).plus(12, ChronoUnit.HOURS))
                .insert();
        Campaigns.seed(dataSource, creator, "extended-later")
                .state("EXTENDED")
                .category("games")
                .launchedAt(now.minus(40, ChronoUnit.DAYS))
                .deadline(now.minus(5, ChronoUnit.DAYS))
                .extendedUntil(now.plus(40, ChronoUnit.DAYS))
                .insert();

        Map<String, Map<String, Object>> cards = new java.util.HashMap<>();
        for (Map<String, Object> item : items(feed("?limit=100"))) {
            cards.put((String) item.get("slug"), item);
        }

        // In the seven days after the first deadline: closing soon, whatever the clock says.
        assertThat(cards.get("window")).containsEntry("closingSoon", true).containsEntry("extended", false);
        assertThat(cards.get("window")).containsEntry("badge", "live");
        // Extended with ten and a half days to go: both labels, counted to the extension's end.
        assertThat(cards.get("extended-soon")).containsEntry("closingSoon", true).containsEntry("extended", true);
        assertThat(cards.get("extended-soon")).containsEntry("daysLeft", 11).containsEntry("badge", "live");
        // Extended with forty days to go: extended, not closing soon.
        assertThat(cards.get("extended-later")).containsEntry("closingSoon", false).containsEntry("extended", true);
        // Live: ten days (bravo) is closing soon, twenty (charlie) is not.
        assertThat(cards.get("bravo")).containsEntry("closingSoon", true);
        assertThat(cards.get("charlie")).containsEntry("closingSoon", false);
        // Successful campaigns are not.
        assertThat(cards.get("delta")).containsEntry("closingSoon", false).containsEntry("extended", false);

        assertThat(slugs(feed("?limit=100&status=extended")))
                .containsExactlyInAnyOrder("extended-soon", "extended-later");
        assertThat(slugs(feed("?limit=100&status=live")))
                .contains("window", "extended-soon", "extended-later");
    }

    @Test
    @DisplayName("a campaign with no goal, no deadline, and no image still renders as a card")
    void aPrelaunchCardOmitsWhatItDoesNotHave() {
        Map<String, Object> card = items(feed("?status=upcoming")).getFirst();

        assertThat(card.get("slug")).isEqualTo("foxtrot");
        assertThat(card.get("badge")).isEqualTo("upcoming");
        // Absent rather than null: the service omits null properties, and a client
        // must not try to tell the two apart.
        assertThat(card).doesNotContainKeys("goal", "completionPercent", "daysLeft", "image", "deadline");
        assertThat(card.get("pledged")).isEqualTo(Map.of("amount", "0.00", "currency", "AZN"));
    }

    @Test
    @DisplayName("a cancelled campaign is listed and carries no badge")
    void aCancelledCampaignHasNoBadge() {
        UUID creator = Campaigns.creator(dataSource, "cancelling-creator");
        Campaigns.seed(dataSource, creator, "hotel")
                .state("CANCELED")
                .category("games")
                .launchedAt(now.minus(2, ChronoUnit.DAYS))
                .deadline(now.plus(2, ChronoUnit.DAYS))
                .insert();

        Map<String, Object> card = items(feed("?limit=100")).stream()
                .filter(item -> "hotel".equals(item.get("slug")))
                .findFirst()
                .orElseThrow();

        // §4.3 has no word for it, so it is reachable by browsing and cannot be
        // singled out by a filter. Inventing a word for it would tell a reader
        // something about a withdrawn campaign that is not true.
        assertThat(card).doesNotContainKey("badge");
        assertThat(card.get("state")).isEqualTo("CANCELED");
    }

    @Test
    @DisplayName("the feed is readable without signing in")
    void theFeedIsPublic() {
        // Discovery is the front door. A visitor who has not registered is exactly
        // the audience it exists for, so requiring a token would mean the home page
        // could not render.
        assertThat(get("/v1/discover", new HttpHeaders()).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(get("/v1/discover/facets", new HttpHeaders()).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // -----------------------------------------------------------------------
    // Caching
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a client holding the current page is told nothing changed")
    void aConditionalRequestIsAnswered304() {
        ResponseEntity<Map<String, Object>> first = get("/v1/discover", new HttpHeaders());
        String etag = first.getHeaders().getETag();

        assertThat(etag).isNotBlank();
        // A minute, not an hour: pledged_amount and backers_count are on the card and
        // move continuously, so this is the longest a progress bar may be wrong in a
        // list.
        assertThat(first.getHeaders().getCacheControl()).contains("max-age=60");
        assertThat(first.getHeaders().getVary()).contains(HttpHeaders.ACCEPT_LANGUAGE);

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(etag);
        ResponseEntity<Map<String, Object>> second = get("/v1/discover", conditional);

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        // On the 304 as well: a cache that learns the rule only from the full
        // response has already stored the wrong thing by then.
        assertThat(second.getHeaders().getVary()).contains(HttpHeaders.ACCEPT_LANGUAGE);

        // Stable across calls. A tag derived from something that moves revalidates to
        // a 200 every time and is worse than no tag, because it looks like it works.
        assertThat(get("/v1/discover", new HttpHeaders()).getHeaders().getETag()).isEqualTo(etag);
    }

    @Test
    @DisplayName("a page that changed gets a new tag")
    void theTagFollowsTheContent() {
        String before = get("/v1/discover", new HttpHeaders()).getHeaders().getETag();

        new JdbcTemplate(dataSource).update("UPDATE projects SET pledged_amount = 900.00 WHERE slug = 'alpha'");

        assertThat(get("/v1/discover", new HttpHeaders()).getHeaders().getETag()).isNotEqualTo(before);
    }

    @Test
    @DisplayName("two queries do not share a tag")
    void theTagVariesWithTheQuery() {
        assertThat(get("/v1/discover?category=games", new HttpHeaders()).getHeaders().getETag())
                .isNotEqualTo(get("/v1/discover?category=art", new HttpHeaders())
                        .getHeaders()
                        .getETag());
    }
}
