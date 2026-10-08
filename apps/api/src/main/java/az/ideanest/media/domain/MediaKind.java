package az.ideanest.media.domain;

import java.util.Locale;

/**
 * What an upload is — issue #331.
 *
 * <p>Decided when the address is issued, from the type the client declared, and then
 * held to: an upload begun as a video is transcoded as one and refused if the bytes are
 * not one. Letting the bytes decide instead would let a cover slot receive an MP4 whose
 * poster happened to decode.
 */
public enum MediaKind {

    IMAGE,

    /** One clip of at most {@code MediaProperties.Video#maxDuration}. */
    VIDEO;

    /** {@code video/*} is a video; everything else is treated as an image upload. */
    public static MediaKind ofDeclaredType(String contentType) {
        return contentType != null && contentType.trim().toLowerCase(Locale.ROOT).startsWith("video/")
                ? VIDEO
                : IMAGE;
    }
}
