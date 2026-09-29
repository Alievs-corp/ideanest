package az.ideanest.shared;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Ties {@link Slugs#RESERVED} to the web's routes (#148).
 *
 * <p>A creator slug fills {@code /projects/[id]} and a campaign slug fills
 * {@code /projects/[id]/[projectSlug]}. Any static directory beside either
 * dynamic segment wins over it, so every such directory name has to be a word
 * no slug can take.
 */
class ReservedSlugsTests {

    /** From {@code apps/api}, which is where Gradle runs the tests. */
    private static final Path PROJECTS = Path.of("../web/src/app/[locale]/projects");

    @Test
    @DisplayName("every static route beside a creator or campaign slug is reserved")
    void everyStaticSiblingIsReserved() {
        Set<String> statics = staticChildren(PROJECTS);
        statics.addAll(staticChildren(PROJECTS.resolve("[id]")));

        assertThat(statics)
                .as("the web's route directories were found; nothing found would pass vacuously")
                .contains("new", "back", "edit", "dashboard", "prelaunch");
        assertThat(Slugs.RESERVED)
                .as("a static child under /projects or /projects/[id] that a slug could shadow")
                .containsAll(statics);
    }

    @Test
    @DisplayName("every reserved word is something slugify could produce")
    void reservedWordsAreSlugShaped() {
        // A reserved word slugify could never produce would guard nothing.
        assertThat(Slugs.RESERVED).allSatisfy(word -> assertThat(Slugs.slugify(word)).isEqualTo(word));
    }

    private static Set<String> staticChildren(Path directory) {
        try (Stream<Path> children = Files.list(directory)) {
            return children
                    .filter(Files::isDirectory)
                    .map(child -> child.getFileName().toString())
                    // [dynamic] segments and (group) folders are not addresses.
                    .filter(name -> !name.startsWith("[") && !name.startsWith("(") && !name.startsWith("_"))
                    .collect(Collectors.toCollection(TreeSet::new));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
