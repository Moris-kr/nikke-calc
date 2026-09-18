FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONUTF8=1
WORKDIR /app
COPY nikke_mcp/requirements.txt /app/nikke_mcp/requirements.txt
RUN pip install --no-cache-dir -r nikke_mcp/requirements.txt
# Allow-list copies: never include profiles, cookies, browser data or repository secrets.
COPY calculator /app/calculator
COPY context/*.py /app/context/
COPY data /app/data
COPY scraper/nikke_scraped.json scraper/preview_skills.json /app/scraper/
COPY site/pybridge /app/site/pybridge
COPY nikke_mcp/*.py /app/nikke_mcp/
COPY docs/research/enikk-*-2026-09-18.json /app/docs/research/
COPY docs/research/recommendation-method.md /app/docs/research/
RUN useradd --uid 10001 --create-home calculator
USER calculator
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/health', timeout=2)"
CMD ["python", "-m", "nikke_mcp", "--transport", "streamable-http", "--host", "0.0.0.0", "--public"]
