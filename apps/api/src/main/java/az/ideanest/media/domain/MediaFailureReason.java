package az.ideanest.media.domain;

/**
 * Why an upload will not become an image — the media pipeline design of 2026-08-30.
 *
 * <h2>A code, never a message</h2>
 *
 * <p>The column holds one of these names and nothing else. A message in a column is a
 * message that cannot be translated, and this one is shown to a creator in the campaign
 * editor in their own language — so the words live in the message catalogue with every
 * other string a creator reads, and the database holds the fact.
 *
 * <p>Each of these is also a failure the creator can do something about, which is the test
 * for whether a distinction is worth making. "The storage bucket rejected the request" is
 * not here: it is not their fault, it is transient, and the row stays claimed so the next
 * pass tries again.
 */
public enum MediaFailureReason {

    /**
     * The bytes are not an image this pipeline reads.
     *
     * <p>Decided from the content, never from the extension or the type the client
     * declared — the same rule §17.3 puts on identity documents, and
     * {@code DocumentBytes} argues why the client's word is the wrong thing to trust even
     * when the client is honest.
     */
    UNSUPPORTED_FORMAT,

    /**
     * Larger than the ceiling.
     *
     * <p>Reachable even though the ceiling is checked before an address is issued: the
     * client declares the size it is about to upload, and a presigned address does not
     * make that declaration binding.
     */
    TOO_LARGE,

    /** Nothing arrived at the address, or what arrived was empty. */
    EMPTY,

    /**
     * Smaller than anything that can be displayed.
     *
     * <p>The floor is not a quality rule — the cover minimum stopped being one, which is
     * the change this pipeline was built for. It is what stops somebody who picked their
     * avatar by mistake from putting a 128-pixel square behind a hero.
     */
    TOO_SMALL,

    /**
     * The image decoded and something about it defeated the encoder.
     *
     * <p>A dimension beyond what the decoder will allocate, a truncated file whose header
     * was intact, a colour profile the encoder refuses. Rare, and grouped rather than
     * enumerated because the creator's next move is the same for all of them: send a
     * different file.
     */
    UNREADABLE,

    /**
     * A video longer than the ceiling — issue #331.
     *
     * <p>Measured from the file by ffprobe. The editor checks the duration before it uploads,
     * and this is what holds for a client that did not.
     */
    TOO_LONG
}
