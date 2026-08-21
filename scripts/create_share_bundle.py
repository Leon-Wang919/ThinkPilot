#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "dist" / "share"

ALWAYS_EXCLUDED_DIR_NAMES = {
    ".git",
    ".idea",
    ".mypy_cache",
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "ENV",
    "build",
    "dist",
    "env",
    "htmlcov",
    "node_modules",
    "playwright-report",
    "release",
    "test-results",
    "venv",
}

ALWAYS_EXCLUDED_FILE_NAMES = {
    ".DS_Store",
    ".env",
    ".python-version",
    "ThinkPilot.env",
}

ALWAYS_EXCLUDED_SUFFIXES = {
    ".log",
    ".pyc",
    ".pyo",
    ".tsbuildinfo",
}


def add_arguments(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument(
        "--name",
        help="Bundle folder/archive name. Defaults to ThinkPilot-share-YYYYMMDD-HHMMSS.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Directory that will receive the clean copy and archive. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--no-zip",
        action="store_true",
        help="Create only the clean directory copy and skip the zip archive.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite an existing bundle directory/archive with the same name.",
    )
    parser.add_argument(
        "--include-env",
        action="store_true",
        help="Include the root .env file in the bundle.",
    )
    parser.add_argument(
        "--include-knowledge-bases",
        action="store_true",
        help="Include data/knowledge_bases in the bundle.",
    )
    parser.add_argument(
        "--include-database",
        action="store_true",
        help="Include local SQLite database files in the bundle.",
    )
    parser.add_argument(
        "--include-uploads",
        action="store_true",
        help="Include data/uploads in the bundle.",
    )
    parser.add_argument(
        "--include-user-data",
        action="store_true",
        help="Include data/user runtime data in the bundle.",
    )
    return parser


def _default_bundle_name() -> str:
    return f"ThinkPilot-share-{datetime.now().strftime('%Y%m%d-%H%M%S')}"


def _is_relative_to(path: Path, other: Path) -> bool:
    try:
        path.relative_to(other)
        return True
    except ValueError:
        return False


def _should_skip(path: Path, args: argparse.Namespace) -> bool:
    rel_path = path.relative_to(PROJECT_ROOT)
    name = path.name

    if not rel_path.parts:
        return False

    if rel_path.parts[0] == "dist":
        return True

    if path.is_dir() and name in ALWAYS_EXCLUDED_DIR_NAMES:
        return True

    if path.is_file() and name in ALWAYS_EXCLUDED_FILE_NAMES:
        if rel_path == Path(".env") and args.include_env:
            return False
        return True

    if path.is_file() and name.startswith(".env.") and name not in {".env.example", ".env.example_CN"}:
        return True

    if path.is_file() and any(name.endswith(suffix) for suffix in ALWAYS_EXCLUDED_SUFFIXES):
        return True

    if rel_path == Path("web/.env.local"):
        return True

    if _is_relative_to(rel_path, Path("data/user")) and not args.include_user_data:
        return True

    if _is_relative_to(rel_path, Path("data/knowledge_bases")) and not args.include_knowledge_bases:
        return True

    if _is_relative_to(rel_path, Path("data/uploads")) and not args.include_uploads:
        return True

    if path.is_file():
        if (
            rel_path.parent == Path("data")
            and (
                name.endswith(".db")
                or name.endswith(".db-shm")
                or name.endswith(".db-wal")
                or name.endswith(".sqlite")
                or name.endswith(".sqlite3")
            )
            and not args.include_database
        ):
            return True

    return False


def _copy_tree(src_root: Path, dst_root: Path, args: argparse.Namespace) -> tuple[int, int]:
    copied_files = 0
    copied_dirs = 0

    for root, dirs, files in os.walk(src_root, topdown=True):
        root_path = Path(root)
        rel_root = root_path.relative_to(src_root)

        kept_dirs: list[str] = []
        for dir_name in sorted(dirs):
            dir_path = root_path / dir_name
            if _should_skip(dir_path, args):
                continue
            kept_dirs.append(dir_name)
            target_dir = dst_root / rel_root / dir_name
            target_dir.mkdir(parents=True, exist_ok=True)
            copied_dirs += 1
        dirs[:] = kept_dirs

        for file_name in sorted(files):
            file_path = root_path / file_name
            if _should_skip(file_path, args):
                continue

            rel_path = file_path.relative_to(src_root)
            target = dst_root / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file_path, target)
            copied_files += 1

    return copied_dirs, copied_files


def _write_manifest(bundle_dir: Path, args: argparse.Namespace) -> None:
    first_run_step = (
        "1. Review the included .env and replace any values you do not want to share"
        if args.include_env
        else "1. Copy .env.example to .env"
    )
    second_run_step = (
        "2. Update API keys or other environment values if needed"
        if args.include_env
        else "2. Fill in their own API keys"
    )
    lines = [
        "ThinkPilot share bundle",
        "",
        f"Generated at: {datetime.now().isoformat(timespec='seconds')}",
        f"Project root: {PROJECT_ROOT}",
        "",
        "Defaults excluded from this bundle:",
        "- .env, ThinkPilot.env, web/.env.local",
        "- web/node_modules, web/.next, build/dist caches",
        "- data/user, data/knowledge_bases, data/uploads",
        "- data/*.db, data/*.db-shm, data/*.db-wal, data/*.sqlite*",
        "",
        "Optional runtime content included:",
        f"- root .env: {'yes' if args.include_env else 'no'}",
        f"- knowledge bases: {'yes' if args.include_knowledge_bases else 'no'}",
        f"- database: {'yes' if args.include_database else 'no'}",
        f"- uploads: {'yes' if args.include_uploads else 'no'}",
        f"- user data: {'yes' if args.include_user_data else 'no'}",
        "",
        "Before first run, your friend should:",
        first_run_step,
        second_run_step,
        "3. Install Python and Node dependencies",
        "4. Run: python scripts/dev.py fullstack",
    ]
    (bundle_dir / "SHARE_BUNDLE_INFO.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_from_namespace(args: argparse.Namespace) -> int:
    output_dir = Path(args.output_dir).expanduser().resolve()
    bundle_name = args.name or _default_bundle_name()
    bundle_dir = output_dir / bundle_name
    zip_path = output_dir / f"{bundle_name}.zip"

    output_dir.mkdir(parents=True, exist_ok=True)

    if bundle_dir.exists():
        if not args.overwrite:
            print(f"Bundle directory already exists: {bundle_dir}")
            print("Pass --overwrite or choose a different --name.")
            return 1
        shutil.rmtree(bundle_dir)

    if zip_path.exists():
        if not args.overwrite:
            print(f"Bundle archive already exists: {zip_path}")
            print("Pass --overwrite or choose a different --name.")
            return 1
        zip_path.unlink()

    bundle_dir.mkdir(parents=True, exist_ok=True)
    copied_dirs, copied_files = _copy_tree(PROJECT_ROOT, bundle_dir, args)
    _write_manifest(bundle_dir, args)

    archive_path: str | None = None
    if not args.no_zip:
        archive_path = shutil.make_archive(str(output_dir / bundle_name), "zip", output_dir, bundle_name)

    print(f"Created clean share directory: {bundle_dir}")
    if archive_path:
        print(f"Created zip archive: {archive_path}")
    print(f"Copied {copied_files} files across {copied_dirs} directories.")
    print("Bundle excludes local secrets and runtime artifacts by default.")
    if args.include_env:
        print("The root .env file was included in this bundle.")
    else:
        print("Your friend should copy .env.example to .env and fill in their own keys.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a clean ThinkPilot bundle for sharing without local secrets or caches."
    )
    return add_arguments(parser)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return run_from_namespace(args)


if __name__ == "__main__":
    raise SystemExit(main())
