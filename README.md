# qloudsound-api

Cloudflare Worker backend that powers `api.qloudsound.com`.

## Prerequisites

- Node.js 18+ and npm
- A Cloudflare account with access to the `qloudsound.com` zone
- `wrangler` CLI (already configured via dev dependency)

## Useful scripts

```bash
# Start a local dev server (proxying to Cloudflare)
npm run dev

# Type-check the worker
npm run lint

# Deploy to Cloudflare
npm run deploy
```

## Environment

Runtime env vars live in `wrangler.toml`.

- `API_ALLOWED_ORIGINS` – comma separated list allowed for CORS (defaults to `*`)
- `REQUESTS_DB` – D1 binding where we store form submissions  
  ```toml
  [[d1_databases]]
  binding = "REQUESTS_DB"
  database_name = "qloudsound_requests"
  database_id = "62930b15-a8a9-4863-bb42-374c5d7a6d8d"
  ```
- `TELEGRAM_TOKEN` / `TELEGRAM_CHAT` should be added via `wrangler secret put …` before deploying

## Endpoints

- `GET /` – Service metadata
- `GET /health` – Liveness probe for the worker
- `GET /public-site` – Metadata for the public-site surface
- `GET /public-site/health` – Liveness probe for this scope
- `POST /public-site/requests` – Handles the public form submissions, persists them in D1 and notifies Telegram

All responses are JSON and include CORS headers (configurable per origin). Use `/public-site/requests` from the landing page form with a request like:

```bash
curl -X POST https://api.qloudsound.com/public-site/requests \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "style": "Synthwave",
    "description": "Track for our launch video",
    "website": ""
  }'
```

The optional `website` property is the honeypot field that should stay empty on real submissions.
