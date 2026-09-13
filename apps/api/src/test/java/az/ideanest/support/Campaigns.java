package az.ideanest.support;

import az.ideanest.project.infrastructure.CategoryRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Puts a campaign into the state a test needs to start from, by writing the row.
 *
 * <p><strong>For suites that are not testing the lifecycle.</strong> The honest way
 * into {@code LIVE} is the four requests a creator actually makes — submit,
 * approve, launch, and a moderator to do the middle one — and
 * {@code ProjectLifecycleApiTests} takes it, because that path is what it is
 * checking. A suite about reward tiers is not: driving every one of its fixtures
 * through moderation would make each of its tests depend on the moderation
 * configuration and on a second account sharing one rate limiter, for a campaign
 * whose state is a precondition rather than a subject.
 *
 * <p>What is written is exactly what the launch transition writes — the state, the
 * launch instant, and the deadline computed from the duration — so the row that
 * results is one the application could have produced. Every check constraint on
 * {@code projects} still applies, including
 * {@code projects_public_states_are_fully_specified}, which is why the goal and the
 * duration are filled in here when the campaign has none.
 *
 * <p>What is <em>not</em> written is the audit row. A campaign launched this way has
 * a history that does not mention its launch, so a test that reads
 * {@code project_state_transitions} must not use this.
 */
public final class Campaigns {

    /** What a campaign gets when a test did not care. Inside §5.3's 1–60 days. */
    private static final int DEFAULT_DURATION_DAYS = 30;

    private Campaigns() {
    }

    /** Takes the campaign live, as of now, keeping any goal and duration it already has. */
    public static void launch(DataSource dataSource, UUID projectId) {
        int updated = new JdbcTemplate(dataSource)
                .update(
                        """
                        UPDATE projects
                           SET state = 'LIVE',
                               goal_amount = COALESCE(goal_amount, 5000.00),
                               duration_days = COALESCE(duration_days, ?),
                               launched_at = now(),
                               deadline = now() + make_interval(days => COALESCE(duration_days, ?))
                         WHERE id = ?
                        """,
                        DEFAULT_DURATION_DAYS,
                        DEFAULT_DURATION_DAYS,
                        projectId);

        if (updated != 1) {
            // A fixture that silently launched nothing would leave every assertion
            // after it passing against a draft.
            throw new IllegalStateException("No campaign " + projectId + " to launch");
        }
    }

    /**
     * Takes a campaign to {@code COLLECTING}: closed above goal, cards being charged.
     *
     * <p><strong>Written rather than driven, and there is no honest way to drive
     * it.</strong> {@code SUCCESSFUL → COLLECTING} is the batched collection of epic
     * #59, which is blocked on choosing a payment provider (#60), so nothing in the
     * service performs that edge yet. A suite about what happens <em>after</em>
     * collection — late pledges (#81), and eventually fulfilment — would otherwise have
     * no way to reach its own starting state.
     *
     * <p>What is written is what the two transitions would leave behind: the deadline
     * in the past, the outcome frozen as §5.1 freezes it, and the state a collection
     * run would have set. What is not written is the two rows in
     * {@code project_state_transitions}, so a test that reads a campaign's history must
     * not use this.
     */
    public static void collecting(DataSource dataSource, UUID projectId) {
        launch(dataSource, projectId);
        int updated = new JdbcTemplate(dataSource)
                .update(
                        """
                        UPDATE projects
                           SET state = 'COLLECTING',
                               -- Moved back with the deadline, because
                               -- projects_deadline_follows_launch is a constraint
                               -- rather than a convention: a campaign that closed
                               -- yesterday launched before that.
                               launched_at = now() - make_interval(days => COALESCE(duration_days, 30) + 1),
                               deadline = now() - interval '1 day',
                               finalized_at = now() - interval '1 day',
                               outcome_goal_amount = goal_amount,
                               outcome_pledged_amount = goal_amount,
                               outcome_backers_count = backers_count
                         WHERE id = ?
                        """,
                        projectId);

        if (updated != 1) {
            throw new IllegalStateException("No campaign " + projectId + " to collect");
        }
    }

    /**
     * The one patch that takes a fresh draft to a campaign §5.3 will accept for
     * submission.
     *
     * <p>Here rather than copied into each suite because three test classes create
     * campaigns in order to submit them, and a fixture that is complete in two of
     * them and out of date in the third produces a failure about the fixture wearing
     * the name of the behaviour being tested. When §5.3 gains a requirement, this is
     * the one place the suites have to be taught about it.
     *
     * <p><strong>Deliberately only what blocks.</strong> No subcategory, no scheduled
     * launch, no reward tiers, and a story with no pictures in it — so a campaign
     * built from this is submittable and is not finished, which is exactly the
     * distinction the completeness checklist exists to draw and what
     * {@code ProjectChecklistApiTests} uses to tell advice apart from refusal.
     *
     * <p>Sent as a single body because that is what the editor's autosave would
     * eventually produce field by field, and because a fixture made of six requests
     * is a fixture whose failures are six times harder to read.
     */
    public static Map<String, Object> completeBasics(CategoryRepository categories) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("blurb", "A summary that fits inside a hundred and thirty-five characters.");
        body.put("categoryId", categories.findBySlug("games").orElseThrow().getId().toString());
        body.put("goal", Map.of("amount", "5000.00", "currency", "AZN"));
        body.put("durationDays", DEFAULT_DURATION_DAYS);
        // §5.3: at least 1024×576. The recorded dimensions are what the checklist
        // measures, because nothing on the server has ever seen the file.
        body.put("coverImage", Map.of("url", "https://cdn.example.com/cover.jpg", "width", 1600, "height", 900));
        body.put("story", story(600));
        // §5.3 requires two hundred characters, emphatically. A campaign that says
        // nothing about what could go wrong is the one that produces the refunds.
        body.put("risks", "The main risk is manufacturing capacity. ".repeat(6));
        return body;
    }

    /**
     * Removes every campaign and every tag, so a suite starts from a known set.
     *
     * <p>Discovery is the one module whose assertions are about <em>which</em>
     * campaigns come back and <em>how many</em>, so it cannot share a database with
     * whatever another suite happened to leave behind. Almost every foreign key into
     * {@code projects} cascades — rewards, items, story versions, collaborators,
     * reminders, tag edges, collection membership.
     *
     * <p><strong>{@code curation_events} is the exception, and it is deliberate.</strong>
     * V14 gives it no {@code ON DELETE} clause on either {@code collection_id} or
     * {@code project_id}, so a curated campaign cannot be hard deleted and the audit of
     * an editorial decision cannot be removed by removing what it was about. That is
     * the property the table exists for, and the cost is that this fixture has to say
     * so out loud: the audit rows and the collections go first, in that order, and a
     * suite that forgot would fail on a foreign key rather than quietly losing them.
     *
     * <p>Safe because JUnit runs test classes one at a time here: nothing is
     * configured for parallel execution, so no other suite is mid-run.
     */
    public static void clear(DataSource dataSource) {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM curation_events");
        jdbc.update("DELETE FROM collections");
        jdbc.update("DELETE FROM projects");
        jdbc.update("DELETE FROM tags");
        // V16 seeds eighteen Azerbaijani cities and nothing else, so every location
        // outside Azerbaijan is a fixture some suite inserted — see
        // {@link #location}. Removed here rather than by the suite that added it,
        // because a leftover row is not inert: it is a value in the country and city
        // facets, which the discovery suites count.
        //
        // After `projects`, and it has to be: V16 gives `projects.location_id` no ON
        // DELETE clause on purpose, so a location that campaigns still point at cannot
        // be deleted at all.
        jdbc.update("DELETE FROM locations WHERE country_code <> 'AZ'");
    }

    /**
     * A place outside V16's Azerbaijani seed, for a suite that needs a second country.
     *
     * <p>Idempotent per slug, like {@link #creator}, so a {@code @BeforeEach} that asks
     * twice gets one row. Removed by {@link #clear}.
     *
     * @param slug the folded comparable form, which is what {@code ?city=} matches
     * @param name the {@code az} row, which V16 makes mandatory and treats as the
     *     endonym
     */
    public static void location(
            DataSource dataSource, String slug, String countryCode, String latitude, String longitude, String name) {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update(
                """
                INSERT INTO locations (id, slug, country_code, latitude, longitude)
                VALUES (?, ?, ?, CAST(? AS numeric), CAST(? AS numeric))
                ON CONFLICT (slug) DO NOTHING
                """,
                UUID.randomUUID(),
                slug,
                countryCode,
                latitude,
                longitude);
        jdbc.update(
                """
                INSERT INTO location_translations (location_id, locale, name)
                SELECT id, 'az', ? FROM locations WHERE slug = ?
                ON CONFLICT (location_id, locale) DO NOTHING
                """,
                name,
                slug);
    }

    /**
     * An account to file campaigns under.
     *
     * <p>The minimum {@code users} will accept. No credentials row and no verified
     * email: discovery never authenticates anybody, and a fixture that signed in
     * would make every one of its tests depend on the rate limiter.
     *
     * <p>Idempotent for one handle. {@link #clear} removes campaigns and not accounts
     * — an account is referenced by sessions, credentials, and provider identities
     * that belong to other suites — so a {@code @BeforeEach} that asks for the same
     * creator twice gets the same row rather than a duplicate-key failure on the
     * second test in the class.
     *
     * @param handle becomes the slug and the local part of the email, so one argument
     *     keeps both unique
     */
    public static UUID creator(DataSource dataSource, String handle) {
        return creator(dataSource, handle, "Creator " + handle);
    }

    /**
     * The same, with a chosen display name.
     *
     * <p>#43 puts {@code users.name} in {@code projects.search_vector}, so a suite
     * about searching has to be able to say what a creator is called — "Creator
     * search-creator" is not a name anybody would type into a search box, and a test
     * that searched for it would be testing the fixture's naming convention.
     *
     * <p>Idempotent per handle like the overload above, and for the same reason: the
     * name is set on insert and a second call with a different one does not change
     * it, because the conflict clause does nothing. A test that needs a rename does
     * it explicitly — which is the point of that test.
     */
    public static UUID creator(DataSource dataSource, String handle, String name) {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update(
                "INSERT INTO users (id, email, name, slug) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING",
                UUID.randomUUID(),
                handle + "@example.com",
                name,
                handle);
        return jdbc.queryForObject("SELECT id FROM users WHERE email = ?", UUID.class, handle + "@example.com");
    }

    /**
     * A campaign written straight into the table, in whatever state a test needs.
     *
     * <p><strong>Why this exists beside {@link #launch}.</strong> Discovery is read
     * only and has to be tested against campaigns in all sixteen states of §6.1,
     * including the seven it must never return. Seven of those are unreachable through
     * the API without a moderator, an approval, and a suspension — and
     * {@code SUSPENDED} in particular is reachable only from {@code LIVE} through trust
     * and safety. Driving each fixture through that path would make a suite about
     * filtering depend on the whole moderation configuration.
     *
     * <p>Every check constraint on {@code projects} still applies, which is what keeps
     * these rows ones the application could have produced —
     * {@code projects_public_states_are_fully_specified} in particular, which is why
     * {@link Seed#state} fills in a goal, a duration, a launch, and a deadline for the
     * states that require all four.
     *
     * <p>As with {@link #launch}, no audit row is written. A test that reads
     * {@code project_state_transitions} must not use this.
     */
    public static Seed seed(DataSource dataSource, UUID creatorId, String slug) {
        return new Seed(dataSource, creatorId, slug);
    }

    /** @see #seed */
    public static final class Seed {

        /** Everything from LIVE onwards; §6.1 and projects_public_states_are_fully_specified. */
        private static final List<String> LAUNCHED_STATES = List.of(
                "LIVE", "SUSPENDED", "CANCELED", "SUCCESSFUL", "UNSUCCESSFUL",
                "COLLECTING", "LATE_PLEDGE", "FULFILLING", "COMPLETED",
                // IDN-EXT-01 (#32): past LIVE, so V74 holds them to the same four columns.
                "CLOSING_WINDOW", "EXTENDED", "WITHDRAWN");

        private final JdbcTemplate jdbc;
        private final UUID creatorId;
        private final String slug;
        private final UUID id = UUID.randomUUID();

        private String title;
        private String blurb = "A summary that fits inside a hundred and thirty-five characters.";
        private String storyJson;
        private String state = "DRAFT";
        private String categorySlug;
        private String subcategorySlug;
        private String locationSlug;
        private BigDecimal goal;
        private BigDecimal pledged = BigDecimal.ZERO;
        private int backers;
        private Instant launchedAt;
        private Instant deadline;
        private boolean withCover = true;
        private final List<String> tags = new ArrayList<>();

        private Seed(DataSource dataSource, UUID creatorId, String slug) {
            this.jdbc = new JdbcTemplate(dataSource);
            this.creatorId = creatorId;
            this.slug = slug;
            this.title = slug;
        }

        public Seed title(String value) {
            this.title = value;
            return this;
        }

        /** §4.3's "summary", and weight B of the search vector. */
        public Seed blurb(String value) {
            this.blurb = value;
            return this;
        }

        /**
         * One paragraph of story prose, as a story document.
         *
         * <p>Takes the prose rather than the document so that a test reads about what
         * the story says. The envelope is the one {@code StoryDocuments} validates,
         * because {@code ideanest_story_text} walks exactly that shape and a fixture
         * holding a different one would test nothing.
         */
        public Seed story(String prose) {
            this.storyJson = "{\"version\":1,\"blocks\":[{\"type\":\"paragraph\",\"spans\":[{\"text\":"
                    + quoted(prose) + ",\"marks\":[]}]}]}";
            return this;
        }

        /** One of the sixteen of §6.1. */
        public Seed state(String value) {
            this.state = value;
            return this;
        }

        public Seed category(String value) {
            this.categorySlug = value;
            return this;
        }

        /** Also sets the category if none was given, because the pair has to agree. */
        public Seed subcategory(String categorySlug, String value) {
            this.categorySlug = categorySlug;
            this.subcategorySlug = value;
            return this;
        }

        /**
         * Where the campaign is (#47), by {@code locations.slug}.
         *
         * <p>Left null by default, which is the state every campaign on the platform is
         * actually in — no write path sets {@code location_id} yet — and which is what
         * makes "a campaign with no location still appears under every other sort" a
         * fact the whole discovery suite happens to assert rather than one test does.
         */
        public Seed location(String value) {
            this.locationSlug = value;
            return this;
        }

        /** Money as a string, never a double — the fixture is held to the same rule as the code. */
        public Seed goal(String amount) {
            this.goal = new BigDecimal(amount);
            return this;
        }

        public Seed pledged(String amount) {
            this.pledged = new BigDecimal(amount);
            return this;
        }

        public Seed backers(int value) {
            this.backers = value;
            return this;
        }

        public Seed launchedAt(Instant value) {
            this.launchedAt = value;
            return this;
        }

        public Seed deadline(Instant value) {
            this.deadline = value;
            return this;
        }

        /** No cover image, for the card that has to render without one. */
        public Seed withoutCover() {
            this.withCover = false;
            return this;
        }

        /** Tag slugs; the rows in {@code tags} are created on demand and shared. */
        public Seed tags(String... slugs) {
            this.tags.addAll(List.of(slugs));
            return this;
        }

        public UUID insert() {
            Instant now = Instant.now();
            if (LAUNCHED_STATES.contains(state)) {
                // The constraint requires all four together, so defaulting them
                // individually would produce a row the application could not have
                // written.
                if (goal == null) {
                    goal = new BigDecimal("5000.00");
                }
                if (launchedAt == null) {
                    launchedAt = now.minus(Duration.ofDays(1));
                }
                if (deadline == null) {
                    deadline = launchedAt.plus(Duration.ofDays(DEFAULT_DURATION_DAYS));
                }
            }
            jdbc.update(
                    """
                    INSERT INTO projects (
                        id, creator_id, slug, title, blurb, story, category_id, subcategory_id,
                        location_id, state,
                        goal_amount, pledged_amount, backers_count, duration_days,
                        launched_at, deadline,
                        cover_image_url, cover_image_width, cover_image_height)
                    VALUES (
                        ?, ?, ?, ?, ?, CAST(? AS jsonb),
                        (SELECT id FROM categories WHERE slug = ?),
                        (SELECT s.id FROM subcategories s JOIN categories c ON c.id = s.parent_id
                          WHERE c.slug = ? AND s.slug = ?),
                        (SELECT id FROM locations WHERE slug = ?),
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    id,
                    creatorId,
                    slug,
                    title,
                    blurb,
                    storyJson,
                    categorySlug,
                    categorySlug,
                    subcategorySlug,
                    locationSlug,
                    state,
                    goal,
                    pledged,
                    backers,
                    launchedAt == null ? null : DEFAULT_DURATION_DAYS,
                    launchedAt == null ? null : OffsetDateTime.ofInstant(launchedAt, ZoneOffset.UTC),
                    deadline == null ? null : OffsetDateTime.ofInstant(deadline, ZoneOffset.UTC),
                    withCover ? "https://cdn.example.com/" + slug + ".jpg" : null,
                    withCover ? Integer.valueOf(1600) : null,
                    withCover ? Integer.valueOf(900) : null);

            for (String tag : tags) {
                // ON CONFLICT because tags are a free vocabulary shared between
                // campaigns; a fixture asking for a tag another fixture already made
                // must attach to the same row, or the facet counts would split.
                jdbc.update(
                        "INSERT INTO tags (id, slug, label) VALUES (?, ?, ?) ON CONFLICT (slug) DO NOTHING",
                        UUID.randomUUID(),
                        tag,
                        tag);
                jdbc.update(
                        "INSERT INTO project_tags (project_id, tag_id)"
                                + " SELECT ?, id FROM tags WHERE slug = ? ON CONFLICT DO NOTHING",
                        id,
                        tag);
            }
            return id;
        }

        /** A JSON string literal. Enough for prose; the fixture writes no control characters. */
        private static String quoted(String value) {
            return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
        }
    }

    /**
     * Everything an account needs before a campaign of theirs may be submitted.
     *
     * <p><strong>The one method a suite that submits should call</strong>, and the reason it
     * exists rather than a line per precondition in each suite. Submission has grown two
     * preconditions that have nothing to do with campaigns: a subscription since #368, and an
     * accepted creator agreement since #426. There are dozens of suites that submit; teaching
     * each of them about the second one would mean teaching each of them about the third.
     *
     * <p>So the preconditions live here and the suites say what they mean. {@code #426}'s own
     * tests and {@code ProjectPublishingGateTests} take the honest route and call the parts
     * separately, because the gates are what they are about.
     */
    public static void mayPublish(DataSource dataSource, UUID accountId) {
        subscribe(dataSource, accountId);
        acceptCreatorAgreement(dataSource, accountId);
    }

    /**
     * Records that an account accepted the creator agreement in force, if one is.
     *
     * <p><strong>A no-op when nothing is published</strong>, which is the state of every
     * suite that has not seeded a document — and is exactly what the gate does in that case.
     * {@code Agreements} argues why an unpublished agreement is not a requirement rather than
     * a platform-wide refusal; this fixture inherits that and needs no branch for it.
     *
     * <p>What is written is what {@code LegalAgreements.accept} would write: the governing
     * (Azerbaijani) version of the highest effective version, and no address, because a
     * fixture has no request. {@code ON CONFLICT DO NOTHING} against V65's
     * one-per-user-version index, so a second call is the first one.
     */
    public static void acceptCreatorAgreement(DataSource dataSource, UUID accountId) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO document_acceptances (id, user_id, document_id, accepted_at)
                        SELECT ?, ?, d.id, now()
                          FROM legal_documents d
                         WHERE d.kind = 'CREATOR_AGREEMENT'
                           AND d.locale = 'az'
                           AND d.published_at IS NOT NULL
                           AND d.effective_from <= now()
                         ORDER BY d.version DESC
                         LIMIT 1
                        ON CONFLICT DO NOTHING
                        """,
                        UUID.randomUUID(),
                        accountId);
    }

    /**
     * Gives an account the plan that publishing needs, by writing the row.
     *
     * <p><strong>For suites that are not testing subscriptions.</strong> Submission is
     * gated on an entitlement since V62, so a creator with no plan cannot reach
     * {@code SUBMITTED} at all -- and every suite that drives a campaign through review
     * would otherwise have to buy one first, which is the shape this class exists to
     * avoid. {@code SubscriptionApiTests} and {@code ProjectPublishingGateTests} take the
     * honest route, because the entitlement is what they are about.
     *
     * <p><strong>{@code PRO}, deliberately, and it is the seeded row rather than one this
     * method invents.</strong> Pro has no campaign limit and no goal ceiling, so a fixture
     * written this way constrains nothing a caller did not ask for: a suite about reward
     * tiers does not start failing the day somebody lowers what Starter allows. A test
     * that wants a limit to bite names its own plan.
     *
     * <p>What is written is what {@code Subscriptions.subscribe} would write for a free
     * plan -- state, window, and the price snapshot -- so the row is one the application
     * could have produced. What is not written is the audit entry, because nothing
     * activated it.
     *
     * <p>Idempotent against V62's one-open-per-account index: an account that already
     * holds one keeps it, rather than the second call failing three assertions away.
     */
    public static void subscribe(DataSource dataSource, UUID accountId) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO subscriptions
                            (id, account_id, plan_id, state, price, currency, billing_period,
                             started_at, current_period_end)
                        SELECT ?, ?, p.id, 'ACTIVE', p.price, p.currency, p.billing_period,
                               now(), now() + interval '30 days'
                          FROM subscription_plans p
                         WHERE p.code = 'PRO'
                        ON CONFLICT DO NOTHING
                        """,
                        UUID.randomUUID(),
                        accountId);
    }

    /** A valid story document holding one paragraph of the requested length. */
    public static Map<String, Object> story(int characters) {
        return Map.of(
                "version",
                1,
                "blocks",
                List.of(Map.of(
                        "type",
                        "paragraph",
                        "spans",
                        List.of(Map.of("text", "b".repeat(characters), "marks", List.of())))));
    }
}
