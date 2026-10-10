package az.ideanest.config;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.platform.api.MaintenanceFilter;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.util.matcher.RegexRequestMatcher;

/**
 * Who may reach what.
 *
 * <p>Deny by default. Every endpoint added from here on is unreachable until
 * someone states who may call it, which is the right way round: forgetting to
 * protect a new endpoint should produce a 401 in a test, not an open door in
 * production.
 */
@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {

    /**
     * Held by an account that is not being deleted.
     *
     * <p>Stated as something an active account <em>has</em> rather than as
     * something a closing one lacks, because the two fail in opposite
     * directions. A missing authority denies; a missing "is closing" flag
     * allows — so a token from an older release, a claim that failed to
     * serialise, or a converter that was not applied would all quietly let a
     * closed account carry on.
     */
    private static final String ACCOUNT_ACTIVE = "ACCOUNT_ACTIVE";

    /**
     * §10.2's {@code /v1/projects/{creatorSlug}/{projectSlug}}, and nothing that merely
     * looks like it.
     *
     * <p>Anchored at both ends, so it cannot match a longer path; two segments, neither
     * containing a slash; and the first one is refused if it is a UUID, which is what
     * separates the public page from every campaign sub-resource addressed by identifier.
     * See the rule below for why that is the discriminator and why it is written as an
     * exclusion.
     *
     * <p>The lookahead ends in {@code /} rather than in {@code $}, and the difference is
     * the whole of it: a UUID at the end of the string never occurs on this path — there
     * is always a second segment after it — so a lookahead anchored to the end would
     * always succeed and this pattern would silently match {@code /v1/projects/{id}/edit}.
     *
     * <p>The query string is not part of what this matches — {@code RegexRequestMatcher}
     * is given the servlet path — so a request cannot smuggle a second path past it.
     */
    private static final String PUBLIC_CAMPAIGN_PAGE =
            "^/v1/projects/(?![0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}"
                    + "-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)[^/]+/[^/]+$";

    @Bean
    public SecurityFilterChain apiSecurity(HttpSecurity http, MaintenanceFilter maintenance) throws Exception {
        return http.authorizeHttpRequests(requests -> requests
                        // The platform reads these to decide whether this
                        // instance takes traffic. They carry a status and no
                        // component detail; see application.yml.
                        .requestMatchers("/actuator/health", "/actuator/health/**")
                        .permitAll()
                        // ---- #214: is the platform open ------------------
                        // What clients poll during maintenance, so it must
                        // answer without a session: a reader cannot obtain one
                        // while a window is in force. Nothing in it belongs to
                        // anybody. GET only, for the categories rule's reason.
                        .requestMatchers(HttpMethod.GET, "/v1/status")
                        .permitAll()
                        // The published contract (#136). Public because that is
                        // what "published" means: §10.1 makes OpenAPI the way a
                        // client is written against this service, and a document
                        // behind a token is a document a build cannot fetch.
                        //
                        // It describes endpoints rather than exposing them. Every
                        // path in it is still governed by the rules below, so the
                        // administration surface being documented is not the
                        // administration surface being reachable — and a caller
                        // who has to read a specification to discover that
                        // /v1/admin exists was going to try it anyway.
                        //
                        // GET and nothing else, for the reason the categories rule
                        // gives.
                        .requestMatchers(HttpMethod.GET, "/v3/api-docs", "/v3/api-docs/**")
                        .permitAll()
                        // The category tree. Public because it is the discovery
                        // navigation: the same list, with nothing in it that
                        // belongs to a person, and cached for an hour. Read only —
                        // GET and nothing else, so that a write method added under
                        // the same path later does not inherit this.
                        .requestMatchers(HttpMethod.GET, "/v1/categories")
                        .permitAll()
                        // ---- #276: the location vocabulary ----------------
                        // V16's gazetteer, on the categories rule's terms and
                        // for its reason: it is reference data, the same closed
                        // vocabulary ?city= already filters on, and there is
                        // nothing in it that belongs to a person. The first
                        // caller is the profile editor, which is authenticated
                        // — but that is a fact about who asks first rather than
                        // about who may, and discovery's own city facet is the
                        // next caller and is not.
                        //
                        // What may be read is not decided here. There is only
                        // one answer: every row of a seeded eighteen-row table,
                        // named in the reader's language. Nothing is filtered,
                        // so there is no visibility rule to get wrong.
                        //
                        // GET and nothing else. Adding a place is the
                        // privileged, audited act V16 describes, and a write
                        // method under this path later must not inherit this.
                        .requestMatchers(HttpMethod.GET, "/v1/locations")
                        .permitAll()
                        // ---- end #276 -------------------------------------
                        // ---- §21.2's display currency (#327) --------------
                        //
                        // Public because the reader who most wants it has not
                        // signed in: somebody sent a campaign link, they think
                        // in dollars, and "≈ $29" beside the goal is the whole
                        // point. A token requirement would mean the
                        // approximation appeared only after registering.
                        //
                        // There is nothing personal in the answer. It is what a
                        // central bank published, which is why it is also one
                        // of the few reads on this platform a shared cache may
                        // hold.
                        //
                        // GET and nothing else, for the reason above it: a rate
                        // is written by a scheduled job reading a central bank,
                        // never by a caller, and a write method under this path
                        // later must not inherit this.
                        .requestMatchers(HttpMethod.GET, "/v1/exchange-rates")
                        .permitAll()
                        // ---- end #327 -------------------------------------
                        // The subscription plans a creator publishes under.
                        //
                        // Public because it is a price list, and a price list
                        // behind authentication is one nobody can decide to buy
                        // from: somebody weighing up whether to bring their
                        // campaign here reads it before they have an account,
                        // and the marketing site links straight to it.
                        //
                        // Nothing in the answer is personal -- it is what the
                        // platform charges everybody -- which is also why it is
                        // one of the few reads a shared cache may hold.
                        //
                        // GET and nothing else. Buying a plan is
                        // POST /v1/me/subscription and is somebody's, and the
                        // catalogue is written only from /v1/admin/plans.
                        .requestMatchers(HttpMethod.GET, "/v1/plans")
                        .permitAll()
                        // §22.2's documents, and §22.3's requirement that a
                        // person can read what they are agreeing to before they
                        // agree to it. Public for the reason the price list is,
                        // and more so: these are the pages a stranger and a
                        // regulator read, and terms of use behind
                        // authentication are terms nobody can decide to be
                        // bound by.
                        //
                        // Nothing in any answer belongs to a person -- it is the
                        // same text for everybody -- which is what lets them be
                        // Cache-Control: public for an hour, and an archived
                        // version for a month.
                        //
                        // GET and nothing else. Drafting and publishing are
                        // /v1/admin/legal/documents and need
                        // CONFIGURE_PLATFORM; accepting one is a side effect of
                        // submitting a campaign or confirming a pledge, both of
                        // which are somebody's.
                        .requestMatchers(HttpMethod.GET, "/v1/legal/documents", "/v1/legal/documents/**")
                        .permitAll()
                        // §5.5's update obligation, as a campaign page and a
                        // creator's profile draw it -- issue #437.
                        //
                        // Public, and that is the whole mechanism rather than a
                        // convenience. §22.3 names "the creator's project
                        // history visible" as the consequence that makes the
                        // obligation real, and the person it is meant to inform
                        // is the one deciding whether to back this creator
                        // again -- who has not signed in. Behind
                        // authentication, the fact would be visible to
                        // everybody except the audience it exists for.
                        //
                        // It is a fact and not a sanction. The response carries
                        // the dates the state is derived from, so a reader can
                        // check it rather than take it, and nothing in either
                        // answer belongs to a person -- which is what lets both
                        // be Cache-Control: public for five minutes.
                        //
                        // GET and nothing else. Resolving an escalation is
                        // /v1/admin/update-obligations and needs
                        // MODERATE_CONTENT; opening and closing a clock have no
                        // endpoint at all, because §8.3's outbox drives them.
                        .requestMatchers(
                                HttpMethod.GET,
                                "/v1/projects/*/update-obligation",
                                "/v1/creators/*/update-obligations",
                                // The same history addressed by slug, because the public
                                // profile is reached by slug and §4.2's projection
                                // deliberately carries no identifier.
                                "/v1/users/*/update-obligations")
                        .permitAll()
                        // §22.3's sixth product requirement: clear fee
                        // disclosure -- issue #439.
                        //
                        // Public for the reason the legal documents are. The
                        // audience is a backer deciding whether to pledge and a
                        // creator deciding whether to launch, and neither has
                        // necessarily signed in; a disclosure only staff can
                        // read is not one.
                        //
                        // Derived from `fee_schedules` rather than written into
                        // a catalogue, which is the whole point of the endpoint:
                        // the copy that said the platform charges nothing was
                        // true only because no schedule was seeded, and would
                        // have become false silently on the day one was.
                        //
                        // Nothing in the answer belongs to a person and a
                        // schedule changes a handful of times a year, so both
                        // are Cache-Control: public for an hour. Writing one is
                        // /v1/admin/fees and needs CONFIGURE_PLATFORM.
                        .requestMatchers(
                                HttpMethod.GET, "/v1/fees/disclosure", "/v1/projects/*/fee-disclosure")
                        .permitAll()
                        // Browsing, and the counts beside it. Public because
                        // discovery is the front door: a visitor who has not
                        // registered is exactly the audience it exists for, and
                        // requiring a token would mean the platform's own home
                        // page could not render.
                        //
                        // Nothing in either response belongs to a person, which
                        // is what lets them be Cache-Control: public. The one
                        // filter that would change that is showOnly=saved, and
                        // it is refused today — DiscoveryController carries the
                        // note about what has to change here when it is not.
                        //
                        // GET and nothing else, for the reason the categories
                        // rule gives.
                        //
                        // /v1/search and /v1/search/suggest are the same feed and
                        // the same reasoning with a query term attached (#43): a
                        // visitor who has not registered searching before deciding
                        // whether to is the audience, and a search box that demanded
                        // a token would be a search box nobody uses.
                        //
                        // /v1/collections and /v1/collections/{slug} are the same
                        // reasoning again (#48): D-08's curated collections and
                        // open-call landing pages are what the platform points a
                        // visitor at, and a staff-picks page behind a sign-in wall
                        // would be a staff-picks page nobody sees. Only collections
                        // the platform has published are reachable — an unpublished
                        // one answers 404 rather than 403, so this rule does not make
                        // an editorial decision in progress readable. The writes are
                        // under /v1/admin/collections and fall through to the rule
                        // below.
                        .requestMatchers(
                                HttpMethod.GET,
                                "/v1/discover",
                                "/v1/discover/facets",
                                "/v1/search",
                                "/v1/search/suggest",
                                "/v1/collections",
                                "/v1/collections/*")
                        .permitAll()
                        // A campaign's pre-launch page. Public because the people
                        // it exists to collect have not registered — that is what
                        // makes it a pre-launch page rather than a second editor
                        // screen. What may be read is not decided here: the
                        // handler serves it only for a campaign in PRELAUNCH or
                        // SCHEDULED and answers 404 for everything else,
                        // including a draft, so that this endpoint cannot be used
                        // to enumerate what other people are preparing.
                        //
                        // GET and nothing else, deliberately, for the reason the
                        // categories rule gives: POST on this exact path is the
                        // creator's DRAFT -> PRELAUNCH transition, and it falls
                        // through to the rule at the bottom.
                        .requestMatchers(HttpMethod.GET, "/v1/projects/*/prelaunch")
                        .permitAll()
                        // ---- #119: the public campaign page ---------------
                        // §4.4's page, at §10.2's /v1/projects/{creatorSlug}/
                        // {projectSlug}. Public because it is the platform: a
                        // campaign is shared, indexed and linked under this URL,
                        // and requiring a token would mean a crawler and a link
                        // unfurler are served nothing.
                        //
                        // What may be read is not decided here. PublicProjects
                        // serves it only for a campaign in one of §6.1's nine
                        // public states and answers 404 otherwise — including for
                        // a suspended one, so a guessed URL cannot confirm that
                        // trust and safety has stopped a campaign.
                        //
                        // **A regular expression, and this is the one place in
                        // this file that needs one.** The public page is two path
                        // segments and so is every campaign sub-resource reached
                        // by identifier: /v1/projects/*/* would match
                        // /v1/projects/{id}/edit as readily as
                        // /v1/projects/ayan/studio, and would therefore publish
                        // the campaign editor. Spring MVC tells the two apart
                        // because a literal segment beats a variable, but a
                        // security matcher has no route table to consult, so the
                        // distinction has to be written down: the public page is
                        // addressed by slugs, and a UUID in the first position is
                        // never it.
                        //
                        // Stated as "not a UUID" rather than as "a slug" on
                        // purpose. users_slug_shape permits lowercase letters,
                        // digits and hyphens, which is a superset of a UUID's
                        // spelling — so a pattern that described a slug would
                        // match every identifier as well, and the rule has to
                        // exclude rather than include to fail closed.
                        //
                        // GET and nothing else, for the reason the categories rule
                        // gives. There is no write on this path, and one added
                        // later must not inherit this.
                        .requestMatchers(RegexRequestMatcher.regexMatcher(
                                HttpMethod.GET, PUBLIC_CAMPAIGN_PAGE))
                        .permitAll()
                        // ---- end #119 -------------------------------------
                        // A campaign's reward list as a backer sees it. Public
                        // because §4.5 opens the pledge flow with it and the
                        // person reading it is deciding whether to register at
                        // all. What may be read is not decided here: the handler
                        // serves it only for a campaign in one of §6.1's nine
                        // public states and answers 404 otherwise, it omits
                        // secret tiers unless the request carries the token, and
                        // it omits tiers outside their availability window.
                        //
                        // GET and nothing else, for the reason the categories
                        // rule gives. Note that the creator's own reward list at
                        // /v1/projects/*/rewards is a different path and is not
                        // matched here: it falls through to the rule at the
                        // bottom and still requires a token, which is what keeps
                        // secret tiers and reservation counts out of reach.
                        .requestMatchers(HttpMethod.GET, "/v1/projects/*/rewards/public")
                        .permitAll()
                        // A campaign's backers as its page shows them (#57).
                        // Public because §4.4 puts the backer count in the
                        // header, a count beside every reward tier, and the
                        // community statistics on a tab — all of it on a page
                        // a visitor reads before deciding whether to register.
                        //
                        // What may be read is not decided here. The handler
                        // serves it only for a campaign in one of §6.1's nine
                        // public states and answers 404 otherwise, it counts
                        // only pledges that were confirmed rather than drafts
                        // in flight, and it carries no identity at all for a
                        // backer who asked to be anonymous — §4.5's PL-12,
                        // which PublicBacker enforces by having nowhere to put
                        // one rather than by remembering to omit it.
                        //
                        // GET and nothing else, for the reason the categories
                        // rule gives. Note that the creator's backer list at
                        // /v1/projects/*/backers is a different path and is
                        // deliberately not matched here: it is §10.2's
                        // dashboard endpoint, it names every backer including
                        // the anonymous ones because the creator has to ship to
                        // them, and it falls through to the rule at the bottom.
                        .requestMatchers(HttpMethod.GET, "/v1/projects/*/backers/public")
                        .permitAll()
                        // ---- #83: project updates -------------------------
                        // A campaign's Updates tab (§4.4). Public because §10.2
                        // lists this read under "Project — public" and because
                        // §5.5 makes updates the record of whether a creator
                        // keeps their promises — which is exactly what somebody
                        // reads before deciding to become a backer.
                        //
                        // What may be read is not decided here. The handler
                        // serves it only for a campaign in one of §6.1's nine
                        // public states and answers 404 otherwise, it omits
                        // updates whose publication time has not arrived, and it
                        // omits backers-only ones — see ProjectUpdateService,
                        // which is also where the campaign's own team is told
                        // apart from everybody else when a token is presented.
                        //
                        // GET and nothing else, for the reason the categories
                        // rule gives: POST on this exact path is the creator
                        // publishing an update, and it falls through to the rule
                        // at the bottom so that an account inside its deletion
                        // grace period cannot make new promises to backers.
                        .requestMatchers(HttpMethod.GET, "/v1/projects/*/updates")
                        .permitAll()
                        // ---- end #83 --------------------------------------
                        // ---- #84: comments --------------------------------
                        // A campaign's Comments tab (§4.4). Public because §10.2
                        // lists this read under "Project — public", and because
                        // what a visitor is weighing before they back a campaign
                        // is frequently the creator's answer to the question
                        // somebody else already asked.
                        //
                        // What may be read is not decided here. The handler
                        // serves it only for a campaign in one of §6.1's nine
                        // public states and answers 404 otherwise, and a removed
                        // comment is served as a tombstone with no text and no
                        // author — see CommentResponse, which is the one place
                        // that decision is made.
                        //
                        // GET and nothing else. POST on this exact path is
                        // somebody writing a comment, and it falls through to
                        // the rule at the bottom so that an anonymous caller and
                        // an account inside its deletion grace period are both
                        // refused. DELETE /v1/comments/* and the reply and report
                        // routes are deliberately not matched here either.
                        .requestMatchers(HttpMethod.GET, "/v1/projects/*/comments")
                        .permitAll()
                        // ---- end #84 --------------------------------------
                        // ---- #283: campaign FAQs --------------------------
                        // A campaign's FAQ tab (§4.4). Public because §10.2
                        // lists this read under "Project — public", and because
                        // §4.4 makes the tab part of the page a stranger reads
                        // before deciding whether to register: "will you ship
                        // to my country" is a question somebody asks while they
                        // are still deciding, and an answer behind a token is
                        // an answer given to the people who no longer need it.
                        //
                        // What may be read is not decided here. The handler
                        // serves it only for a campaign in one of §6.1's nine
                        // public states and answers 404 otherwise — see
                        // ProjectFaqService, which is also where the campaign's
                        // own team is told apart from everybody else when a
                        // token is presented, so that a creator can read the
                        // FAQ of a campaign that has not launched.
                        //
                        // GET and nothing else, for the reason the categories
                        // rule gives: POST on this exact path is the creator
                        // adding an entry, and it falls through to the rule at
                        // the bottom so that an anonymous caller and an account
                        // inside its deletion grace period are both refused.
                        // PATCH /v1/projects/*/faqs/reorder and the flat
                        // /v1/faqs/* routes are deliberately not matched here
                        // either.
                        .requestMatchers(HttpMethod.GET, "/v1/projects/*/faqs")
                        .permitAll()
                        // ---- end #283 -------------------------------------
                        // ---- #274: §4.2's public profile ------------------
                        // A person's own page and its two archives: what they
                        // created, and what they backed. Public because a profile
                        // read by somebody who has not registered is the audience
                        // it exists for -- the creator link on every campaign page
                        // points here, and #90's follow button is reached from it.
                        //
                        // WHAT MAY BE READ IS NOT DECIDED HERE, exactly as it is
                        // not for the two rules above. PublicProfiles refuses an
                        // account whose profile_visibility is PRIVATE, a closed
                        // account and a slug that never existed with one 404 --
                        // never a 403, which would confirm that the slug names a
                        // real account and so publish the one fact a withheld
                        // profile is withholding. The archives apply the same rule
                        // and drop what the reader may not see: a campaign in a
                        // non-public state, and §4.5's PL-12 anonymous pledges.
                        //
                        // GET AND NOTHING ELSE, and the exclusions matter more
                        // here than anywhere else in this list because three other
                        // handlers already answer under `/v1/users/*`. POST and
                        // DELETE `/v1/users/*/follow` are somebody subscribing in
                        // their own name, and POST `/v1/users/*/report` is somebody
                        // making an accusation in it; all three fall through to the
                        // rule at the bottom, so an anonymous caller cannot follow
                        // on another account's behalf or file an unattributable
                        // report.
                        .requestMatchers(
                                HttpMethod.GET,
                                "/v1/users/*",
                                "/v1/users/*/projects",
                                "/v1/users/*/backed")
                        .permitAll()
                        // `PATCH /v1/me/profile-visibility` -- P-07's switch, and
                        // the only write in this feature -- is deliberately absent.
                        // It is the account deciding about itself and falls through
                        // to the rule below with the rest of `/v1/me`.
                        // ---- end #274 -------------------------------------
                        // "Tell me when this opens", and "stop reminding me".
                        // Unauthenticated on purpose and bounded in the handler by
                        // a rate limiter per source address and per email address:
                        // an open write that promises to send mail is an open
                        // relay if it is left unbounded. The DELETE is public
                        // because the credential it accepts is the token in the
                        // message itself — an unsubscribe that required signing in
                        // would not be an unsubscribe.
                        .requestMatchers(HttpMethod.POST, "/v1/projects/*/remind")
                        .permitAll()
                        // ---- #91: §12.1's live counters --------------------
                        // The WebSocket handshake. Unauthenticated because both
                        // channels it serves are public — a campaign's pledge
                        // counter and how many comments have arrived, neither of
                        // which says anything the campaign page does not already
                        // show. §12.1's `user:{id}` and `project:{id}:dashboard`
                        // do carry something, and RealtimeChannel deliberately
                        // has no constant for either: they arrive when the socket
                        // authenticates, which is its own change.
                        //
                        // GET and nothing else, because a handshake is a GET with
                        // an Upgrade header. What bounds it is not this rule but
                        // RealtimeProperties' two session ceilings, and what
                        // decides who may open one is
                        // `ideanest.realtime.allowed-origins` — a handshake is
                        // not subject to CORS, so the origin check has to be the
                        // server's own.
                        .requestMatchers(HttpMethod.GET, "/v1/realtime")
                        .permitAll()
                        // ---- end #91 --------------------------------------
                        // "Somebody arrived here, from there" (#94). Public
                        // because the visits that decide an attribution happen
                        // before anybody signs in: a visitor reads a campaign
                        // for a week and registers at checkout, and an endpoint
                        // that required a token would only ever see the last
                        // step of that journey. Every campaign would then appear
                        // to convert nobody except the people who arrived
                        // already logged in, which is the one number §4.7's
                        // CD-03 exists to get right.
                        //
                        // An unauthenticated write, and bounded like the other
                        // one above: per source address, in the handler. It is
                        // not fraud protection and ReferralController says so —
                        // what actually keeps invented sources out of a
                        // creator's dashboard is that the report folds
                        // everything past a configured limit into one line.
                        //
                        // Nothing is revealed. The handler serves it only for a
                        // campaign in one of §6.1's public states and answers
                        // 404 otherwise, so it cannot be used to find out what
                        // other people are preparing, and the response is a
                        // token the caller will send back plus the moment it
                        // stops being useful.
                        //
                        // POST and nothing else. The creator's report at
                        // /v1/projects/*/referrers is a different path, is
                        // deliberately not matched here, and falls through to
                        // the rule at the bottom — it carries a campaign's
                        // marketing performance and every code that ever earned
                        // it a pledge.
                        .requestMatchers(HttpMethod.POST, "/v1/projects/*/referral-visits")
                        .permitAll()
                        .requestMatchers(HttpMethod.DELETE, "/v1/projects/*/remind")
                        .permitAll()
                        // §10.2's webhook endpoint (#66). The sender is a payment
                        // provider: there is no account, no token, and nothing
                        // for a bearer scheme to check.
                        //
                        // What stands in for authentication is stronger than one
                        // here and is applied a layer down: the body carries an
                        // HMAC the provider computed with a shared secret, and
                        // `PaymentProvider#parseWebhook` refuses anything whose
                        // signature does not verify before a single field is
                        // read. §17.2 adds a timestamp check against replay and
                        // V43's unique index makes a redelivery do nothing twice.
                        //
                        // One path, not a prefix. POST is the delivery. GET is #359's
                        // return: Payriff sends the backer's browser to the callback
                        // address, and the controller answers 303 to a checked site
                        // address — the same for every provider name, so it cannot be
                        // used to ask which providers the platform has adapters for.
                        .requestMatchers(HttpMethod.POST, "/v1/webhooks/psp/*")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/v1/webhooks/psp/*")
                        .permitAll()
                        // #243's local sandbox card page, temporary. A browser arrives
                        // here from a redirect and carries no bearer token, exactly as it
                        // arrives on Epoint's page. The controller exists only when the
                        // primary provider is SANDBOX, which refuses to start outside the
                        // local and test profiles, so everywhere else this matches nothing
                        // and answers 404.
                        .requestMatchers("/v1/sandbox/payout-cards/*")
                        .permitAll()
                        // How someone with no credentials gets one, and how a
                        // client whose access token expired gets another. Each
                        // authenticates by its own means — a password, a
                        // verification token, a refresh token, a provider ID
                        // token — so requiring an access token here would be
                        // circular.
                        .requestMatchers(
                                "/v1/auth/register",
                                "/v1/auth/verify-email",
                                "/v1/auth/login",
                                "/v1/auth/oauth/*",
                                "/v1/auth/refresh",
                                "/v1/auth/logout",
                                // The second half of a sign-in. The caller has
                                // no session yet — that is what it is for — and
                                // what stands in for one is a single-use
                                // challenge that expires in minutes and was
                                // only issued for a correct password.
                                //
                                // The other three two-factor endpoints are
                                // deliberately absent: enrolling, confirming,
                                // and disabling all require a bearer token, and
                                // fall through to the rule below.
                                "/v1/auth/2fa/verify",
                                // ---- #271: §4.1's A-06, password reset -------
                                // Both halves are unauthenticated by necessity:
                                // somebody who needs a reset is by definition
                                // somebody who cannot sign in, so requiring a
                                // token here would be circular in exactly the
                                // way the paragraph above describes.
                                //
                                // What authorises each is its own credential.
                                // `forgot-password` authorises nothing at all — it is a
                                // request to send mail, it answers 202 whether
                                // or not the address has an account, and it is
                                // bounded per source address and per email
                                // address by CredentialController. `reset-password`
                                // carries a single-use 256-bit token that was
                                // sent to the account's own address and expires
                                // in an hour.
                                "/v1/auth/forgot-password",
                                "/v1/auth/reset-password",
                                // `/v1/auth/change-password` is deliberately
                                // absent and falls through to the rule at the
                                // bottom: changing a password you know is not
                                // recovering one you do not, and it requires a
                                // bearer token as well as the current password.
                                // ---- end #271 -------------------------------
                                // ---- #277: §4.1's A-12, address change -------
                                // The CONFIRMATION only. The credential is the
                                // token in the message sent to the new address,
                                // exactly as it is for `/v1/auth/verify-email`,
                                // and requiring a session as well would mean the
                                // link only works in the browser that asked for
                                // it — which is the browser least likely to be
                                // signed in to the new mailbox.
                                //
                                // `/v1/auth/change-email` — the ask — is not
                                // here. It needs a bearer token and the current
                                // password, because the address on an account is
                                // what a reset is sent to, and moving it is the
                                // last step of taking the account over.
                                "/v1/auth/confirm-email-change")
                        .permitAll()
                        // What an account inside its deletion grace period may
                        // still do: look at itself, take its data with it, and
                        // change its mind. Listed rather than derived, so that
                        // adding an endpoint never quietly adds a permission.
                        .requestMatchers("/v1/me", "/v1/me/export", "/v1/me/deletion")
                        .authenticated()
                        // Moderation, and every administrative endpoint added
                        // under this prefix later.
                        //
                        // Authentication is all the filter chain can decide here.
                        // There is no role model anywhere in the service — not in
                        // the schema, not in the access token — so this matcher
                        // cannot tell platform staff from a creator, and being
                        // authenticated is emphatically not enough to approve a
                        // campaign. Who may is decided one layer in, by
                        // ProjectAccess.requireModeratable against the configured
                        // moderator list, which is empty by default: an endpoint
                        // added under this prefix without its own check therefore
                        // reaches its handler, and it is the handler's job to
                        // refuse.
                        //
                        // **Epic #100 owns administrative roles and audit.** When
                        // it lands this matcher becomes hasAuthority("MODERATOR")
                        // or equivalent, the configured list is deleted, and
                        // requireModeratable keeps its signature — which is why
                        // the interim control lives there rather than here.
                        .requestMatchers("/v1/admin/**")
                        .hasAuthority(ACCOUNT_ACTIVE)
                        // Everything else additionally requires that the account
                        // is not closing. The creator's project endpoints fall
                        // through to here deliberately: launching a campaign or
                        // taking a pledge is exactly what an account inside its
                        // deletion grace period must not be able to do.
                        .anyRequest()
                        .hasAuthority(ACCOUNT_ACTIVE))
                // Every other request authenticates with a bearer JWT we signed.
                // Stateless by construction: no lookup, which is also why
                // revoking a session cannot reach an access token already
                // issued. That window is the token's lifetime, and it is why
                // the lifetime is fifteen minutes.
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(accountStanding())))
                // #214's maintenance gate: after the bearer token has been
                // read, so it can let a staff token through, and before
                // authorization, so an anonymous request during a window gets
                // the maintenance answer rather than a 401 that would send the
                // client to a sign-in it cannot complete. MaintenanceFilter has
                // the list of what passes.
                .addFilterBefore(maintenance, AuthorizationFilter.class)
                // Stateless. No server-side session means nothing to fixate, and
                // nothing that has to be shared between instances.
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // An access token in an Authorization header is not sent
                // automatically by a browser, so for almost every endpoint here
                // there is no cross-site request to forge and Spring's token
                // repository would only add a round trip.
                //
                // The refresh cookie is the exception, and it is defended in
                // two ways rather than by this filter: SameSite=Strict, so the
                // browser does not attach it to a cross-site request at all,
                // and a required custom header on the endpoints that read it,
                // which a form post or an image tag cannot set. That is what
                // §17.3 asks for.
                .csrf(csrf -> csrf.disable())
                // No login form and no browser prompt. This is an API; an
                // unauthenticated call gets 401 and a client decides what to do.
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .anonymous(Customizer.withDefaults())
                .exceptionHandling(handling ->
                        handling.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .build();
    }

    /**
     * Turns the account's standing, as the token records it, into an authority.
     *
     * <p>An account inside its deletion grace period has said it is leaving.
     * Letting it pledge, launch a campaign, or post a comment in the meantime
     * creates obligations it has already announced it will not be around to
     * meet — and every one of those rows then outlives the account by law
     * rather than by choice. So it keeps exactly the three permissions listed
     * above and loses the rest, without any endpoint having to remember.
     *
     * <p>Read from the token rather than from the database, because the
     * alternative is a query on every authenticated request and the point of
     * this filter chain is that there is not one. The cost is that a token
     * minted before the deletion keeps working until it expires — the same
     * fifteen-minute window that already applies to revoking a session, bounded
     * by the same value, for the same reason.
     */
    private static JwtAuthenticationConverter accountStanding() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(token -> {
            boolean closing = Boolean.TRUE.equals(token.getClaim(AccessTokenIssuer.DELETION_PENDING_CLAIM));
            List<GrantedAuthority> authorities =
                    closing ? List.of() : List.of(new SimpleGrantedAuthority(ACCOUNT_ACTIVE));
            return authorities;
        });
        return converter;
    }
}
