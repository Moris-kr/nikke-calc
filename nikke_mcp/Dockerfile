FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY nikke_mcp/package.json nikke_mcp/package-lock.json /app/nikke_mcp/
RUN cd nikke_mcp && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
# Allow-list copies: never include profiles, cookies, browser data or repository secrets.
# The engine is the site's TypeScript engine (tests and the browser worker are excluded by the .dockerignore).
COPY site/src/engine/*.ts /app/site/src/engine/
COPY data /app/data
COPY scraper/nikke_scraped.json scraper/preview_skills.json /app/scraper/
COPY nikke_mcp/launch.mjs nikke_mcp/worker.mjs nikke_mcp/smoke.mjs /app/nikke_mcp/
COPY nikke_mcp/src/*.ts nikke_mcp/src/python-floats.json /app/nikke_mcp/src/
COPY docs/research/enikk-*-2026-09-18.json /app/docs/research/
COPY docs/research/recommendation-method.md /app/docs/research/
# The engine sources are ES modules (site/package.json has "type": "module").
RUN printf '{"type":"module"}\n' > /app/site/package.json \
 && useradd --uid 10001 --create-home calculator
USER calculator
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '8000') + '/health', { signal: AbortSignal.timeout(2000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "nikke_mcp/launch.mjs", "--transport", "streamable-http", "--host", "0.0.0.0", "--public"]
