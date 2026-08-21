import argparse
import importlib.util
from pathlib import Path

DEV_SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "dev.py"

spec = importlib.util.spec_from_file_location("thinkpilot_dev_script", DEV_SCRIPT_PATH)
dev = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(dev)


def test_verify_runs_frontend_build_between_lint_and_pytest(monkeypatch):
    calls: list[str] = []

    monkeypatch.setattr(
        dev,
        "cmd_healthcheck",
        lambda _: calls.append("healthcheck") or 0,
    )
    monkeypatch.setattr(dev, "cmd_lint", lambda _: calls.append("lint") or 0)
    monkeypatch.setattr(
        dev,
        "cmd_frontend_build",
        lambda _: calls.append("frontend_build") or 0,
    )
    monkeypatch.setattr(dev, "cmd_test", lambda _: calls.append("test") or 0)

    rc = dev.cmd_verify(argparse.Namespace())

    assert rc == 0
    assert calls == ["healthcheck", "lint", "frontend_build", "test"]
