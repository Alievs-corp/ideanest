package az.ideanest.shared.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Refuses a request body larger than {@link RequestBodyLimits} allows — #587.
 *
 * <p>Two ways a body can be too large, and both are handled:
 *
 * <ul>
 *   <li><strong>Declared.</strong> A {@code Content-Length} over the ceiling is answered
 *       413 before a byte of the body is read. That is every browser and every client
 *       this platform ships.
 *   <li><strong>Undeclared.</strong> A chunked body has no length until it ends, so it is
 *       read through a stream that fails once it passes the ceiling. The handler then
 *       sees an unreadable body and answers as it does for any malformed one; what
 *       matters is that the read stops at the ceiling rather than at the end of the heap.
 * </ul>
 *
 * <p><strong>Multipart is left to Spring</strong>, whose {@code spring.servlet.multipart}
 * limits are enforced by the container while it parses the parts — the one upload this
 * service takes (an identity document, §17.3) is sized there.
 *
 * <p>First in the chain after the correlation filter, so that a refused body costs no
 * authentication, no maintenance check and no handler.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RequestBodyLimitFilter extends OncePerRequestFilter {

    /** PM-20's tracking file — see {@link RequestBodyLimits#maxImportBody()}. */
    private static final Pattern IMPORT = Pattern.compile("^/v1/projects/[^/]+/fulfilments/import$");

    private final RequestBodyLimits limits;

    public RequestBodyLimitFilter(RequestBodyLimits limits) {
        this.limits = limits;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        if (isMultipart(request)) {
            chain.doFilter(request, response);
            return;
        }

        long ceiling = ceilingFor(request);
        if (request.getContentLengthLong() > ceiling) {
            refuse(response, ceiling);
            return;
        }
        chain.doFilter(new Bounded(request, ceiling), response);
    }

    private long ceilingFor(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return IMPORT.matcher(path).matches() ? limits.maxImportBody().toBytes() : limits.maxBody().toBytes();
    }

    private static boolean isMultipart(HttpServletRequest request) {
        String contentType = request.getContentType();
        return contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith("multipart/");
    }

    /**
     * 413 with §10.3's problem shape, written here because no handler is reached.
     *
     * <p>{@code Connection: close}: the body is still on the wire, and Tomcat will
     * swallow only {@code server.tomcat.max-swallow-size} of it before giving up on the
     * connection anyway. Saying so lets the client stop sending.
     *
     * <p>Flushed here, not left to the end of the request. Tomcat deals with the unread
     * body before it finishes the response, and a body larger than it will swallow ends
     * the connection there — taking an unflushed answer with it, so the client saw a
     * reset instead of a 413. Flushed, the answer is on the wire first, and a client
     * that sent {@code Expect: 100-continue} never sends the body at all.
     */
    private static void refuse(HttpServletResponse response, long ceiling) throws IOException {
        response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
        response.setHeader(HttpHeaders.CONNECTION, "close");
        response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        byte[] problem = ("{\"type\":\"https://ideanest.az/problems/request-too-large\","
                        + "\"title\":\"Request too large\",\"status\":413,"
                        + "\"detail\":\"This request's body is larger than the %d bytes this endpoint accepts.\"}")
                .formatted(ceiling)
                .getBytes(StandardCharsets.UTF_8);
        // A length rather than chunks, so that the answer is complete the moment it is
        // flushed and does not wait on Tomcat's end of the request to be terminated.
        response.setContentLength(problem.length);
        response.getOutputStream().write(problem);
        response.flushBuffer();
    }

    /** The request, with a body that cannot be read past the ceiling. */
    private static final class Bounded extends HttpServletRequestWrapper {

        private final long ceiling;
        private ServletInputStream stream;

        Bounded(HttpServletRequest request, long ceiling) {
            super(request);
            this.ceiling = ceiling;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (stream == null) {
                stream = new CountingStream(super.getInputStream(), ceiling);
            }
            return stream;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            // The wrapped request's reader would read the raw stream and walk straight
            // past the ceiling, so the reader is built on the bounded one.
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null ? StandardCharsets.ISO_8859_1 : Charset.forName(encoding);
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }
    }

    /** Thrown from a read that would pass the ceiling. */
    static final class BodyTooLargeException extends IOException {

        private static final long serialVersionUID = 1L;

        BodyTooLargeException(long ceiling) {
            super("The request body is larger than " + ceiling + " bytes.");
        }
    }

    private static final class CountingStream extends ServletInputStream {

        private final ServletInputStream delegate;
        private final long ceiling;
        private long read;

        CountingStream(ServletInputStream delegate, long ceiling) {
            this.delegate = delegate;
            this.ceiling = ceiling;
        }

        @Override
        public int read() throws IOException {
            int next = delegate.read();
            if (next != -1) {
                count(1);
            }
            return next;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = delegate.read(buffer, offset, length);
            if (count > 0) {
                count(count);
            }
            return count;
        }

        private void count(int bytes) throws IOException {
            read += bytes;
            if (read > ceiling) {
                throw new BodyTooLargeException(ceiling);
            }
        }

        @Override
        public boolean isFinished() {
            return delegate.isFinished();
        }

        @Override
        public boolean isReady() {
            return delegate.isReady();
        }

        @Override
        public void setReadListener(ReadListener listener) {
            delegate.setReadListener(listener);
        }
    }
}
