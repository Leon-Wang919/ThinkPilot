from __future__ import annotations


def build_health_payload(service: str) -> dict[str, str]:
    """Return a consistent health payload for API modules."""
    return {"status": "healthy", "service": service}
