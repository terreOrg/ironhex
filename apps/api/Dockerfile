FROM node:24-alpine
WORKDIR /app

COPY apps/api/package.json /app/apps/api/package.json
RUN cd /app/apps/api && npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY packages/engine/ /app/packages/engine/
COPY apps/api/src/ /app/apps/api/src/
COPY tests/auth-integration.mjs /app/tests/auth-integration.mjs
COPY tests/auth-email-integration.mjs /app/tests/auth-email-integration.mjs
COPY tests/operations-integration.mjs /app/tests/operations-integration.mjs

WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","src/index.mjs"]
