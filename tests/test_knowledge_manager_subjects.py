import json

import pytest

from src.knowledge.manager import KnowledgeBaseManager
from src.services.config.knowledge_base_config import KnowledgeBaseConfigService


@pytest.fixture(autouse=True)
def reset_kb_config_service():
    previous = KnowledgeBaseConfigService._instance
    KnowledgeBaseConfigService._instance = None
    yield
    KnowledgeBaseConfigService._instance = previous


def _write_kb(base_dir, name: str, subject: str):
    kb_dir = base_dir / name
    kb_dir.mkdir(parents=True)
    (kb_dir / "metadata.json").write_text(
        json.dumps({"name": name, "subject": subject}),
        encoding="utf-8",
    )


def _set_config_service(tmp_path, payload: dict):
    config_path = tmp_path / "knowledge_base_configs.json"
    config_path.write_text(json.dumps(payload), encoding="utf-8")
    KnowledgeBaseConfigService._instance = KnowledgeBaseConfigService(config_path)
    return config_path


def test_legacy_knowledge_base_is_migrated_to_science(tmp_path):
    base_dir = tmp_path / "knowledge_bases"
    kb_dir = base_dir / "demo"
    kb_dir.mkdir(parents=True)
    (kb_dir / "metadata.json").write_text("{}", encoding="utf-8")
    (base_dir / "kb_config.json").write_text(
        json.dumps(
            {
                "knowledge_bases": {
                    "demo": {
                        "path": "demo",
                        "description": "Legacy KB",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    manager = KnowledgeBaseManager(str(base_dir))

    assert manager.get_subject("demo") == "science"

    persisted = json.loads((base_dir / "kb_config.json").read_text(encoding="utf-8"))
    assert persisted["knowledge_bases"]["demo"]["subject"] == "science"


def test_list_subject_knowledge_bases_filters_by_subject(tmp_path):
    base_dir = tmp_path / "knowledge_bases"
    for name in ("stats", "algorithms"):
        kb_dir = base_dir / name
        kb_dir.mkdir(parents=True)
        (kb_dir / "metadata.json").write_text("{}", encoding="utf-8")

    (base_dir / "kb_config.json").write_text(
        json.dumps(
            {
                "knowledge_bases": {
                    "stats": {
                        "path": "stats",
                        "description": "Stats KB",
                        "subject": "science",
                    },
                    "algorithms": {
                        "path": "algorithms",
                        "description": "Algo KB",
                        "subject": "engineering",
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    manager = KnowledgeBaseManager(str(base_dir))

    science_kbs = manager.list_knowledge_bases("science")
    engineering_kbs = manager.list_knowledge_bases("engineering")

    assert science_kbs == ["stats"]
    assert engineering_kbs == ["algorithms"]


def test_get_default_for_subject_prefers_subject_defaults(tmp_path):
    base_dir = tmp_path / "knowledge_bases"
    _write_kb(base_dir, "biology", "science")
    _write_kb(base_dir, "chemistry", "science")
    (base_dir / "kb_config.json").write_text(
        json.dumps(
            {
                "knowledge_bases": {
                    "biology": {
                        "path": "biology",
                        "description": "Biology",
                        "subject": "science",
                    },
                    "chemistry": {
                        "path": "chemistry",
                        "description": "Chemistry",
                        "subject": "science",
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    _set_config_service(
        tmp_path,
        {
            "configs": {},
            "default_kb": None,
            "subject_defaults": {
                "liberal_arts": None,
                "science": "chemistry",
                "engineering": None,
            },
            "global_defaults": {"rag_provider": "llamaindex", "search_mode": "hybrid"},
        },
    )

    manager = KnowledgeBaseManager(str(base_dir))

    assert manager.get_default_for_subject("science") == "chemistry"
    assert manager.get_info("chemistry")["is_default"] is True
    assert manager.get_info("biology")["is_default"] is False


def test_legacy_global_default_falls_back_to_science_subject(tmp_path):
    base_dir = tmp_path / "knowledge_bases"
    _write_kb(base_dir, "stats", "science")
    (base_dir / "kb_config.json").write_text(
        json.dumps(
            {
                "knowledge_bases": {
                    "stats": {
                        "path": "stats",
                        "description": "Stats",
                        "subject": "science",
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    _set_config_service(
        tmp_path,
        {
            "configs": {},
            "default_kb": "stats",
            "global_defaults": {"rag_provider": "llamaindex", "search_mode": "hybrid"},
        },
    )

    manager = KnowledgeBaseManager(str(base_dir))

    assert manager.get_default_for_subject("science") == "stats"


def test_set_subject_updates_metadata_and_filters(tmp_path):
    base_dir = tmp_path / "knowledge_bases"
    _write_kb(base_dir, "algorithms", "science")
    (base_dir / "kb_config.json").write_text(
        json.dumps(
            {
                "knowledge_bases": {
                    "algorithms": {
                        "path": "algorithms",
                        "description": "Algorithms",
                        "subject": "science",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    manager = KnowledgeBaseManager(str(base_dir))
    manager.set_subject("algorithms", "engineering")

    assert manager.get_subject("algorithms") == "engineering"
    assert manager.list_knowledge_bases("science") == []
    assert manager.list_knowledge_bases("engineering") == ["algorithms"]

    metadata = json.loads((base_dir / "algorithms" / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["subject"] == "engineering"
