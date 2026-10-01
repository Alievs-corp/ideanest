/**
 * Block 14 — "Report this campaign" at the foot of the page (#155), the web's `ReportControl` with
 * a campaign target.
 *
 * <h2>The seam, and why it draws nothing in this change</h2>
 *
 * The control's whole job is to open the report sheet: a modal with the nine reasons
 * (`@ideanest/campaign/report`), a detail capped at 2000 characters, the sign-in invitation for a
 * guest, and the filed state. That sheet is the reporting change of #155, which replaces this file
 * and adds the sheet beside it; the screen already renders `<ReportLink />` in the footer, under
 * the rewards on every tab, and passes it everything the sheet needs. Nothing else has to change
 * when it lands.
 *
 * Until then it renders nothing rather than a stand-in. The web's report is a dialog on the
 * campaign page, with no address of its own, so the only stand-in available — "Report this
 * campaign" opening the campaign's web page — would be a control whose label promises one thing
 * and whose press does another. The thin rule above the link is the link's own, so the page ends
 * at the rewards without a rule over nothing.
 *
 * Its props are the contract: the campaign's id (`POST /v1/projects/{id}/report`), its title (the
 * sheet's "Report {name}"), and whether the device is offline (the link is then disabled and says
 * why, as Save and Remind do).
 */
export interface ReportLinkProps {
  readonly projectId: string;
  readonly title: string;
  readonly offline: boolean;
}

export function ReportLink(_props: ReportLinkProps) {
  return null;
}
