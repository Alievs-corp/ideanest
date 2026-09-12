package az.ideanest.shared.export;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The CSV rules both of the platform's exports rely on.
 *
 * <p>They had no test of their own while they lived as a private method in
 * {@code BackerExportService}; moving them to a shared class is the moment a second caller
 * starts depending on exactly this behaviour, which is when it needs pinning.
 */
class CsvTests {

    @Test
    @DisplayName("a cell a spreadsheet would execute is defused with an apostrophe")
    void formulasAreDefused() {
        // A transfer reference is staff-typed and a display name is anybody's. Either,
        // opened in Excel, runs whatever it spells.
        assertThat(Csv.cell("=HYPERLINK(\"http://example.com\")")).startsWith("\"'=");
        assertThat(Csv.cell("+1")).isEqualTo("'+1");
        assertThat(Csv.cell("-1")).isEqualTo("'-1");
        assertThat(Csv.cell("@SUM(A1)")).isEqualTo("'@SUM(A1)");
    }

    @Test
    @DisplayName("a comma, a quote or a line break is quoted, and quotes inside are doubled")
    void separatorsAreQuoted() {
        assertThat(Csv.cell("Baku, Azerbaijan")).isEqualTo("\"Baku, Azerbaijan\"");
        assertThat(Csv.cell("the \"Growth\" plan")).isEqualTo("\"the \"\"Growth\"\" plan\"");
        assertThat(Csv.cell("two\nlines")).isEqualTo("\"two\nlines\"");
    }

    @Test
    @DisplayName("nothing and an empty string are both an empty cell")
    void absentIsEmpty() {
        assertThat(Csv.cell(null)).isEmpty();
        assertThat(Csv.cell("")).isEmpty();
        assertThat(Csv.cell("Günəl Məmmədova")).isEqualTo("Günəl Məmmədova");
    }

    @Test
    @DisplayName("the byte order mark is the one Excel looks for")
    void theByteOrderMarkIsUtf8s() {
        assertThat(Csv.BYTE_ORDER_MARK).isEqualTo("﻿");
        assertThat(Csv.NEWLINE).isEqualTo("\r\n");
    }
}
