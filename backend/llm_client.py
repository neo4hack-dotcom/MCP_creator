from __future__ import annotations

import json
from typing import Any

import httpx

from .models import LLMSettings


def _build_chat_endpoint(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/chat/completions"):
        return trimmed
    if trimmed.endswith("/v1"):
        return f"{trimmed}/chat/completions"
    return f"{trimmed}/v1/chat/completions"


def _build_models_endpoint(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/models"):
        return trimmed
    if trimmed.endswith("/v1"):
        return f"{trimmed}/models"
    return f"{trimmed}/v1/models"


def _strip_code_fences(content: str) -> str:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        parts = cleaned.split("\n", 1)
        cleaned = parts[1] if len(parts) == 2 else cleaned
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def _build_headers(settings: LLMSettings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    return headers


def list_models(settings: LLMSettings) -> list[str]:
    if not settings.base_url:
        raise ValueError("Base URL is missing.")

    endpoint = _build_models_endpoint(settings.base_url)

    with httpx.Client(timeout=30.0) as client:
        response = client.get(endpoint, headers=_build_headers(settings))
        response.raise_for_status()
        data = response.json()

    models = []
    for item in data.get("data", []):
        if isinstance(item, dict) and item.get("id"):
            models.append(str(item["id"]))
    return models


def ping_chat_completion(settings: LLMSettings) -> None:
    if not settings.base_url or not settings.model:
        raise ValueError("Base URL and model are required to test chat completion.")

    payload = {
        "model": settings.model,
        "temperature": 0,
        "max_tokens": 1,
        "messages": [
            {"role": "system", "content": "Return a very short answer."},
            {"role": "user", "content": "ping"},
        ],
    }

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            _build_chat_endpoint(settings.base_url),
            headers=_build_headers(settings),
            json=payload,
        )
        response.raise_for_status()


def request_json_completion(
    settings: LLMSettings,
    *,
    system_prompt: str,
    user_prompt: str,
) -> dict[str, Any]:
    if not settings.base_url or not settings.model:
        raise ValueError("LLM settings are incomplete.")

    payload = {
        "model": settings.model,
        "temperature": settings.temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    endpoint = _build_chat_endpoint(settings.base_url)

    with httpx.Client(timeout=120.0) as client:
        response = client.post(endpoint, headers=_build_headers(settings), json=payload)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices") or []
    if not choices:
        raise ValueError("LLM response does not contain any choices.")

    message = choices[0].get("message") or {}
    content = message.get("content")

    if isinstance(content, list):
        content = "".join(
            item.get("text", "") for item in content if isinstance(item, dict)
        )

    if not isinstance(content, str) or not content.strip():
        raise ValueError("LLM response does not contain textual content.")

    cleaned = _strip_code_fences(content)
    return json.loads(cleaned)
