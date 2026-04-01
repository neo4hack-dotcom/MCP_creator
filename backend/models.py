from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class LLMSettings(BaseModel):
    base_url: str = "http://127.0.0.1:1234/v1"
    api_key: str = ""
    model: str = ""
    temperature: float = Field(default=0.2, ge=0.0, le=1.0)


class LLMModelsResponse(BaseModel):
    models: list[str] = Field(default_factory=list)


class LLMTestResponse(BaseModel):
    ok: bool
    message: str
    models: list[str] = Field(default_factory=list)
    selected_model_available: bool = False


class ToolInputSpec(BaseModel):
    name: str = ""
    type: str = "string"
    description: str = ""
    required: bool = True


class ToolSpec(BaseModel):
    name: str = ""
    purpose: str = ""
    output_description: str = ""
    implementation_notes: str = ""
    safety_notes: str = ""
    example_use: str = ""
    inputs: list[ToolInputSpec] = Field(default_factory=list)


class ResourceSpec(BaseModel):
    name: str = ""
    uri: str = ""
    description: str = ""
    content_outline: str = ""


class PromptArgumentSpec(BaseModel):
    name: str = ""
    description: str = ""
    required: bool = True


class PromptSpec(BaseModel):
    name: str = ""
    description: str = ""
    goal: str = ""
    arguments: list[PromptArgumentSpec] = Field(default_factory=list)


class DatabaseIntegrationSpec(BaseModel):
    kind: Literal["clickhouse", "oracle"]
    name: str = ""
    purpose: str = ""
    read_only: bool = True
    include_schema_tool: bool = True
    include_query_tool: bool = True
    notes: str = ""


class PandasAIIntegrationSpec(BaseModel):
    enabled: bool = False
    name: str = "PandasAI Analyst"
    purpose: str = ""
    allow_multiple_datasets: bool = True
    notes: str = ""


class ProjectSpec(BaseModel):
    name: str
    description: str
    audience: str = ""
    transport: Literal["stdio", "streamable-http"] = "stdio"
    primary_goal: str = ""
    domain_context: str = ""
    llm_role: str = ""
    safety_guardrails: list[str] = Field(default_factory=list)
    external_dependencies: list[str] = Field(default_factory=list)
    test_scenarios: list[str] = Field(default_factory=list)
    pandas_ai: PandasAIIntegrationSpec | None = None
    database_integrations: list[DatabaseIntegrationSpec] = Field(default_factory=list)
    tools: list[ToolSpec] = Field(default_factory=list)
    resources: list[ResourceSpec] = Field(default_factory=list)
    prompts: list[PromptSpec] = Field(default_factory=list)


class BlueprintTool(ToolSpec):
    workflow_steps: list[str] = Field(default_factory=list)
    python_name: str = ""


class BlueprintResource(ResourceSpec):
    sample_payload: str = ""


class BlueprintPrompt(PromptSpec):
    body: str = ""
    python_name: str = ""


class BlueprintDatabaseIntegration(DatabaseIntegrationSpec):
    python_name: str = ""
    env_vars: list[str] = Field(default_factory=list)
    helper_name: str = ""
    setup_notes: list[str] = Field(default_factory=list)


class BlueprintPandasAIIntegration(PandasAIIntegrationSpec):
    python_name: str = ""
    env_vars: list[str] = Field(default_factory=list)
    helper_name: str = ""
    setup_notes: list[str] = Field(default_factory=list)


class ProjectBlueprint(BaseModel):
    server_name: str
    package_name: str
    summary: str
    transport: str
    architecture_notes: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    validation_checks: list[str] = Field(default_factory=list)
    readme_highlights: list[str] = Field(default_factory=list)
    generation_mode: str = "fallback"
    pandas_ai: BlueprintPandasAIIntegration | None = None
    database_integrations: list[BlueprintDatabaseIntegration] = Field(default_factory=list)
    tools: list[BlueprintTool] = Field(default_factory=list)
    resources: list[BlueprintResource] = Field(default_factory=list)
    prompts: list[BlueprintPrompt] = Field(default_factory=list)


class PreviewResponse(BaseModel):
    blueprint: ProjectBlueprint
    llm_used: bool
    warnings: list[str] = Field(default_factory=list)


class GenerateResponse(PreviewResponse):
    output_path: str
    files: list[str]


class TemplatePayload(BaseModel):
    name: str
    description: str = ""
    spec: ProjectSpec


class TemplateRecord(TemplatePayload):
    id: str
    created_at: datetime
    updated_at: datetime
