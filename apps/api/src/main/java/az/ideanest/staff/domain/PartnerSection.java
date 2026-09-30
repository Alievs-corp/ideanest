package az.ideanest.staff.domain;

import az.ideanest.shared.access.StaffCapability;

/**
 * The console sections a super admin may open to a {@link StaffRole#PARTNER} beyond their own
 * statistics — #204, part of #202.
 *
 * <p><strong>Two, and the list is short on purpose.</strong> A section may be opened to a
 * partner only if nothing on its screens shows an individual transaction, the account behind
 * one, or a platform figure that is not scaled by the partner's percentage. Checked against
 * the console's sixteen modules, that leaves curation (collections, badges, placement and the
 * taxonomy) and system health (queue depth, failed jobs, provider status). Everything else
 * fails the test and is not representable here:
 *
 * <ul>
 *   <li>AD-05, AD-06, AD-07 and AD-11 show payments, refunds, disputes, fees, plans and
 *       revenue: individual transactions and unscaled totals.
 *   <li>AD-13 shows platform volume and success rate at 100%, which would hand a partner the
 *       real figure the percentage exists to withhold.
 *   <li>AD-14 names accounts and amounts in every row.
 *   <li>AD-02, AD-04 and AD-10 open personal data of creators and backers.
 *   <li>AD-12 and AD-15 sit behind {@link StaffCapability#CONFIGURE_PLATFORM}, which also
 *       changes the fee schedule.
 * </ul>
 *
 * <p><strong>A section is a capability, not a page.</strong> The API authorises by capability,
 * so opening a section means the partner holds the capability it names, computed from
 * {@code partner_section_grants} at request time by {@code StaffDirectory}. That is what makes
 * the server, and not the browser, the thing that refuses a section nobody opened. The price is
 * granularity: AD-03 and AD-08 are both {@link StaffCapability#CURATE}, so they open together
 * as {@link #CURATION}, and saying otherwise in the screen would describe a restriction that
 * does not exist.
 *
 * <p>Widening this enum is a schema change on purpose: V89's CHECK lists the names, so adding
 * one is a migration a reviewer reads, and never an API call.
 */
public enum PartnerSection {

    /** Collections, editorial badges, open calls, placement and the taxonomy. AD-03 and AD-08. */
    CURATION(StaffCapability.CURATE),

    /** Queue depth, failed jobs and provider status. AD-16. */
    HEALTH(StaffCapability.VIEW_HEALTH);

    private final StaffCapability capability;

    PartnerSection(StaffCapability capability) {
        this.capability = capability;
    }

    /** The one capability this section confers. */
    public StaffCapability capability() {
        return capability;
    }
}
