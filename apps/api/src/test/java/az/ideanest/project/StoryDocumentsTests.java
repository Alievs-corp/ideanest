package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.project.domain.StoryDocumentInvalidException;
import az.ideanest.project.domain.StoryDocuments;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The story document schema, as a table of rules.
 *
 * <p>Deliberately a plain unit test with no Spring context and no container: the
 * validator is a pure static type for exactly this reason. Every rejection below
 * would otherwise cost an HTTP request that also had to register an account,
 * authenticate, and open a transaction — and the reason a rule fails would be one
 * of five things rather than the rule.
 *
 * <p>The rejections are the point. An accepted document is one shape; a rejected
 * one is every shape a client can get wrong, and the story is the field of a
 * campaign that ends up as markup on a public page.
 */
class StoryDocumentsTests {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode document(String json) {
        try {
            return JSON.readTree(json);
        } catch (JacksonException e) {
            throw new IllegalArgumentException("The test's own fixture is not JSON: " + json, e);
        }
    }

    /** A document holding exactly the block given, so one rule is under test at a time. */
    private static JsonNode withBlock(String blockJson) {
        return document("{\"version\": 1, \"blocks\": [" + blockJson + "]}");
    }

    private static void accepted(String blockJson) {
        assertThatCode(() -> StoryDocuments.validate(withBlock(blockJson))).doesNotThrowAnyException();
    }

    private static StoryDocumentInvalidException refusal(JsonNode document) {
        return (StoryDocumentInvalidException) assertThatThrownBy(() -> StoryDocuments.validate(document))
                .isInstanceOf(StoryDocumentInvalidException.class)
                .actual();
    }

    // ------------------------------------------------------------------
    // Every block the contract defines is accepted
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("the block union of contract §5")
    class AcceptedBlocks {

        @Test
        @DisplayName("every kind of block in the contract's own example is accepted")
        void theContractsExampleIsValid() {
            // Copied from the epic contract §5 verbatim, because that document is
            // what the public project page (#37, #40) will be written against. If
            // this test ever needs editing, the contract has changed and so has
            // somebody else's renderer.
            assertThatCode(() -> StoryDocuments.validate(document(
                            """
                            {"version": 1, "blocks": [
                              {"type": "heading", "level": 2, "id": "how-it-works", "text": "How it works"},
                              {"type": "paragraph", "spans": [{"text": "Plain ", "marks": []}, {"text": "bold", "marks": ["strong"]}]},
                              {"type": "list", "ordered": false, "items": [[{"text": "One", "marks": []}]]},
                              {"type": "quote", "spans": []},
                              {"type": "rule"},
                              {"type": "image", "url": "https://cdn.example.com/a.jpg", "width": 1600, "height": 900, "alt": "A prototype"},
                              {"type": "embed", "provider": "youtube", "url": "https://youtube.com/watch?v=x", "title": "The prototype in use"}
                            ]}
                            """)))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("an empty story is a document with no blocks")
        void anEmptyDocumentIsValid() {
            // The state the editor is in the moment a creator opens the story tab.
            // Refusing it would make the first autosave fail.
            assertThatCode(() -> StoryDocuments.validate(document("{\"version\": 1, \"blocks\": []}")))
                    .doesNotThrowAnyException();
        }

        @Test
        @DisplayName("clearing the story is not a document to validate")
        void aClearedStoryIsAccepted() {
            // An explicit null in a merge patch means "clear this field". Whether
            // that is allowed is the editing service's business; there is no
            // document here to have an opinion about.
            assertThatCode(() -> StoryDocuments.validate(null)).doesNotThrowAnyException();
            assertThatCode(() -> StoryDocuments.validate(document("null"))).doesNotThrowAnyException();
        }

        @Test
        @DisplayName("headings are level 2 and level 3")
        void bothHeadingLevelsAreAccepted() {
            accepted("{\"type\": \"heading\", \"level\": 2, \"id\": \"a\", \"text\": \"A\"}");
            accepted("{\"type\": \"heading\", \"level\": 3, \"id\": \"b\", \"text\": \"B\"}");
        }

        @Test
        @DisplayName("both marks are accepted, together and separately")
        void marksAreAccepted() {
            accepted("{\"type\": \"paragraph\", \"spans\": [{\"text\": \"x\", \"marks\": [\"strong\", \"em\"]}]}");
            accepted("{\"type\": \"quote\", \"spans\": [{\"text\": \"x\", \"marks\": [\"em\"]}]}");
        }

        @Test
        @DisplayName("a list is ordered or not, and its items are runs of spans")
        void listsAreAccepted() {
            accepted("{\"type\": \"list\", \"ordered\": true, \"items\": []}");
            accepted(
                    "{\"type\": \"list\", \"ordered\": false, \"items\": "
                            + "[[{\"text\": \"a\", \"marks\": []}, {\"text\": \"b\", \"marks\": [\"strong\"]}]]}");
        }

        @Test
        @DisplayName("both embed providers on the allow-list are accepted")
        void bothProvidersAreAccepted() {
            accepted("{\"type\": \"embed\", \"provider\": \"youtube\", \"url\": \"https://y.com/a\", \"title\": \"A\"}");
            accepted("{\"type\": \"embed\", \"provider\": \"vimeo\", \"url\": \"https://v.com/a\", \"title\": \"A\"}");
        }

        @Test
        @DisplayName("http as well as https, because not every host has a certificate yet")
        void httpIsAccepted() {
            accepted(
                    "{\"type\": \"image\", \"url\": \"http://cdn.example.com/a.jpg\", "
                            + "\"width\": 10, \"height\": 10, \"alt\": \"A\"}");
        }
    }

    // ------------------------------------------------------------------
    // The envelope
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("the envelope")
    class Envelope {

        @Test
        @DisplayName("a story is a document, not a scalar or an array")
        void aScalarIsRefused() {
            // jsonb would happily store 5. The client reading it back expects the
            // document of contract §5, so the failure belongs at the write.
            assertThat(refusal(document("5")).getMessage()).contains("not a single value");
            assertThat(refusal(document("\"a story\"")).getMessage()).contains("not a single value");
            assertThat(refusal(document("[]")).getMessage()).contains("not a single value");
        }

        @Test
        @DisplayName("a document says which schema version it is written in")
        void theVersionIsRequired() {
            assertThat(refusal(document("{\"blocks\": []}")).path()).isEqualTo("version");
        }

        @Test
        @DisplayName("a future schema version is refused rather than read with today's rules")
        void anUnknownVersionIsRefused() {
            // A client that has been updated past this deployment has to be told
            // so. Reading a version-2 document with version-1 rules would drop its
            // new blocks on the next autosave, silently and permanently.
            StoryDocumentInvalidException refused = refusal(document("{\"version\": 2, \"blocks\": []}"));
            assertThat(refused.path()).isEqualTo("version");
            assertThat(refused.getMessage()).contains("version 1").contains("version 2");
        }

        @Test
        @DisplayName("blocks are a list")
        void blocksMustBeAList() {
            assertThat(refusal(document("{\"version\": 1}")).path()).isEqualTo("blocks");
            assertThat(refusal(document("{\"version\": 1, \"blocks\": {}}")).path()).isEqualTo("blocks");
        }

        @Test
        @DisplayName("a property the schema does not have is refused, not ignored")
        void unknownPropertiesAreRefused() {
            // The document is stored verbatim and rendered later, so a property
            // accepted and ignored today is a place to put something a future
            // renderer might read.
            assertThat(refusal(document("{\"version\": 1, \"blocks\": [], \"html\": \"<script>\"}")).path())
                    .isEqualTo("html");
        }
    }

    // ------------------------------------------------------------------
    // The rejections the issue names
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("a block the renderer would not know what to do with")
    class UnknownBlocks {

        @Test
        @DisplayName("an unknown type is refused, and the message lists the kinds there are")
        void anUnknownTypeIsRefused() {
            StoryDocumentInvalidException refused = refusal(withBlock("{\"type\": \"video\"}"));

            assertThat(refused.path()).isEqualTo("blocks[0].type");
            // The list of kinds is in the message because a client sending an
            // unknown one is a client whose author is looking at this response.
            assertThat(refused.getMessage())
                    .contains("\"video\" is not a kind of story block")
                    .contains("heading")
                    .contains("embed");
        }

        @Test
        @DisplayName("a block with no type at all is refused")
        void aTypelessBlockIsRefused() {
            assertThat(refusal(withBlock("{\"text\": \"orphaned\"}")).path()).isEqualTo("blocks[0].type");
        }

        @Test
        @DisplayName("the path names which block was wrong")
        void thePathNamesTheBlock() {
            // The reason the path exists. A creator with a hundred blocks needs to
            // be taken to the one that is wrong, not told that one of them is.
            JsonNode document = document(
                    """
                    {"version": 1, "blocks": [
                      {"type": "rule"},
                      {"type": "rule"},
                      {"type": "marquee"}
                    ]}
                    """);

            assertThat(refusal(document).path()).isEqualTo("blocks[2].type");
        }
    }

    @Nested
    @DisplayName("an image")
    class Images {

        @Test
        @DisplayName("an image without its alt key is refused")
        void altKeyIsRequired() {
            // Every image has one shape. The key is required; what it holds may be empty.
            StoryDocumentInvalidException refused = refusal(
                    withBlock("{\"type\": \"image\", \"url\": \"https://a.example/b.jpg\", \"width\": 4, \"height\": 3}"));

            assertThat(refused.path()).isEqualTo("blocks[0].alt");
            assertThat(refusal(withBlock(
                                    "{\"type\": \"image\", \"url\": \"https://a.example/b.jpg\", "
                                            + "\"width\": 4, \"height\": 3, \"alt\": 7}"))
                            .path())
                    .isEqualTo("blocks[0].alt");
        }

        @Test
        @DisplayName("an image with an empty or blank description is accepted")
        void emptyAltIsAccepted() {
            // #543: refusing it refused the whole story, and a creator lost every
            // image in it. The page renders such an image as decorative.
            accepted("{\"type\": \"image\", \"url\": \"https://a.example/b.jpg\", "
                    + "\"width\": 4, \"height\": 3, \"alt\": \"\"}");
            accepted("{\"type\": \"image\", \"url\": \"https://a.example/b.jpg\", "
                    + "\"width\": 4, \"height\": 3, \"alt\": \"   \"}");
        }

        @Test
        @DisplayName("an image says how large it is, in whole pixels above zero")
        void dimensionsAreRequired() {
            String base = "{\"type\": \"image\", \"url\": \"https://a.example/b.jpg\", \"alt\": \"A\"";

            assertThat(refusal(withBlock(base + ", \"height\": 3}")).path()).isEqualTo("blocks[0].width");
            assertThat(refusal(withBlock(base + ", \"width\": 4}")).path()).isEqualTo("blocks[0].height");
            // Zero would mean the public page reserves a box of no height for it,
            // and the story jumps as the reader scrolls.
            assertThat(refusal(withBlock(base + ", \"width\": 0, \"height\": 3}")).path())
                    .isEqualTo("blocks[0].width");
            assertThat(refusal(withBlock(base + ", \"width\": 4.5, \"height\": 3}")).path())
                    .isEqualTo("blocks[0].width");
        }

        @Test
        @DisplayName("a javascript: address is refused")
        void onlyWebSchemesAreAccepted() {
            // The check that matters most in the file. The story is untrusted
            // content by definition (§10.4), stored verbatim and interpolated into
            // an attribute by whichever renderer draws it. A scheme allow-list does
            // not depend on that renderer being careful.
            assertThat(refusal(withBlock(
                                    "{\"type\": \"image\", \"url\": \"javascript:alert(1)\", "
                                            + "\"width\": 4, \"height\": 3, \"alt\": \"A\"}"))
                            .path())
                    .isEqualTo("blocks[0].url");

            // Mixed case and leading whitespace are the same refusal, which is why
            // the check parses rather than pattern-matches.
            assertThat(refusal(withBlock(
                                    "{\"type\": \"image\", \"url\": \"  jAvAsCrIpT:alert(1)\", "
                                            + "\"width\": 4, \"height\": 3, \"alt\": \"A\"}"))
                            .path())
                    .isEqualTo("blocks[0].url");

            // And a data URL, which is how a payload arrives wearing an image's
            // clothes.
            assertThat(refusal(withBlock(
                                    "{\"type\": \"image\", \"url\": \"data:image/svg+xml;base64,PHN2Zz4=\", "
                                            + "\"width\": 4, \"height\": 3, \"alt\": \"A\"}"))
                            .path())
                    .isEqualTo("blocks[0].url");
        }
    }

    @Nested
    @DisplayName("an embed")
    class Embeds {

        @Test
        @DisplayName("a provider that is not on the allow-list is refused")
        void theProviderIsAllowListed() {
            // Embedding is handing a third party an iframe on a page that also
            // carries a pledge button. Which parties those are is not a decision an
            // editor should be able to make by pasting a link.
            StoryDocumentInvalidException refused = refusal(withBlock(
                    "{\"type\": \"embed\", \"provider\": \"tiktok\", \"url\": \"https://tiktok.com/a\", \"title\": \"A\"}"));

            assertThat(refused.path()).isEqualTo("blocks[0].provider");
            assertThat(refused.getMessage()).contains("youtube").contains("vimeo").contains("tiktok");
        }

        @Test
        @DisplayName("an embed needs a title, which is the frame's accessible name")
        void theTitleIsRequired() {
            assertThat(refusal(withBlock(
                                    "{\"type\": \"embed\", \"provider\": \"vimeo\", \"url\": \"https://v.com/a\"}"))
                            .path())
                    .isEqualTo("blocks[0].title");
        }

        @Test
        @DisplayName("an embed address is http or https")
        void theUrlIsAWebAddress() {
            assertThat(refusal(withBlock(
                                    "{\"type\": \"embed\", \"provider\": \"vimeo\", "
                                            + "\"url\": \"javascript:alert(1)\", \"title\": \"A\"}"))
                            .path())
                    .isEqualTo("blocks[0].url");
        }
    }

    @Nested
    @DisplayName("heading anchors")
    class HeadingAnchors {

        @Test
        @DisplayName("an anchor that is not a slug is refused")
        void anchorsAreSlugs() {
            // The anchor becomes the fragment of a URL somebody bookmarks, and it
            // is compared against Slugs so that the client and the server cannot
            // disagree about what a heading's anchor is.
            for (String id : new String[] {"How It Works", "how_it_works", "how--it--works", "-how", "how-"}) {
                StoryDocumentInvalidException refused =
                        refusal(withBlock("{\"type\": \"heading\", \"level\": 2, \"id\": \"" + id + "\", \"text\": \"A\"}"));
                assertThat(refused.path()).isEqualTo("blocks[0].id");
                assertThat(refused.getMessage()).contains("anchor");
            }
        }

        @Test
        @DisplayName("a heading with no anchor is refused")
        void theAnchorIsRequired() {
            assertThat(refusal(withBlock("{\"type\": \"heading\", \"level\": 2, \"text\": \"A\"}")).path())
                    .isEqualTo("blocks[0].id");
        }

        @Test
        @DisplayName("two headings cannot share an anchor")
        void anchorsAreUniqueWithinADocument() {
            // The failure that looks like it works: every link in the navigation
            // resolves, and half of them scroll to the wrong heading.
            JsonNode document = document(
                    """
                    {"version": 1, "blocks": [
                      {"type": "heading", "level": 2, "id": "the-plan", "text": "The plan"},
                      {"type": "paragraph", "spans": []},
                      {"type": "heading", "level": 3, "id": "the-plan", "text": "The plan, again"}
                    ]}
                    """);

            StoryDocumentInvalidException refused = refusal(document);
            assertThat(refused.path()).isEqualTo("blocks[2].id");
            assertThat(refused.getMessage()).contains("the-plan").contains("unique");
        }

        @Test
        @DisplayName("level 1 is the campaign's title, not a heading in the story")
        void levelOneIsRefused() {
            assertThat(refusal(withBlock("{\"type\": \"heading\", \"level\": 1, \"id\": \"a\", \"text\": \"A\"}"))
                            .path())
                    .isEqualTo("blocks[0].level");
            assertThat(refusal(withBlock("{\"type\": \"heading\", \"level\": 4, \"id\": \"a\", \"text\": \"A\"}"))
                            .path())
                    .isEqualTo("blocks[0].level");
        }

        @Test
        @DisplayName("a heading needs its text")
        void theTextIsRequired() {
            assertThat(refusal(withBlock("{\"type\": \"heading\", \"level\": 2, \"id\": \"a\", \"text\": \" \"}"))
                            .path())
                    .isEqualTo("blocks[0].text");
        }
    }

    @Nested
    @DisplayName("spans")
    class Spans {

        @Test
        @DisplayName("an unknown mark is refused")
        void marksAreAllowListed() {
            StoryDocumentInvalidException refused = refusal(
                    withBlock("{\"type\": \"paragraph\", \"spans\": [{\"text\": \"x\", \"marks\": [\"blink\"]}]}"));

            assertThat(refused.path()).isEqualTo("blocks[0].spans[0].marks");
            assertThat(refused.getMessage()).contains("strong").contains("em");
        }

        @Test
        @DisplayName("marks are present and empty rather than omitted")
        void marksAreAlwaysPresent() {
            // Every span has the same shape, so a renderer never has to ask whether
            // the key is missing or the array is empty.
            assertThat(refusal(withBlock("{\"type\": \"paragraph\", \"spans\": [{\"text\": \"x\"}]}"))
                            .path())
                    .isEqualTo("blocks[0].spans[0].marks");
        }

        @Test
        @DisplayName("a span needs its text, and text is held as spans")
        void spansAreShaped() {
            assertThat(refusal(withBlock("{\"type\": \"paragraph\", \"spans\": [{\"marks\": []}]}"))
                            .path())
                    .isEqualTo("blocks[0].spans[0].text");
            assertThat(refusal(withBlock("{\"type\": \"paragraph\", \"spans\": \"plain text\"}"))
                            .path())
                    .isEqualTo("blocks[0].spans");
            assertThat(refusal(withBlock("{\"type\": \"quote\"}")).path()).isEqualTo("blocks[0].spans");
        }

        @Test
        @DisplayName("a list item is a run of spans, and the path says which item")
        void listItemsAreRunsOfSpans() {
            assertThat(refusal(withBlock(
                                    "{\"type\": \"list\", \"ordered\": true, \"items\": "
                                            + "[[{\"text\": \"a\", \"marks\": []}], \"b\"]}"))
                            .path())
                    .isEqualTo("blocks[0].items[1]");
        }

        @Test
        @DisplayName("a list says whether it is numbered")
        void listsSayWhetherTheyAreOrdered() {
            assertThat(refusal(withBlock("{\"type\": \"list\", \"items\": []}")).path())
                    .isEqualTo("blocks[0].ordered");
        }
    }

    @Nested
    @DisplayName("a section")
    class Sections {

        private static final String IMAGE =
                "{\"url\": \"https://a.example/b.jpg\", \"width\": 1440, \"height\": 960, \"alt\": \"The bench\"}";

        private static String section(String id, String title, String image) {
            return "{\"type\": \"section\", \"id\": \"" + id + "\", \"title\": \"" + title + "\", \"image\": "
                    + image + ", \"spans\": [{\"text\": \"Where it is made.\", \"marks\": []}]}";
        }

        @Test
        @DisplayName("a section with an image, and one without, are accepted")
        void sectionsAreAccepted() {
            accepted(section("our-workshop", "Our workshop", IMAGE));
            accepted(section("our-workshop", "Our workshop", "null"));
            accepted("{\"type\": \"section\", \"id\": \"a\", \"title\": \"A\", \"image\": null, \"spans\": []}");
        }

        @Test
        @DisplayName("every key is required, the image as null when there is none")
        void everyKeyIsRequired() {
            assertThat(refusal(withBlock(
                                    "{\"type\": \"section\", \"id\": \"a\", \"title\": \"A\", \"spans\": []}"))
                            .path())
                    .isEqualTo("blocks[0].image");
            assertThat(refusal(withBlock(
                                    "{\"type\": \"section\", \"id\": \"a\", \"title\": \"A\", \"image\": null}"))
                            .path())
                    .isEqualTo("blocks[0].spans");
            assertThat(refusal(withBlock(
                                    "{\"type\": \"section\", \"id\": \"a\", \"image\": null, \"spans\": []}"))
                            .path())
                    .isEqualTo("blocks[0].title");
            assertThat(refusal(withBlock(
                                    "{\"type\": \"section\", \"title\": \"A\", \"image\": null, \"spans\": []}"))
                            .path())
                    .isEqualTo("blocks[0].id");
        }

        @Test
        @DisplayName("an unknown key is refused, on the section and on its image")
        void unknownKeysAreRefused() {
            assertThat(refusal(withBlock("{\"type\": \"section\", \"id\": \"a\", \"title\": \"A\", "
                                    + "\"image\": null, \"spans\": [], \"level\": 2}"))
                            .path())
                    .isEqualTo("blocks[0].level");
            assertThat(refusal(withBlock(section(
                                    "a",
                                    "A",
                                    "{\"type\": \"image\", \"url\": \"https://a.example/b.jpg\", \"width\": 4,"
                                            + " \"height\": 3, \"alt\": \"A\"}")))
                            .path())
                    .isEqualTo("blocks[0].image.type");
        }

        @Test
        @DisplayName("the title follows a heading's rules")
        void theTitleIsAHeading() {
            assertThat(refusal(withBlock(section("a", "   ", "null"))).path()).isEqualTo("blocks[0].title");
            assertThat(refusal(withBlock(section("a", "x".repeat(201), "null"))).path())
                    .isEqualTo("blocks[0].title");
            accepted(section("a", "x".repeat(200), "null"));
        }

        @Test
        @DisplayName("the image follows an image block's rules")
        void theImageIsAnImage() {
            assertThat(refusal(withBlock(section(
                                    "a", "A", "{\"url\": \"https://a.example/b.jpg\", \"width\": 4, \"height\": 3}")))
                            .path())
                    .isEqualTo("blocks[0].image.alt");
            accepted(section("a", "A", "{\"url\": \"https://a.example/b.jpg\", \"width\": 4, \"height\": 3, \"alt\": \"\"}"));
            assertThat(refusal(withBlock(section(
                                    "a",
                                    "A",
                                    "{\"url\": \"javascript:alert(1)\", \"width\": 4, \"height\": 3, \"alt\": \"A\"}")))
                            .path())
                    .isEqualTo("blocks[0].image.url");
            assertThat(refusal(withBlock(section(
                                    "a",
                                    "A",
                                    "{\"url\": \"https://a.example/b.jpg\", \"width\": 0, \"height\": 3, \"alt\": \"A\"}")))
                            .path())
                    .isEqualTo("blocks[0].image.width");
            assertThat(refusal(withBlock(section("a", "A", "\"https://a.example/b.jpg\""))).path())
                    .isEqualTo("blocks[0].image");
        }

        @Test
        @DisplayName("a section's id is an anchor, in the same set as the headings'")
        void theIdSharesTheHeadingAnchors() {
            assertThat(refusal(withBlock(section("Our Workshop", "A", "null"))).path())
                    .isEqualTo("blocks[0].id");

            JsonNode document = document("{\"version\": 1, \"blocks\": ["
                    + "{\"type\": \"heading\", \"level\": 2, \"id\": \"our-workshop\", \"text\": \"Workshop\"},"
                    + section("our-workshop", "Our workshop", "null")
                    + "]}");
            StoryDocumentInvalidException refused = refusal(document);
            assertThat(refused.path()).isEqualTo("blocks[1].id");
            assertThat(refused.getMessage()).contains("unique");
        }

        @Test
        @DisplayName("the title and the text are prose; the image's description is not")
        void theTitleAndTextAreCounted() {
            // "Our workshop" is twelve, "Where it is made." seventeen.
            assertThat(StoryDocuments.characterCount(withBlock(section("our-workshop", "Our workshop", IMAGE))))
                    .isEqualTo(29);
        }

        @Test
        @DisplayName("a section with an image counts as one image, and one without as none")
        void anImageCountsAsMedia() {
            assertThat(StoryDocuments.mediaCount(withBlock(section("a", "A", IMAGE)))).isEqualTo(1);
            assertThat(StoryDocuments.mediaCount(withBlock(section("a", "A", "null")))).isZero();
        }

        @Test
        @DisplayName("the refusal of an unknown kind lists the section")
        void theKindsIncludeTheSection() {
            assertThat(refusal(withBlock("{\"type\": \"video\"}")).getMessage()).contains("section");
        }

        private static final String VIDEO = "{\"mediaId\": \"0b6c2f4e-5f63-4c8e-9a51-2f7e4d1b9c10\","
                + " \"url\": \"https://cdn.example/v.mp4\", \"posterUrl\": \"https://cdn.example/v.jpg\","
                + " \"width\": 1280, \"height\": 720, \"durationMs\": 42000}";

        private static String sectionWithVideo(String image, String video) {
            return "{\"type\": \"section\", \"id\": \"a\", \"title\": \"A\", \"image\": " + image
                    + ", \"video\": " + video + ", \"spans\": []}";
        }

        @Test
        @DisplayName("a section may have a video, or say it has none, or not mention one (#551)")
        void aSectionMayHaveAVideo() {
            accepted(sectionWithVideo("null", VIDEO));
            accepted(sectionWithVideo("null", "null"));
            accepted(section("a", "A", "null"));
        }

        @Test
        @DisplayName("a section shows an image or a video, not both")
        void anImageOrAVideo() {
            StoryDocumentInvalidException refused = refusal(withBlock(sectionWithVideo(IMAGE, VIDEO)));
            assertThat(refused.path()).isEqualTo("blocks[0].video");
            assertThat(refused.getMessage()).contains("not both");
        }

        @Test
        @DisplayName("a section's video has exactly the measured shape")
        void theVideoHasItsShape() {
            assertThat(refusal(withBlock(sectionWithVideo("null", "\"https://cdn.example/v.mp4\""))).path())
                    .isEqualTo("blocks[0].video");
            assertThat(refusal(withBlock(sectionWithVideo("null", VIDEO.replace("0b6c2f4e-5f63-4c8e-9a51-2f7e4d1b9c10", "v1"))))
                            .path())
                    .isEqualTo("blocks[0].video.mediaId");
            assertThat(refusal(withBlock(sectionWithVideo("null", VIDEO.replace("https://cdn.example/v.mp4", "javascript:alert(1)"))))
                            .path())
                    .isEqualTo("blocks[0].video.url");
            assertThat(refusal(withBlock(sectionWithVideo("null", VIDEO.replace("42000", "0")))).path())
                    .isEqualTo("blocks[0].video.durationMs");
            assertThat(refusal(withBlock(sectionWithVideo("null", VIDEO.replace("}", ", \"autoplay\": true}"))))
                            .path())
                    .isEqualTo("blocks[0].video.autoplay");
        }

        @Test
        @DisplayName("a section with a video counts as media, and names its upload")
        void aVideoCountsAsMedia() {
            JsonNode story = withBlock(sectionWithVideo("null", VIDEO));
            assertThat(StoryDocuments.mediaCount(story)).isEqualTo(1);
            assertThat(StoryDocuments.sectionVideos(story))
                    .containsExactly(Map.entry(0, UUID.fromString("0b6c2f4e-5f63-4c8e-9a51-2f7e4d1b9c10")));
        }
    }

    @Nested
    @DisplayName("a rule")
    class Rules {

        @Test
        @DisplayName("a rule carries nothing but its type")
        void aRuleIsBare() {
            accepted("{\"type\": \"rule\"}");
            assertThat(refusal(withBlock("{\"type\": \"rule\", \"style\": \"dashed\"}")).path())
                    .isEqualTo("blocks[0].style");
        }
    }

    // ------------------------------------------------------------------
    // The character count §5.3 and #37 depend on
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("the character count")
    class CharacterCount {

        @Test
        @DisplayName("prose is counted: headings, paragraphs, quotes, and list items")
        void proseIsCounted() {
            JsonNode document = document(
                    """
                    {"version": 1, "blocks": [
                      {"type": "heading", "level": 2, "id": "a", "text": "abcd"},
                      {"type": "paragraph", "spans": [{"text": "ef", "marks": []}, {"text": "g", "marks": ["strong"]}]},
                      {"type": "quote", "spans": [{"text": "hi", "marks": []}]},
                      {"type": "list", "ordered": false, "items": [[{"text": "j", "marks": []}], [{"text": "k", "marks": []}]]},
                      {"type": "rule"}
                    ]}
                    """);

            assertThat(StoryDocuments.characterCount(document)).isEqualTo(11);
        }

        @Test
        @DisplayName("an image description and an embed title are not the story")
        void mediaMetadataIsNotCounted() {
            // §5.3 asks for five hundred characters of story. A campaign could
            // otherwise reach it with ten photographs and no writing at all.
            JsonNode document = document(
                    """
                    {"version": 1, "blocks": [
                      {"type": "image", "url": "https://a.example/b.jpg", "width": 4, "height": 3,
                       "alt": "A long and careful description of the prototype in its case"},
                      {"type": "embed", "provider": "youtube", "url": "https://y.com/a",
                       "title": "An equally long title for the demonstration video"}
                    ]}
                    """);

            assertThat(StoryDocuments.characterCount(document)).isZero();
        }

        @Test
        @DisplayName("characters are code points, so an emoji counts once")
        void countingMatchesTheStorage() {
            // `String.length` counts UTF-16 code units and would say 2. Postgres
            // counts code points, and so does the client's counter; a count that
            // disagreed with either would be a number on screen that lies.
            assertThat(StoryDocuments.characterCount(
                            document("{\"version\": 1, \"blocks\": [{\"type\": \"paragraph\", "
                                    + "\"spans\": [{\"text\": \"🙂\", \"marks\": []}]}]}")))
                    .isEqualTo(1);
        }

        @Test
        @DisplayName("a document that cannot be read counts as nothing rather than failing")
        void countingIsTolerant() {
            // Called by the checklist (#37) and the version list, both of which read
            // documents that are already stored. One of them refusing to render
            // because a row written under earlier rules is no longer valid would be
            // a worse failure than a count that is slightly off.
            assertThat(StoryDocuments.characterCount(null)).isZero();
            assertThat(StoryDocuments.characterCount(document("5"))).isZero();
            assertThat(StoryDocuments.characterCount(document("{\"version\": 1}"))).isZero();
        }
    }

    @Nested
    @DisplayName("comparing two documents")
    class Comparison {

        @Test
        @DisplayName("key order is not an edit")
        void comparisonIsSemantic() {
            // The version history is written when the story CHANGED. A client that
            // serialised width before height has not changed the story, and must
            // not gain a row saying it did.
            JsonNode one = withBlock(
                    "{\"type\": \"image\", \"url\": \"https://a.example/b.jpg\", \"width\": 4, \"height\": 3, \"alt\": \"A\"}");
            JsonNode other = withBlock(
                    "{\"type\": \"image\", \"alt\": \"A\", \"height\": 3, \"width\": 4, \"url\": \"https://a.example/b.jpg\"}");

            assertThat(StoryDocuments.isSameDocument(one, other)).isTrue();
        }

        @Test
        @DisplayName("a changed word is an edit")
        void aChangeIsSeen() {
            assertThat(StoryDocuments.isSameDocument(
                            withBlock("{\"type\": \"paragraph\", \"spans\": [{\"text\": \"a\", \"marks\": []}]}"),
                            withBlock("{\"type\": \"paragraph\", \"spans\": [{\"text\": \"b\", \"marks\": []}]}")))
                    .isFalse();
        }

        @Test
        @DisplayName("nothing and a cleared story are the same nothing")
        void absenceComparesEqual() {
            assertThat(StoryDocuments.isSameDocument(null, null)).isTrue();
            assertThat(StoryDocuments.isSameDocument(null, document("null"))).isTrue();
            assertThat(StoryDocuments.isSameDocument(null, withBlock("{\"type\": \"rule\"}")))
                    .isFalse();
        }
    }
}
