# Web Frontend

ThinkPilot frontend is a Next.js App Router application.

## Responsibilities

- Render the study/chat interfaces
- Integrate with the FastAPI backend over HTTP and WebSocket
- Run frontend-only checks such as `eslint`, i18n audits, and Playwright UI audits

## Standard Commands

From the repo root:

```bash
python scripts/dev.py frontend
python scripts/dev.py lint
python scripts/dev.py verify
```

From `web/` directly:

```bash
npm run dev
npm run build
npm run lint
npm run i18n:check
npm run audit
```

## Runtime Notes

- `NEXT_PUBLIC_API_BASE` is the single frontend API base variable.
- `scripts/start_web.py` and `scripts/dev.py frontend` set it automatically for local development.
- If `NEXT_PUBLIC_API_BASE` is missing, the frontend falls back to `http://127.0.0.1:8001` for local verification.
- For remote deployment, set `NEXT_PUBLIC_API_BASE_EXTERNAL` or `NEXT_PUBLIC_API_BASE` in the repo root `.env`.
