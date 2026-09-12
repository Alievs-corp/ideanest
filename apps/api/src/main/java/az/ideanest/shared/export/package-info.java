/**
 * Handing somebody a file, and the rules that apply whatever is in it.
 *
 * <p>{@link az.ideanest.shared.export.Csv} is the whole of it: the formula-injection
 * defence and the byte order mark, stated once. Two surfaces hand out spreadsheets — the
 * campaign's backer report (§4.7's CD-11) and #23's subscription revenue report — and both
 * carry strings somebody else typed, so both need the same defence. A second copy of it is
 * a copy that gets fixed in one place and stays broken in the other.
 *
 * <p>In {@code shared} rather than in either module for that reason alone. Nothing about
 * escaping a cell belongs to pledges or to subscriptions.
 */
package az.ideanest.shared.export;
