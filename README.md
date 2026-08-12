# Edu Backend

Node.js + Express + TypeORM + PostgreSQL API. Deployed independently from the frontend.

## Stack

- Node.js 24.19.0 LTS
- Express 5.2.1
- TypeORM
- PostgreSQL 18.4
- TypeScript
- Pino (logger)

## Docker

```bash
cp .env.example .env
docker compose up --build
```

- API: http://localhost:3000/api/health
- Postgres: localhost:5432 (`edu` / `edu` / `edu`)

## Local development

```bash
docker compose up db -d
cp .env.example .env
npm install
npm run dev
```

Requires Node.js **24.19.0**.

## Endpoints

- `GET /api/health`
- `GET /api/users`
- `POST /api/users` — body `{ "name", "email" }`

## Notes

- Set `CORS_ORIGIN` to your frontend origin(s), comma-separated.
- App logging uses Pino (`LOG_LEVEL`). TypeORM SQL logging is always off.
- `DB_SYNC=true` bootstraps schema; use migrations before real production.
