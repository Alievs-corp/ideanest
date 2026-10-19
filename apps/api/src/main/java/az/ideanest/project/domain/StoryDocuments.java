package az.ideanest.project.domain;

import az.ideanest.shared.Slugs;
import tools.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The story document: what a valid one is, and how long its prose is.
 *
 * <p>A pure static type with no Spring and no database in sight, for the same
 * reason {@link ProjectStateMachine} is one — the schema is a table of rules, and
 * a table of rules is worth testing on its own rather than through an HTTP
 * request that also had to authenticate, authorise, and open a transaction.
 *
 * <p><strong>Why the server validates a document the client just built.</strong>
 * The story is the one field of a campaign that is rendered as markup on a public
 * page (§10.4 calls creator story content untrusted by definition). Everything
 * the renderer is willing to draw has to be a shape it recognises, or the
 * renderer becomes the thing that decides what a {@code javascript:} URL means.
 * The client's own copy of these rules exists to give immediate feedback; this
 * one exists because the client is a program on somebody else's computer.
 *
 * <p><strong>Unknown properties are refused, not ignored.</strong> The usual
 * argument for tolerance — forward compatibility — does not apply to a document
 * carried by a versioned envelope: a new block property arrives with
 * {@link #SCHEMA_VERSION} incremented, and until then a property nothing reads is
 * a place to hide a payload that some later renderer might. The document is
 * stored verbatim, so anything accepted here is accepted forever.
 *
 * <p>The block union is exactly the epic contract §5 and
 * {@code docs/architecture.md} §4.6: headings, paragraphs, lists, quotes, rules,
 * inline images, third-party embeds, and titled sections with an optional image.
 * No block is added here without the public project page being taught to render
 * it, because a document containing one would validate and then display as
 * nothing.
 */
public final class StoryDocuments {

    /**
     * The envelope's version, which is the whole forward-compatibility story.
     *
     * <p>A document that says 2 is refused rather than read with the version-1
     * rules: a client that has been updated past this deployment must be told so,
     * not have its new blocks silently dropped on the next autosave.
     */
    public static final int SCHEMA_VERSION = 1;

    /**
     * The embeddable providers, and nothing else.
     *
     * <p>An allow-list rather than a URL check, because embedding is handing a
     * third party an {@code iframe} on our page. The two here are the ones §4.6
     * asks for; adding a third is a decision about whose scripts run beside a
     * payment flow, which is not a decision an editor should be able to make by
     * pasting a link.
     */
    public static final Set<String> EMBED_PROVIDERS = Set.of("youtube", "vimeo");

    /** {@code strong} and {@code em}. Contract §5; §4.6 calls it "emphasis". */
    private static final Set<String> MARKS = Set.of("strong", "em");

    /**
     * Headings are {@code h2} and {@code h3}.
     *
     * <p>{@code h1} is the campaign's title, which the page owns — a story that
     * could emit a second {@code h1} would give the page two documents' worth of
     * outline. Below {@code h3} the anchor navigation §4.6 asks for stops being
     * navigation and becomes a table of contents of a table of contents.
     */
    private static final int HEADING_MIN_LEVEL = 2;

    private static final int HEADING_MAX_LEVEL = 3;

    /**
     * A ceiling, so that one document cannot be made expensive to validate,
     * store, or render. Two thousand blocks is far beyond any campaign story that
     * has ever been read to the end, and a client hitting it is a client with a
     * bug rather than a creator with a lot to say.
     */
    private static final int MAX_BLOCKS = 2000;

    /** Guards against a single paragraph assembled from a hundred thousand spans. */
    private static final int MAX_SPANS_PER_BLOCK = 500;

    private static final int MAX_LIST_ITEMS = 200;

    private StoryDocuments() {
    }

    /**
     * Refuses anything that is not a story document.
     *
     * <p>Called on the {@code PATCH} path, so a story is validated by the same
     * route that stores it and there is no way to write one that has not been
     * through here.
     *
     * @throws StoryDocumentInvalidException naming what was wrong and where
     */
    public static void validate(JsonNode document) {
        if (document == null || document.isNull()) {
            // Clearing the story is legitimate — a creator starting again — and is
            // the caller's business rather than a document to check.
            return;
        }
        if (!document.isObject()) {
            throw invalid("", "A story is a document, not a single value.");
        }

        requireOnly(document, "", List.of("version", "blocks"));

        JsonNode version = document.get("version");
        if (version == null || !version.isInt()) {
            throw invalid("version", "A story document says which schema version it is written in.");
        }
        if (version.intValue() != SCHEMA_VERSION) {
            throw invalid(
                    "version",
                    "This service stores story documents of version " + SCHEMA_VERSION + ", not version "
                            + version.intValue() + ".");
        }

        JsonNode blocks = document.get("blocks");
        if (blocks == null || !blocks.isArray()) {
            throw invalid("blocks", "A story document is a list of blocks.");
        }
        if (blocks.size() > MAX_BLOCKS) {
            throw invalid("blocks", "A story holds at most " + MAX_BLOCKS + " blocks.");
        }

        // Heading identifiers are the anchor navigation of §4.6, so they are the
        // fragment of a URL somebody bookmarks. Two blocks claiming the same one
        // makes half those links land in the wrong place.
        Set<String> headingIds = new HashSet<>();

        for (int index = 0; index < blocks.size(); index++) {
            validateBlock(blocks.get(index), "blocks[" + index + "]", headingIds);
        }
    }

    /**
     * How many characters of prose the story holds, counted the way §5.3 means it.
     *
     * <p>Text a reader reads: heading text, paragraph and quote spans, list item
     * spans. <strong>Not</strong> an image's {@code alt} or an embed's title —
     * those describe media rather than being the story, and a campaign could
     * otherwise pass the five-hundred-character minimum with ten photographs and
     * no writing at all.
     *
     * <p>Code points rather than {@code String.length}, so that this agrees with
     * both the client's counter and PostgreSQL's idea of a character. An emoji is
     * one character in all three or the number on screen is a lie.
     *
     * <p>Tolerant of a malformed document on purpose: it is called by the
     * checklist (#37) and by the version list, both of which read documents that
     * are already stored, and one of them refusing to render a list because a row
     * written by an earlier version of these rules is no longer valid would be a
     * worse failure than a count that is slightly off.
     */
    public static int characterCount(JsonNode document) {
        if (document == null || !document.isObject()) {
            return 0;
        }
        JsonNode blocks = document.get("blocks");
        if (blocks == null || !blocks.isArray()) {
            return 0;
        }

        int total = 0;
        for (JsonNode block : blocks) {
            String type = textOrEmpty(block.get("type"));
            switch (type) {
                case "heading" -> total += codePoints(textOrEmpty(block.get("text")));
                case "paragraph", "quote" -> total += spanCharacters(block.get("spans"));
                case "section" -> total += codePoints(textOrEmpty(block.get("title")))
                        + spanCharacters(block.get("spans"));
                case "list" -> {
                    JsonNode items = block.get("items");
                    if (items != null && items.isArray()) {
                        for (JsonNode item : items) {
                            total += spanCharacters(item);
                        }
                    }
                }
                default -> {
                    // `rule`, `image`, `embed`, and anything an older document
                    // holds contribute no prose. A section's image alt does not
                    // either, for the reason an image block's does not.
                }
            }
        }
        return total;
    }

    /**
     * How many images and embeds the story holds.
     *
     * <p>The one thing the checklist asks about a story besides its length, and it
     * is advice rather than a rule: §4.6 gives the story inline media and
     * third-party embeds, a story of six unbroken paragraphs is read by almost
     * nobody, and §5.3 requires none of it. See
     * {@link ChecklistRequirement#STORY_MEDIA}.
     *
     * <p>Counted here rather than in the checklist for the reason
     * {@link #characterCount} is: the block union is this file's, and a second
     * place that knew what an {@code image} block looks like would be a second
     * place to update when one is added.
     *
     * <p>Tolerant of a malformed document, exactly as {@link #characterCount} is,
     * and for the same reason — it runs against documents that are already stored.
     */
    public static int mediaCount(JsonNode document) {
        if (document == null || !document.isObject()) {
            return 0;
        }
        JsonNode blocks = document.get("blocks");
        if (blocks == null || !blocks.isArray()) {
            return 0;
        }

        int total = 0;
        for (JsonNode block : blocks) {
            String type = textOrEmpty(block.get("type"));
            if ("image".equals(type) || "embed".equals(type)) {
                total++;
            } else if ("section".equals(type) && hasImage(block)) {
                total++;
            }
        }
        return total;
    }

    /**
     * Whether two documents say the same thing.
     *
     * <p>{@link JsonNode#equals} compares trees rather than text, so a client that
     * reordered {@code width} and {@code height} in one autosave has not changed
     * the story — and the version history should not gain a row saying it did.
     */
    public static boolean isSameDocument(JsonNode left, JsonNode right) {
        if (left == null || left.isNull()) {
            return right == null || right.isNull();
        }
        return left.equals(right);
    }

    // ------------------------------------------------------------------
    // Blocks
    // ------------------------------------------------------------------

    private static void validateBlock(JsonNode block, String path, Set<String> headingIds) {
        if (block == null || !block.isObject()) {
            throw invalid(path, "A block is an object.");
        }
        JsonNode type = block.get("type");
        if (type == null || !type.isString()) {
            throw invalid(path + ".type", "A block says what kind of block it is.");
        }

        switch (type.stringValue()) {
            case "heading" -> validateHeading(block, path, headingIds);
            case "paragraph" -> {
                requireOnly(block, path, List.of("type", "spans"));
                validateSpans(block.get("spans"), path + ".spans");
            }
            case "quote" -> {
                requireOnly(block, path, List.of("type", "spans"));
                validateSpans(block.get("spans"), path + ".spans");
            }
            case "list" -> validateList(block, path);
            case "rule" -> requireOnly(block, path, List.of("type"));
            case "image" -> validateImage(block, path);
            case "embed" -> validateEmbed(block, path);
            case "section" -> validateSection(block, path, headingIds);
            default -> throw invalid(
                    path + ".type",
                    "\"" + type.stringValue() + "\" is not a kind of story block. The kinds are heading, "
                            + "paragraph, list, quote, rule, image, embed, and section.");
        }
    }

    private static void validateHeading(JsonNode block, String path, Set<String> headingIds) {
        requireOnly(block, path, List.of("type", "level", "id", "text"));

        JsonNode level = block.get("level");
        if (level == null || !level.isInt() || level.intValue() < HEADING_MIN_LEVEL || level.intValue() > HEADING_MAX_LEVEL) {
            throw invalid(
                    path + ".level",
                    "A heading is level " + HEADING_MIN_LEVEL + " or " + HEADING_MAX_LEVEL
                            + "; level 1 is the campaign's title.");
        }

        String text = requireNonBlankText(block.get("text"), path + ".text", "A heading needs its text.");
        if (codePoints(text) > 200) {
            throw invalid(path + ".text", "A heading of more than 200 characters is a paragraph.");
        }

        requireAnchor(block, path, headingIds, "heading");
    }

    /**
     * A titled part of the story: an {@code h2} on the page, an optional image under the
     * title, then text.
     *
     * <p>The title follows a heading's rules and the id shares the headings' set, because
     * the anchor navigation lists a section exactly as it lists an {@code h2}. The
     * {@code image} key is required and may be null, so every section has one shape.
     */
    private static void validateSection(JsonNode block, String path, Set<String> headingIds) {
        requireOnly(block, path, List.of("type", "id", "title", "image", "spans"));

        String title = requireNonBlankText(block.get("title"), path + ".title", "A section needs its title.");
        if (codePoints(title) > 200) {
            throw invalid(path + ".title", "A section title of more than 200 characters is a paragraph.");
        }
        requireAnchor(block, path, headingIds, "section");

        JsonNode image = block.get("image");
        if (image == null) {
            throw invalid(path + ".image", "A section says whether it has an image: null when it has none.");
        }
        if (!image.isNull()) {
            if (!image.isObject()) {
                throw invalid(path + ".image", "A section's image is an object, or null.");
            }
            requireOnly(image, path + ".image", List.of("url", "width", "height", "alt"));
            validateImageFields(image, path + ".image");
        }

        validateSpans(block.get("spans"), path + ".spans");
    }

    /** A heading's or a section's anchor: a slug, unique across the document. */
    private static void requireAnchor(JsonNode block, String path, Set<String> headingIds, String kind) {
        String id = requireNonBlankText(
                block.get("id"), path + ".id", "A " + kind + " needs an id: it is the anchor the navigation links to.");
        if (!isSlug(id)) {
            throw invalid(
                    path + ".id",
                    "\"" + id + "\" is not usable as an anchor. A " + kind + " id is lowercase letters, digits, "
                            + "and single hyphens between them.");
        }
        if (!headingIds.add(id)) {
            // Duplicated anchors are the failure that looks like it works: every
            // link in the navigation resolves, and half of them scroll to the
            // wrong heading.
            throw invalid(path + ".id", "Two headings both use the anchor \"" + id + "\". Anchors are unique.");
        }
    }

    private static void validateList(JsonNode block, String path) {
        requireOnly(block, path, List.of("type", "ordered", "items"));

        JsonNode ordered = block.get("ordered");
        if (ordered == null || !ordered.isBoolean()) {
            throw invalid(path + ".ordered", "A list is either numbered or not; say which.");
        }

        JsonNode items = block.get("items");
        if (items == null || !items.isArray()) {
            throw invalid(path + ".items", "A list holds its items as an array.");
        }
        if (items.size() > MAX_LIST_ITEMS) {
            throw invalid(path + ".items", "A list holds at most " + MAX_LIST_ITEMS + " items.");
        }
        for (int index = 0; index < items.size(); index++) {
            // Each item is itself a run of spans, so a list item can be partly
            // bold. Contract §5: `items` is an array of arrays.
            validateSpans(items.get(index), path + ".items[" + index + "]");
        }
    }

    private static void validateImage(JsonNode block, String path) {
        requireOnly(block, path, List.of("type", "url", "width", "height", "alt"));
        validateImageFields(block, path);
    }

    /** What an image is, whether it is a block of its own or a section's. */
    private static void validateImageFields(JsonNode block, String path) {
        requireWebUrl(block.get("url"), path + ".url");
        requirePositiveInt(block.get("width"), path + ".width");
        requirePositiveInt(block.get("height"), path + ".height");

        // The rule this validator exists for as much as any other. An image
        // without a description is a paragraph of the story that a screen-reader
        // user simply does not receive, and by the time the campaign is live the
        // creator has moved on. There is no default worth inventing here: only
        // the person who chose the picture knows what it shows.
        requireNonBlankText(
                block.get("alt"),
                path + ".alt",
                "An image needs a description. It is what a backer using a screen reader receives "
                        + "instead of the picture.");
    }

    private static void validateEmbed(JsonNode block, String path) {
        requireOnly(block, path, List.of("type", "provider", "url", "title"));

        JsonNode provider = block.get("provider");
        if (provider == null || !provider.isString() || !EMBED_PROVIDERS.contains(provider.stringValue())) {
            throw invalid(
                    path + ".provider",
                    "Embeds are supported from " + String.join(" and ", sorted())
                            + " only, not from \"" + textOrEmpty(provider) + "\".");
        }

        requireWebUrl(block.get("url"), path + ".url");
        // The iframe's accessible name. Without it a screen reader announces
        // "frame" and the reader has to enter it to discover what it is.
        requireNonBlankText(block.get("title"), path + ".title", "An embed needs a title saying what it is.");
    }

    // ------------------------------------------------------------------
    // Spans
    // ------------------------------------------------------------------

    /**
     * A run of text with marks on it.
     *
     * <p>An empty array is legitimate: contract §5's own example has
     * {@code {"type": "quote", "spans": []}}, and an editor necessarily holds an
     * empty paragraph for the moment between adding one and typing into it.
     */
    private static void validateSpans(JsonNode spans, String path) {
        if (spans == null || !spans.isArray()) {
            throw invalid(path, "Text is held as an array of spans.");
        }
        if (spans.size() > MAX_SPANS_PER_BLOCK) {
            throw invalid(path, "A block holds at most " + MAX_SPANS_PER_BLOCK + " spans of text.");
        }

        for (int index = 0; index < spans.size(); index++) {
            JsonNode span = spans.get(index);
            String spanPath = path + "[" + index + "]";

            if (span == null || !span.isObject()) {
                throw invalid(spanPath, "A span is an object with text and marks.");
            }
            requireOnly(span, spanPath, List.of("text", "marks"));

            JsonNode text = span.get("text");
            if (text == null || !text.isString()) {
                throw invalid(spanPath + ".text", "A span needs its text.");
            }

            JsonNode marks = span.get("marks");
            if (marks == null || !marks.isArray()) {
                // Present and empty rather than omitted, so that every span has
                // the same shape and a renderer never has to ask whether the key
                // is missing or the array is empty.
                throw invalid(spanPath + ".marks", "A span lists its marks, as an empty array when it has none.");
            }
            for (JsonNode mark : marks) {
                if (!mark.isString() || !MARKS.contains(mark.stringValue())) {
                    throw invalid(
                            spanPath + ".marks",
                            "\"" + textOrEmpty(mark) + "\" is not a mark. The marks are strong and em.");
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Shared checks
    // ------------------------------------------------------------------

    /**
     * Refuses a property the schema does not have.
     *
     * <p>See the class comment: the document is stored verbatim and rendered
     * later, so a property accepted and ignored today is a property some future
     * renderer might read.
     */
    private static void requireOnly(JsonNode node, String path, List<String> allowed) {
        for (String name : node.propertyNames()) {
            if (!allowed.contains(name)) {
                throw invalid(
                        path.isEmpty() ? name : path + "." + name,
                        "\"" + name + "\" is not part of this kind of block. It holds "
                                + String.join(", ", allowed) + ".");
            }
        }
    }

    private static String requireNonBlankText(JsonNode node, String path, String message) {
        if (node == null || !node.isString() || node.stringValue().isBlank()) {
            throw invalid(path, message);
        }
        return node.stringValue();
    }

    private static void requirePositiveInt(JsonNode node, String path) {
        if (node == null || !node.isInt() || node.intValue() <= 0) {
            // Both dimensions or neither, and both above zero: the public page
            // reserves the image's box before it loads so the story does not jump
            // as the reader scrolls, and it cannot reserve a box of zero.
            throw invalid(path, "An image says how many pixels wide and high it is, as whole numbers above zero.");
        }
    }

    /**
     * An {@code http} or {@code https} address, and nothing else.
     *
     * <p>The check that matters most in this file. {@code javascript:} in an
     * image's {@code url} is stored, served to every visitor, and executed by
     * whichever renderer interpolates it into an attribute — and the story is
     * untrusted content by definition (§10.4). A scheme allow-list is the check
     * that does not depend on the renderer being careful.
     *
     * <p>Parsed rather than pattern-matched, so that {@code jaVaScRiPt:} and a
     * leading tab are the same refusal.
     */
    private static void requireWebUrl(JsonNode node, String path) {
        String value = requireNonBlankText(node, path, "An address is needed here.");
        String trimmed = value.strip().toLowerCase(Locale.ROOT);
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            throw invalid(path, "An address has to begin with http:// or https://.");
        }
        if (value.length() > 2048) {
            // Longer than any browser will follow, and the usual shape of an
            // inlined data payload wearing a URL's clothes.
            throw invalid(path, "That address is too long to be a link.");
        }
    }

    /**
     * Whether an anchor is a slug.
     *
     * <p>Compared against {@link Slugs#slugify} rather than against a pattern, so
     * that "is this a slug" has exactly one answer in the service. A pattern here
     * that admitted something {@code Slugs} would never produce would let the
     * client and the server disagree about the anchor for the same heading.
     */
    private static boolean isSlug(String value) {
        return !value.isEmpty() && value.equals(Slugs.slugify(value));
    }

    private static int spanCharacters(JsonNode spans) {
        if (spans == null || !spans.isArray()) {
            return 0;
        }
        int total = 0;
        for (JsonNode span : spans) {
            total += codePoints(textOrEmpty(span.get("text")));
        }
        return total;
    }

    /** Whether a section carries an image. Tolerant, as the counts that call it are. */
    private static boolean hasImage(JsonNode block) {
        JsonNode image = block.get("image");
        return image != null && image.isObject();
    }

    private static int codePoints(String value) {
        return value.codePointCount(0, value.length());
    }

    private static String textOrEmpty(JsonNode node) {
        return node == null || !node.isString() ? "" : node.stringValue();
    }

    private static List<String> sorted() {
        return EMBED_PROVIDERS.stream().sorted().toList();
    }

    private static StoryDocumentInvalidException invalid(String path, String message) {
        return new StoryDocumentInvalidException(path, message);
    }
}
