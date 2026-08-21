from fastapi.testclient import TestClient

from src.api.main import app
from src.api.routers import audio as audio_router

client = TestClient(app)


async def _fake_transcribe_success(**kwargs):
    assert kwargs["filename"] == "sample.wav"
    assert kwargs["language"] == "zh"
    return "你好，世界"


async def _fake_transcribe_empty(**kwargs):
    return ""


def test_audio_transcribe_success(monkeypatch):
    monkeypatch.setattr(audio_router, "transcribe_audio_with_provider", _fake_transcribe_success)

    response = client.post(
        "/api/v1/audio/transcribe",
        files={"file": ("sample.wav", b"fake-audio", "audio/wav")},
        data={"language": "zh"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["text"] == "你好，世界"


def test_audio_transcribe_empty_file():
    response = client.post(
        "/api/v1/audio/transcribe",
        files={"file": ("sample.wav", b"", "audio/wav")},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["message"] == "Empty audio file"


def test_audio_transcribe_no_result(monkeypatch):
    monkeypatch.setattr(audio_router, "transcribe_audio_with_provider", _fake_transcribe_empty)

    response = client.post(
        "/api/v1/audio/transcribe",
        files={"file": ("sample.wav", b"fake-audio", "audio/wav")},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["message"] == "No transcription result"
