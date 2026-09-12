package az.ideanest.subscription.application;

/**
 * The subscription revenue report as a file — #23.
 *
 * <p>{@code BackerExport}'s shape, for its reasons.
 *
 * @param filename what the browser should save it as: the period it covers and the day it
 *     was taken. Both, because an operator who exports September twice in a week has two
 *     files in one folder and "revenue.csv (2)" tells them nothing about which is which —
 *     and because a figure checked against a bank statement has to be traceable to the day
 *     it was pulled, since a backdated payment entered afterwards changes it
 * @param csv the whole document, materialised. Bounded by
 *     {@code ideanest.admin.subscription-revenue.export-row-cap}, which is what makes
 *     materialising it safe
 * @param rows how many payments it describes, not counting the header
 * @param truncated whether the cap was reached and the file is therefore short.
 *     <strong>Reported rather than silent</strong>: a revenue export missing its tail
 *     looks exactly like a complete one, and it will be added up
 */
public record RevenueExport(String filename, String csv, int rows, boolean truncated) {
}
