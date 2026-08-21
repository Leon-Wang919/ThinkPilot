from src.services.setup.runtime import get_runtime_settings, reset_runtime_settings_cache


def test_runtime_settings_dev_defaults(monkeypatch):
    for key in (
        "APP_ENV",
        "BACKEND_PORT",
        "FRONTEND_PORT",
        "NEXT_PUBLIC_API_BASE",
        "NEXT_PUBLIC_API_BASE_EXTERNAL",
        "CORS_ALLOWED_ORIGINS",
    ):
        monkeypatch.delenv(key, raising=False)

    reset_runtime_settings_cache()
    settings = get_runtime_settings()

    assert settings.backend_port == 8001
    assert settings.frontend_port == 3782
    assert settings.allowed_cors_origins == [
        "http://localhost:3782",
        "http://127.0.0.1:3782",
    ]


def test_runtime_settings_production_requires_explicit_cors(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)

    reset_runtime_settings_cache()
    settings = get_runtime_settings()

    assert settings.allowed_cors_origins == []

    reset_runtime_settings_cache()
