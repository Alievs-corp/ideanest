# The IdeyaNest API, as an image — docs/architecture.md §19, issue #139.
#
# Two stages. The build stage carries a JDK, Gradle's caches and the whole source
# tree; the runtime stage carries a JRE and one jar. Shipping the build stage
# would put a compiler, the test sources and every dependency's source jar into
# production — a larger attack surface and a slower pull, for nothing.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
# Pinned to a digest-less tag on purpose: the wrapper verifies its own Gradle
# distribution's checksum, and the JDK here only has to be 21 or newer. A digest
# would have to be bumped by hand for every base-image security release, which is
# the change nobody makes.
FROM eclipse-temurin:21-jdk AS build

WORKDIR /build

# The wrapper and the build files first, and the sources after. Docker caches by
# layer, so a change to a Java file must not invalidate the dependency download —
# which is most of the build's wall-clock time.
COPY gradle gradle
COPY gradlew gradlew.bat settings.gradle.kts build.gradle.kts gradle.properties ./
RUN chmod +x gradlew && ./gradlew --no-daemon dependencies --quiet || true

COPY src src

# `-x test`, and the reason is not speed. The tests need Docker — Testcontainers
# starts a real PostgreSQL — and a build that runs them inside a container needs
# a socket mounted into it. CI has already run them against the same commit; a
# second run here would be the same assertions with a worse failure mode.
RUN ./gradlew --no-daemon clean bootJar -x test

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM eclipse-temurin:21-jre AS runtime

# §13.1's ingestion needs an image processor, and this is it -- the media pipeline
# design of 2026-08-30.
#
# WHY A NATIVE DEPENDENCY RATHER THAN THE JDK'S OWN ImageIO, which would have cost
# nothing at all. Two facts, and both are about failing rather than about quality.
#
#  - ImageIO cannot read HEIC, which is the default camera format on an iPhone. iOS
#    Safari usually transcodes to JPEG on a file input, and "usually" is not a
#    guarantee to build a first-run experience on -- least of all in a change whose
#    whole purpose is that creators stop getting stuck.
#  - ImageIO decodes to a full bitmap in heap. An 8000x6000 photograph is 192MB as a
#    BufferedImage; this container sizes its heap with MaxRAMPercentage, so two or
#    three concurrent uploads is an OutOfMemoryError rather than a slowdown. libvips
#    streams and never materialises the whole image.
#
# `--no-install-recommends` and the list cleanup keep it to roughly 40MB. The tools
# package is what provides `vips` and `vipsheader`; the library alone provides
# neither, and VipsImageTranscoder shells out rather than binding through JNI so
# that a missing binary is a start-up log line instead of a linker error.
#
# ffmpeg is the campaign video's transcoder -- issue #331. One rendition, H.264 and
# AAC at 720p, which is what the distribution's build encodes with libx264 and its
# native AAC encoder; `ffprobe` comes in the same package. Shelled out to for the
# reason libvips is: a missing binary is a start-up log line, not a linker error.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libvips-tools ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# A user of its own. The base image runs as root, and a process that never needs
# to write outside /tmp has no reason to be able to.
RUN groupadd --system ideanest && useradd --system --gid ideanest --home /app ideanest

WORKDIR /app
COPY --from=build --chown=ideanest:ideanest /build/build/libs/*.jar app.jar

USER ideanest

EXPOSE 8080

# `MaxRAMPercentage` and not `-Xmx`. A container's memory limit is set by the
# orchestrator and changes per environment; a fixed heap is either wasteful in
# the large one or the reason the small one is killed. Seventy-five per cent
# leaves room for metaspace, thread stacks and the direct buffers Netty and the
# JDBC driver take outside the heap.
#
# `ExitOnOutOfMemoryError`, because a JVM that has run out of heap is a process
# the orchestrator should replace rather than one that limps: it will not recover,
# and it will fail health checks in ways that read as a database problem.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"

# The orchestrator's readiness probe is the real one — it can remove an instance
# from the load balancer, which this cannot. This exists for `docker run` and for
# a compose stack, where nothing else is watching.
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health/readiness || exit 1

# `exec` form through a shell, so JAVA_OPTS is expanded and the JVM is still
# PID 1 — which is what makes SIGTERM reach it and the graceful shutdown in
# `application.yml` actually run.
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
