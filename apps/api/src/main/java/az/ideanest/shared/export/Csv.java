package az.ideanest.shared.export;

/**
 * The two ways a CSV goes wrong, answered once.
 *
 * <p>Extracted from {@code BackerExportService} when #23's revenue report became the
 * second surface that hands somebody a spreadsheet. CLAUDE.md's rule about shared types
 * is the reason it is here rather than copied: a second implementation of the formula-
 * injection rule is a second implementation that can be fixed in one place and stay broken
 * in the other, and the one that stays broken is whichever surface nobody was thinking
 * about that day.
 *
 * <h2>Formula injection</h2>
 *
 * <p>A cell beginning {@code =}, {@code +}, {@code -} or {@code @} is executed by Excel
 * and by Sheets when the file is opened. Both of this platform's exports carry strings
 * somebody else chose — a backer's display name on one, a staff-entered transfer reference
 * on the other — so {@link #cell} prefixes those with an apostrophe, which the spreadsheet
 * strips on display and the parser does not execute.
 *
 * <h2>Encoding</h2>
 *
 * <p>{@link #BYTE_ORDER_MARK} begins the document, because Excel on Windows reads a
 * BOM-less UTF-8 file as the system code page and turns every Azerbaijani name into
 * mojibake. Three bytes, and they are what make the file openable by the tool the
 * recipients actually use.
 */
public final class Csv {

    /**
     * The three bytes that tell Excel the file is UTF-8.
     *
     * <p>Written as an escape rather than as the character itself: a literal byte order
     * mark inside a string literal is invisible in every editor, and the next person to
     * touch that line would delete it without seeing it.
     */
    public static final String BYTE_ORDER_MARK = "﻿";

    /** The line ending, CRLF, which is what RFC 4180 says and what Excel expects. */
    public static final String NEWLINE = "\r\n";

    private Csv() {
    }

    /** One cell, defused and quoted if it needs to be. Null and empty both give an empty cell. */
    public static String cell(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String cell = value;
        char first = cell.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r') {
            cell = "'" + cell;
        }
        if (cell.indexOf(',') >= 0 || cell.indexOf('"') >= 0 || cell.indexOf('\n') >= 0 || cell.indexOf('\r') >= 0) {
            return '"' + cell.replace("\"", "\"\"") + '"';
        }
        return cell;
    }
}
