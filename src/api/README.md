# API Module

The API layer is built with FastAPI and exposes REST/WebSocket interfaces for ThinkPilot.

## Responsibilities

- Route registration and request handling
- WebSocket streaming for long-running workflows
- Static artifact serving from `data/user`
- Startup checks (config consistency and service initialization)

## Entry Points

- `main.py`: FastAPI application instance, middleware, and router mounting
- `run_server.py`: development startup wrapper around Uvicorn
- `routers/`: feature-specific endpoint modules

## Main Endpoints

- `/api/v1/chat`
- `/api/v1/knowledge`
- `/api/v1/dashboard`
- `/api/v1/notebook`
- `/api/v1/guide`
- `/api/v1/feynman`
- `/api/v1/question`
- `/api/v1/solve`
- `/api/v1/settings`
- `/api/v1/system`
- `/api/v1/config`
- `/api/v1/agent-config`

## Dev Notes

- API docs are available at `/docs` when backend is running.
- Static output files are exposed at `/api/outputs`.
