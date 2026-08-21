# Data Directory

`data/` stores runtime content for ThinkPilot. Most of it is generated locally and should not be treated as source-controlled project code.

## Layout

```text
data/
├── knowledge_bases/      # Knowledge base assets
└── user/                 # Local user/session/runtime data
    ├── solve/
    ├── question/
    ├── research/
    ├── guide/
    ├── notebook/
    ├── co-writer/
    ├── logs/
    └── run_code_workspace/
```

## Source Control Policy

- `data/user/` is runtime state and is ignored by `.gitignore`.
- `data/knowledge_bases/` can become large quickly and should only be versioned intentionally.
- If your current workspace already contains files here, treat them as local artifacts rather than part of the repo baseline.

## Configuration

Paths are defined in [config/main.yaml](../config/main.yaml) under the paths and tools.run_code.workspace sections.

## Maintenance

Examples:

```bash
find data/user/run_code_workspace -type f -mtime +7 -delete
tar -czf knowledge_bases_backup_$(date +%Y%m%d).tar.gz data/knowledge_bases/
```
