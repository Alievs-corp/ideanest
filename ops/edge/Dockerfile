# The edge maintenance responder -- issue #214, section 2. See nginx.conf for what
# it answers and ops/deploy/README.md ("Maintenance") for how it is deployed.
#
# Build context is ops/edge:
#   docker build -t ideanest-edge ops/edge
#
# The stable nginx line, pinned to its minor so a rebuild does not silently move
# to the mainline branch. The files are baked in rather than mounted, so the
# container Coolify runs is exactly the one CI tested.
FROM nginx:1.30-alpine

# The image's stock server block (port 80) and its entrypoint scripts, which
# rewrite files under /etc/nginx at start-up, are removed: this container runs a
# fixed configuration as a non-root user and has nothing to template.
RUN rm -f /etc/nginx/conf.d/default.conf \
 && rm -rf /docker-entrypoint.d/*

COPY nginx.conf /etc/nginx/nginx.conf
COPY edge-headers.conf /etc/nginx/edge-headers.conf
COPY html/ /usr/share/nginx/edge/

USER nginx

# Fails the build, not the deploy, on a configuration nginx will not load. Run as
# the user that serves, so that anything it creates under /tmp is that user's.
RUN nginx -t

EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8079/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
