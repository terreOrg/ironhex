FROM node:24-alpine AS web-build
WORKDIR /src

# The existing dist/ still contains third-party JS and animated GLB assets.
COPY dist/ dist/
COPY apps/web/src/ apps/web/src/
COPY data/megamek/scenarios/ data/megamek/scenarios/
COPY apps/api/src/mtf.mjs apps/api/src/mtf.mjs
COPY packages/engine/ packages/engine/
COPY packages/ui/mech-toggle/mech-toggle.js packages/ui/mech-toggle/mech-toggle.js
COPY scripts/build-web.mjs scripts/build-web.mjs
RUN node scripts/build-web.mjs

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /src/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/health | grep -qx OK || exit 1
