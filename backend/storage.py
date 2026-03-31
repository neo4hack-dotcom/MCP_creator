from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .models import LLMSettings, TemplatePayload, TemplateRecord


BACKEND_DIR = Path(__file__).resolve().parent
APP_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
SETTINGS_PATH = DATA_DIR / "settings.json"
TEMPLATES_PATH = DATA_DIR / "templates.json"
GENERATED_DIR = APP_ROOT / "generated"


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)


def load_settings() -> LLMSettings:
    ensure_directories()
    if not SETTINGS_PATH.exists():
        return LLMSettings()

    return LLMSettings.model_validate_json(SETTINGS_PATH.read_text(encoding="utf-8"))


def save_settings(settings: LLMSettings) -> LLMSettings:
    ensure_directories()
    SETTINGS_PATH.write_text(
        json.dumps(settings.model_dump(), indent=2),
        encoding="utf-8",
    )
    return settings


def load_templates() -> list[TemplateRecord]:
    ensure_directories()
    if not TEMPLATES_PATH.exists():
        return []

    raw_items = json.loads(TEMPLATES_PATH.read_text(encoding="utf-8"))
    templates = [TemplateRecord.model_validate(item) for item in raw_items]
    return sorted(templates, key=lambda item: item.updated_at, reverse=True)


def _save_templates(templates: list[TemplateRecord]) -> None:
    ensure_directories()
    TEMPLATES_PATH.write_text(
        json.dumps([item.model_dump(mode="json") for item in templates], indent=2),
        encoding="utf-8",
    )


def create_template(payload: TemplatePayload) -> TemplateRecord:
    templates = load_templates()
    now = datetime.now(timezone.utc)
    template = TemplateRecord(
        id=str(uuid4()),
        name=payload.name.strip(),
        description=payload.description.strip(),
        spec=payload.spec,
        created_at=now,
        updated_at=now,
    )
    templates.append(template)
    _save_templates(templates)
    return template


def update_template(template_id: str, payload: TemplatePayload) -> TemplateRecord:
    templates = load_templates()
    updated_template: TemplateRecord | None = None

    for index, template in enumerate(templates):
        if template.id == template_id:
            updated_template = TemplateRecord(
                id=template.id,
                name=payload.name.strip(),
                description=payload.description.strip(),
                spec=payload.spec,
                created_at=template.created_at,
                updated_at=datetime.now(timezone.utc),
            )
            templates[index] = updated_template
            break

    if updated_template is None:
        raise FileNotFoundError(f"Template not found: {template_id}")

    _save_templates(templates)
    return updated_template


def delete_template(template_id: str) -> None:
    templates = load_templates()
    filtered = [template for template in templates if template.id != template_id]
    if len(filtered) == len(templates):
        raise FileNotFoundError(f"Template not found: {template_id}")
    _save_templates(filtered)
