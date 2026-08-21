from fastapi.testclient import TestClient

from src.api.main import app

client = TestClient(app)


DEFAULT_HEALTH_ENDPOINTS = {
    "/api/v1/chat/health": "chat",
    "/api/v1/knowledge/health": "knowledge",
    "/api/v1/dashboard/health": "dashboard",
    "/api/v1/notebook/health": "notebook",
    "/api/v1/settings/health": "settings",
    "/api/v1/solve/health": "solve",
    "/api/v1/system/health": "system",
    "/api/v1/config/health": "config",
    "/api/v1/agent-config/health": "agent-config",
}

SUPPORTED_LEARNING_ENDPOINTS = {
    "/api/v1/feynman/health": "feynman",
    "/api/v1/guide/health": "guide",
    "/api/v1/teacher/health": "teacher",
}


def test_root_route():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["message"] == "Welcome to ThinkPilot API"


def test_notebook_health_route():
    response = client.get("/api/v1/notebook/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_default_supported_module_health_routes():
    for path, service in DEFAULT_HEALTH_ENDPOINTS.items():
        response = client.get(path)
        assert response.status_code == 200, path
        assert response.json() == {"status": "healthy", "service": service}, path


def test_supported_learning_module_health_routes():
    for path, service in SUPPORTED_LEARNING_ENDPOINTS.items():
        response = client.get(path)
        assert response.status_code == 200, path
        assert response.json() == {"status": "healthy", "service": service}, path
