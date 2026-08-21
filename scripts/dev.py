#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _load_runtime_helpers():
    from src.services.setup.runtime import get_runtime_settings, load_runtime_env

    return get_runtime_settings, load_runtime_env


PYTHON_LINT_TARGETS = [
    "src/api/main.py",
    "src/api/utils/health.py",
    "src/api/routers/agent_config.py",
    "src/api/routers/chat.py",
    "src/api/routers/config.py",
    "src/api/routers/dashboard.py",
    "src/api/routers/knowledge.py",
    "src/api/routers/notebook.py",
    "src/api/routers/settings.py",
    "src/api/routers/solve.py",
    "src/api/routers/system.py",
    "src/services/__init__.py",
    "src/services/setup",
    "scripts/dev.py",
    "scripts/healthcheck_startup.py",
    "scripts/start_web.py",
    "tests",
]


def _run(cmd: list[str], cwd: Path | None = None, extra_env: dict[str, str] | None = None) -> int:
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    process = subprocess.run(cmd, cwd=cwd or PROJECT_ROOT, env=env, check=False)
    return process.returncode


def _npm_cmd() -> str:
    return shutil.which("npm") or "npm"


def cmd_healthcheck(_: argparse.Namespace) -> int:
    return _run([sys.executable, "scripts/healthcheck_startup.py"])


def cmd_backend(_: argparse.Namespace) -> int:
    return _run([sys.executable, "src/api/run_server.py"])


def cmd_frontend(_: argparse.Namespace) -> int:
    get_runtime_settings, _ = _load_runtime_helpers()
    settings = get_runtime_settings(PROJECT_ROOT)
    env = {
        "PORT": str(settings.frontend_port),
        "NEXT_PUBLIC_API_BASE": settings.resolved_api_base,
    }
    return _run(
        [_npm_cmd(), "run", "dev", "--", "-p", str(settings.frontend_port)],
        cwd=PROJECT_ROOT / "web",
        extra_env=env,
    )


def cmd_fullstack(_: argparse.Namespace) -> int:
    return _run([sys.executable, "scripts/start_web.py"])


def cmd_frontend_build(_: argparse.Namespace) -> int:
    return _run([_npm_cmd(), "run", "build"], cwd=PROJECT_ROOT / "web")


def cmd_lint(_: argparse.Namespace) -> int:
    steps = [
        ([sys.executable, "-m", "ruff", "check", *PYTHON_LINT_TARGETS], PROJECT_ROOT),
        ([sys.executable, "-m", "black", "--check", *PYTHON_LINT_TARGETS], PROJECT_ROOT),
        ([_npm_cmd(), "run", "lint"], PROJECT_ROOT / "web"),
        ([_npm_cmd(), "run", "i18n:check"], PROJECT_ROOT / "web"),
    ]
    for command, cwd in steps:
        rc = _run(command, cwd=cwd)
        if rc != 0:
            return rc
    return 0


def cmd_test(_: argparse.Namespace) -> int:
    return _run([sys.executable, "-m", "pytest", "-q"])


def cmd_verify(_: argparse.Namespace) -> int:
    for handler in (cmd_healthcheck, cmd_lint, cmd_frontend_build, cmd_test):
        rc = handler(argparse.Namespace())
        if rc != 0:
            return rc
    return 0


def cmd_share(args: argparse.Namespace) -> int:
    from scripts.create_share_bundle import run_from_namespace

    return run_from_namespace(args)


def build_parser() -> argparse.ArgumentParser:
    from scripts.create_share_bundle import add_arguments as add_share_arguments

    parser = argparse.ArgumentParser(description="ThinkPilot developer entrypoint")
    subparsers = parser.add_subparsers(dest="command", required=True)

    commands = {
        "healthcheck": cmd_healthcheck,
        "backend": cmd_backend,
        "frontend": cmd_frontend,
        "fullstack": cmd_fullstack,
        "lint": cmd_lint,
        "share": cmd_share,
        "test": cmd_test,
        "verify": cmd_verify,
    }
    for name, handler in commands.items():
        sub = subparsers.add_parser(name)
        if name == "share":
            add_share_arguments(sub)
        sub.set_defaults(handler=handler)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command != "share":
        _, load_runtime_env = _load_runtime_helpers()
        load_runtime_env(PROJECT_ROOT)
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
