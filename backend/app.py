from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .generator import create_blueprint, write_project
from .llm_client import list_models, ping_chat_completion
from .models import (
    GenerateResponse,
    LLMModelsResponse,
    LLMSettings,
    LLMTestResponse,
    PreviewResponse,
    ProjectSpec,
    TemplatePayload,
    TemplateRecord,
)
from .storage import (
    create_template,
    delete_template,
    load_settings,
    load_templates,
    save_settings,
    update_template,
)

app = FastAPI(title="MCP Creator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/settings", response_model=LLMSettings)
def get_settings() -> LLMSettings:
    return load_settings()


@app.put("/api/settings", response_model=LLMSettings)
def update_settings(settings: LLMSettings) -> LLMSettings:
    return save_settings(settings)


@app.post("/api/llm/models", response_model=LLMModelsResponse)
def get_llm_models(settings: LLMSettings) -> LLMModelsResponse:
    try:
        models = list_models(settings)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return LLMModelsResponse(models=models)


@app.post("/api/llm/test", response_model=LLMTestResponse)
def test_llm_connection(settings: LLMSettings) -> LLMTestResponse:
    try:
        models = list_models(settings)
        selected_available = not settings.model or settings.model in models
        message = (
            "Connexion reussie et modele selectionne disponible."
            if selected_available and settings.model
            else "Connexion reussie. La liste des modeles a ete recuperee."
        )
        if settings.model and not selected_available:
            message = (
                "Connexion reussie, mais le modele selectionne n'apparait pas dans la liste "
                "retournee par le serveur."
            )

        return LLMTestResponse(
            ok=True,
            message=message,
            models=models,
            selected_model_available=selected_available,
        )
    except Exception as models_exc:  # noqa: BLE001
        if settings.model:
            try:
                ping_chat_completion(settings)
                return LLMTestResponse(
                    ok=True,
                    message=(
                        "Connexion chat reussie, mais le endpoint /models n'est pas exploitable "
                        "sur ce serveur local."
                    ),
                    models=[],
                    selected_model_available=True,
                )
            except Exception:  # noqa: BLE001
                pass

        raise HTTPException(status_code=400, detail=str(models_exc)) from models_exc


@app.post("/api/preview", response_model=PreviewResponse)
def preview_project(spec: ProjectSpec) -> PreviewResponse:
    settings = load_settings()
    blueprint, llm_used, warnings = create_blueprint(spec, settings)
    return PreviewResponse(blueprint=blueprint, llm_used=llm_used, warnings=warnings)


@app.post("/api/generate", response_model=GenerateResponse)
def generate_project(spec: ProjectSpec) -> GenerateResponse:
    settings = load_settings()
    blueprint, llm_used, warnings = create_blueprint(spec, settings)

    try:
        output_path, files = write_project(blueprint)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return GenerateResponse(
        blueprint=blueprint,
        llm_used=llm_used,
        warnings=warnings,
        output_path=str(output_path),
        files=files,
    )


@app.get("/api/templates", response_model=list[TemplateRecord])
def get_templates() -> list[TemplateRecord]:
    return load_templates()


@app.post("/api/templates", response_model=TemplateRecord)
def add_template(payload: TemplatePayload) -> TemplateRecord:
    return create_template(payload)


@app.put("/api/templates/{template_id}", response_model=TemplateRecord)
def replace_template(template_id: str, payload: TemplatePayload) -> TemplateRecord:
    try:
        return update_template(template_id, payload)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/templates/{template_id}")
def remove_template(template_id: str) -> dict[str, str]:
    try:
        delete_template(template_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted"}
