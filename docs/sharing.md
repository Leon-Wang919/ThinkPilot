# Sharing ThinkPilot Without Git Hosting

Use a clean bundle instead of sending your working directory directly. This avoids leaking local API keys, runtime data, frontend caches, and database files.

## Create the bundle

From the project root:

```bash
python scripts/dev.py share
```

This creates:

- `dist/share/<bundle-name>/`
- `dist/share/<bundle-name>.zip`

Default bundle name format:

```text
ThinkPilot-share-YYYYMMDD-HHMMSS
```

## What is excluded by default

- `.env`, `ThinkPilot.env`, `web/.env.local`
- `web/node_modules`, `web/.next`, Playwright reports, and caches
- `data/user/`
- `data/uploads/`
- `data/knowledge_bases/`
- local SQLite files such as `data/thinkpilot.db`, `data/thinkpilot.db-shm`, and `data/thinkpilot.db-wal`

## Useful options

```bash
python scripts/dev.py share --name ThinkPilot-for-classmate
python scripts/dev.py share --no-zip
python scripts/dev.py share --overwrite
python scripts/dev.py share --include-env
python scripts/dev.py share --include-knowledge-bases
python scripts/dev.py share --include-database
python scripts/dev.py share --include-uploads
python scripts/dev.py share --include-user-data
```

Only include runtime data when you intentionally want to share it.
`--include-env` will copy your current root `.env`, which may contain working API keys.

## What to send to your friend

Send either:

- the generated `.zip` file
- the generated clean directory

Do not send your original working directory.

## What your friend should do

After unpacking the bundle:

```bash
pip install -r requirements/base.txt -r requirements/dev.txt
cd web && npm install
cd ..
cp .env.example .env
python scripts/dev.py fullstack
```

Then they should edit `.env` and fill in their own API keys before using AI features.
