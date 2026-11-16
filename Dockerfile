FROM nginxinc/nginx-unprivileged:stable-alpine

# Browser-only game: assets are served directly; no Node.js runtime required.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/health | grep -qx OK || exit 1
