# Actualimporter

Web-based, Dockerized importer for Rabobank CSV exports into Actual Budget via the Actual API.

Reference API docs: https://actualbudget.org/docs/api/reference

## What is implemented (MVP)

- CSV upload + preview in browser
- Column assignment per target field (`date`, `amount`, `payee`, `notes`)
- Column merge rules (many CSV columns into one target field)
- Grouping and mapping to multiple Actual accounts
- Account discovery endpoint integration (`/api/actual/accounts`)
- Dry-run validation before import
- Import endpoint orchestration (`/api/import`)

## Project structure

- `frontend/` - React + Vite UI
- `backend/` - Express API (CSV parsing, mapping, account lookup, import orchestration)
- `Dockerfile` - single container serving backend + built frontend

## Local development

### 1) Install dependencies

```bash
npm install
```

### 2) Start backend (API)

```bash
npm run dev -w backend
```

Backend runs on `http://localhost:3000`.

### 3) Start frontend (UI) in a second terminal

```bash
npm run dev -w frontend
```

Frontend runs on `http://localhost:5173` and proxies `/api` to backend.

## Build

```bash
npm run build
```

This builds:

- `backend/dist/server.js`
- `frontend/dist/*`

## Run production locally

```bash
npm run start -w backend
```

When `frontend/dist` exists, the backend serves the web UI directly.

## Docker

### Build image

```bash
docker build -t actualimporter:latest .
```

### Run container

```bash
docker run --rm -p 3000:3000 \
  -e APP_PORT=3000 \
  -e ACTUAL_SERVER_URL="https://actual.example.com" \
  -e ACTUAL_PASSWORD="***" \
  -e ACTUAL_BUDGET_ID="***" \
  actualimporter:latest
```

Or with Compose:

```bash
cp .env.example .env
docker compose build
docker compose up -d
```

## Environment variables

- `APP_PORT` - backend/web port (default `3000`)
- `ACTUAL_SERVER_URL` - URL of your Actual server
- `ACTUAL_PASSWORD` - Actual password/secret
- `ACTUAL_BUDGET_ID` - budget identifier
- `MOCK_ACTUAL` - set `true` to test UI flow without real Actual API calls

## Safety

Use this tool carefully with financial data. Validate mappings and run dry-runs before real imports.
