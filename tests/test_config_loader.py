from pathlib import Path

from src.services.config.loader import load_config_with_main


def test_load_config_with_main_legacy_alias(tmp_path: Path):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "main.yaml").write_text(
        "solve:\n  valid_tools:\n    - web_search\n", encoding="utf-8"
    )

    loaded = load_config_with_main("solve_config.yaml", project_root=tmp_path)

    assert loaded["solve"]["valid_tools"] == ["web_search"]
