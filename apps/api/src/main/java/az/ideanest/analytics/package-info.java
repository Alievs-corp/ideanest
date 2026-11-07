/**
 * Aggregation of campaign metrics for creator-facing reporting.
 *
 * <p>§4.7's creator dashboard, of which two capabilities are built.
 *
 * <p><strong>CD-03, referral attribution (#94).</strong> A visit that carried a source
 * is recorded against an opaque visitor token, held for an attribution window, and
 * resolved to a pledge when one is confirmed — <strong>last non-direct touch inside the
 * window</strong>, which {@code domain.LastNonDirectTouch} states in full and V24's
 * header argues for.
 *
 * <p><strong>CD-01 and CD-02, the daily rollup (#95).</strong> §8.4's
 * {@code analytics-aggregator} recomputes {@code project_analytics_daily} hourly, so
 * that {@code GET /v1/projects/{id}/analytics} is two index range scans over a table
 * the size of the calendar rather than a scan of every pledge a campaign ever took.
 * {@code application.AnalyticsRollupService} is the pass and V27's header is the
 * argument, including the one decision that decides whether the numbers are right at
 * all: <strong>a "day" is a calendar day in one configured platform zone</strong>,
 * {@code ideanest.analytics.aggregation.zone}, read by the writer and by the reader and
 * frozen onto every row.
 *
 * <p><strong>This module reads nothing that belongs to another one.</strong> It learns
 * that a pledge exists from a published event and from nowhere else:
 * {@code application.ReferralAttributionListener} takes an {@code OutboxMessage} and
 * switches on its type, which is the shape {@code ApplicationEventOutboxDispatcher}
 * prescribes. Authorisation is asked through {@code shared.access.ProjectAuthorisation}
 * for {@code VIEW_FINANCES}, which is what the referral report exposes, and a
 * campaign's public facts come through the project module's application layer as
 * {@code PublicProjects} — because that is the only part of it another module may see.
 *
 * <p><strong>{@code pledge.confirmed} is published as of #238</strong>, so both features
 * carry traffic: a confirmed pledge produces an attribution, and the next scheduled pass
 * rolls it into {@code project_analytics_daily}. This paragraph said the opposite until
 * #238 landed — that nothing produced the event, and that both features were correct and
 * unexercised in that order — which was true when #94 and #95 were written and stopped
 * being true while #95 was open. {@code application.PledgeConfirmed} still carries the
 * older note in its own header; that file belongs to #238.
 *
 * <p><strong>Audience figures (#633).</strong> How many people visit the site, open a
 * campaign and click its card, per Baku day: {@code application.AudienceEventService}
 * counts, {@code application.AudienceReports} reads, V124's header has the privacy
 * argument. A person is a day-salted HMAC of address and agent and nothing is stored that
 * outlives its day; {@code projects.view_count} is written through the project module's
 * {@code CampaignViews}, because the column is that module's.
 *
 * <p>The rest of §4.7 is not built and is not stubbed here: the device split, the
 * conversion rate, the per-tier sales, the geography. <strong>CD-09, new versus
 * returning backers, is the one worth naming</strong>, because it looks like it belongs
 * to the rollup and cannot be computed there: {@code referral_attributions} carries no
 * backer identifier by design — V24 spends a paragraph on why a creator's report must
 * not be able to name the person behind a source — and the only other answer is
 * {@code pledges.backer_id}, which belongs to another module. It needs a signal that
 * does not exist yet rather than a column in {@code project_analytics_daily}.
 */
package az.ideanest.analytics;
