from __future__ import annotations

import json
import re
from pathlib import Path
from pprint import pformat
from typing import Any

from .llm_client import request_json_completion
from .models import (
    BlueprintDatabaseIntegration,
    BlueprintPandasAIIntegration,
    BlueprintPrompt,
    BlueprintResource,
    BlueprintTool,
    DatabaseIntegrationSpec,
    LLMSettings,
    PandasAIIntegrationSpec,
    ProjectBlueprint,
    ProjectSpec,
)
from .storage import GENERATED_DIR, ensure_directories


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-_")
    return cleaned or "mcp-project"


def python_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]+", "_", value.strip().lower())
    cleaned = re.sub(r"_{2,}", "_", cleaned).strip("_")
    if not cleaned:
        cleaned = "generated_item"
    if cleaned[0].isdigit():
        cleaned = f"item_{cleaned}"
    return cleaned


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [part.strip() for part in parts if part.strip()]


def _input_annotation(input_type: str, required: bool) -> str:
    mapping = {
        "string": "str",
        "integer": "int",
        "number": "float",
        "boolean": "bool",
        "object": "dict[str, Any]",
        "array": "list[Any]",
    }
    annotation = mapping.get(input_type, "str")
    return annotation if required else f"{annotation} | None = None"


def _lines_or_default(items: list[str], fallback: list[str]) -> list[str]:
    return [item for item in items if item] or fallback


def _safe_python_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _python_literal(value: Any) -> str:
    return pformat(value, sort_dicts=False, width=100)


def _db_dependency(kind: str) -> str:
    return {
        "clickhouse": "clickhouse-connect",
        "oracle": "oracledb",
    }[kind]


def _db_env_vars(kind: str) -> list[str]:
    if kind == "clickhouse":
        return [
            "CLICKHOUSE_HOST",
            "CLICKHOUSE_PORT",
            "CLICKHOUSE_USER",
            "CLICKHOUSE_PASSWORD",
            "CLICKHOUSE_DATABASE",
            "CLICKHOUSE_SECURE",
        ]
    return [
        "ORACLE_USER",
        "ORACLE_PASSWORD",
        "ORACLE_DSN",
        "ORACLE_HOST",
        "ORACLE_PORT",
        "ORACLE_SERVICE_NAME",
    ]


def _db_setup_notes(integration: DatabaseIntegrationSpec) -> list[str]:
    if integration.kind == "clickhouse":
        return [
            "Uses the official clickhouse-connect Python client.",
            "The generated query scaffold is read-only and expects SELECT statements.",
            "Connection values are sourced from environment variables to keep secrets out of code.",
        ]
    return [
        "Uses python-oracledb in Thin mode by default, so Oracle Client libraries are not required.",
        "The generated query scaffold is read-only and expects SELECT or WITH statements.",
        "You can switch to Thick mode later if your Oracle features require it.",
    ]


def build_pandas_ai_integration(spec: ProjectSpec) -> BlueprintPandasAIIntegration | None:
    if not spec.pandas_ai or not spec.pandas_ai.enabled:
        return None

    purpose = spec.pandas_ai.purpose.strip() or (
        "Accept tabular data from this MCP or from upstream MCPs, then run calculations, "
        "data mining, and exploratory analysis with PandasAI."
    )

    return BlueprintPandasAIIntegration(
        enabled=True,
        name=spec.pandas_ai.name.strip() or "PandasAI Analyst",
        purpose=purpose,
        allow_multiple_datasets=spec.pandas_ai.allow_multiple_datasets,
        notes=spec.pandas_ai.notes.strip(),
        python_name="pandas_ai",
        helper_name="configure_pandasai",
        env_vars=[
            "PANDASAI_MODEL",
            "PANDASAI_API_KEY",
            "PANDASAI_API_BASE",
        ],
        setup_notes=[
            "Uses PandasAI with a LiteLLM backend so it can target an OpenAI-compatible local server.",
            "Accepts JSON datasets as tool input, which makes it easy to chain results coming from other MCPs.",
            "Supports single-dataset analysis and multi-dataset analysis in the generated scaffold.",
            "Recommended model values often use a provider prefix such as openai/your-model-name.",
        ],
    )


def build_database_integrations(spec: ProjectSpec) -> list[BlueprintDatabaseIntegration]:
    integrations: list[BlueprintDatabaseIntegration] = []
    for item in spec.database_integrations:
        label = item.name.strip() or ("ClickHouse" if item.kind == "clickhouse" else "Oracle Database")
        integrations.append(
            BlueprintDatabaseIntegration(
                kind=item.kind,
                name=label,
                purpose=item.purpose.strip()
                or (
                    "Expose safe analytics queries and schema inspection."
                    if item.kind == "clickhouse"
                    else "Expose safe Oracle reads and schema inspection."
                ),
                read_only=item.read_only,
                include_schema_tool=item.include_schema_tool,
                include_query_tool=item.include_query_tool,
                notes=item.notes.strip(),
                python_name=python_name(label),
                helper_name=(
                    "get_clickhouse_client"
                    if item.kind == "clickhouse"
                    else "get_oracle_connection"
                ),
                env_vars=_db_env_vars(item.kind),
                setup_notes=_db_setup_notes(item),
            )
        )
    return integrations


def fallback_blueprint(spec: ProjectSpec) -> ProjectBlueprint:
    server_name = spec.name.strip() or "Generated MCP"
    package_name = slugify(spec.name)
    pandas_ai = build_pandas_ai_integration(spec)
    database_integrations = build_database_integrations(spec)

    tools: list[BlueprintTool] = []
    for index, tool in enumerate(spec.tools, start=1):
        tool_name = tool.name.strip() or f"tool_{index}"
        workflow = _split_sentences(tool.implementation_notes)
        if not workflow:
            workflow = [
                "Validate the incoming parameters.",
                "Resolve the target business context from the provided inputs.",
                "Build a structured response with explicit status, summary, and next actions.",
            ]

        tools.append(
            BlueprintTool(
                name=tool_name,
                purpose=tool.purpose.strip() or f"Execute the {tool_name} workflow.",
                output_description=tool.output_description.strip()
                or "Structured JSON payload with the result summary.",
                implementation_notes=tool.implementation_notes.strip()
                or "Wire the domain logic, external services, and validation rules here.",
                safety_notes=tool.safety_notes.strip()
                or "Reject malformed inputs and avoid hidden side effects.",
                example_use=tool.example_use.strip()
                or f"Call {tool_name} with the minimum required parameters.",
                workflow_steps=workflow,
                python_name=python_name(tool_name),
                inputs=tool.inputs,
            )
        )

    resources = [
        BlueprintResource(
            name=resource.name.strip() or "project_reference",
            uri=resource.uri.strip() or f"{package_name}://reference",
            description=resource.description.strip()
            or "Reference data exposed by the MCP.",
            content_outline=resource.content_outline.strip()
            or "Operational notes and read-only context for the agent.",
            sample_payload=f"Reference payload for {resource.name.strip() or 'project_reference'}.",
        )
        for resource in spec.resources
    ]

    prompts = [
        BlueprintPrompt(
            name=prompt.name.strip() or "project_brief",
            description=prompt.description.strip()
            or "Guided prompt for a frequent MCP workflow.",
            goal=prompt.goal.strip() or "Help the client structure a high-signal request.",
            body=prompt.goal.strip()
            or "Provide a reliable, context-aware answer using the MCP tools.",
            python_name=python_name(prompt.name.strip() or "project_brief"),
            arguments=prompt.arguments,
        )
        for prompt in spec.prompts
    ]

    if not prompts:
        prompts = [
            BlueprintPrompt(
                name="project_brief",
                description="Default prompt that frames the MCP mission and expected outputs.",
                goal="Help the client produce a concise and grounded request.",
                body=(
                    f"You are working with the MCP '{server_name}'. Summarize the user goal, "
                    "select the most relevant tools, and mention any uncertainty explicitly."
                ),
                python_name="project_brief",
                arguments=[],
            )
        ]

    dependencies = ["fastmcp>=3.0.0", "pydantic>=2.7.0", *spec.external_dependencies]
    if pandas_ai:
        dependencies.extend(
            [
                "pandas>=2.2.0",
                "pandasai",
                "pandasai-litellm",
            ]
        )
    for integration in database_integrations:
        dependencies.append(_db_dependency(integration.kind))

    architecture_notes = _lines_or_default(
        [
            f"Primary goal: {spec.primary_goal.strip()}" if spec.primary_goal.strip() else "",
            f"Audience: {spec.audience.strip()}" if spec.audience.strip() else "",
            f"Domain context: {spec.domain_context.strip()}" if spec.domain_context.strip() else "",
            (
                f"PandasAI integration: {pandas_ai.name}" if pandas_ai else ""
            ),
            (
                "Database integrations: "
                + ", ".join(item.name for item in database_integrations)
                if database_integrations
                else ""
            ),
        ],
        [
            "Expose a focused set of FastMCP tools.",
            "Keep resource content read-only and explicit.",
            "Return structured payloads to make client orchestration easier.",
        ],
    )

    validation_checks = _lines_or_default(
        spec.test_scenarios,
        [
            "Nominal execution with valid inputs.",
            "Clean rejection when required inputs are missing.",
            "Readable error payload when downstream logic fails.",
        ],
    )

    if pandas_ai:
        validation_checks.extend(
            [
                "Validate that JSON dataset inputs can be parsed into DataFrames.",
                "Validate the single-dataset analysis tool with representative records.",
                "Validate the multi-dataset analysis tool with upstream MCP output payloads.",
            ]
        )

    for integration in database_integrations:
        validation_checks.append(f"Validate the {integration.kind} connection helper with environment variables.")
        if integration.include_query_tool:
            validation_checks.append(
                f"Ensure {integration.kind} query tools reject non-read-only SQL statements."
            )

    readme_highlights = [
        "FastMCP server generated from a guided project specification.",
        "Resources and prompts are documented alongside the tool catalog.",
        "Project scaffold is ready for domain-specific implementation wiring.",
    ]
    if pandas_ai:
        readme_highlights.append(
            "A PandasAI analysis layer is included for tabular inputs and cross-MCP analytical workflows."
        )
    if database_integrations:
        readme_highlights.append(
            "Database helper scaffolds and environment-variable setup are included for the selected systems."
        )

    return ProjectBlueprint(
        server_name=server_name,
        package_name=package_name,
        summary=spec.description.strip(),
        transport=spec.transport,
        architecture_notes=architecture_notes,
        dependencies=dependencies,
        validation_checks=validation_checks,
        readme_highlights=readme_highlights,
        generation_mode="fallback",
        pandas_ai=pandas_ai,
        database_integrations=database_integrations,
        tools=tools,
        resources=resources,
        prompts=prompts,
    )


def _response_schema_hint() -> dict[str, Any]:
    return {
        "server_name": "Human-readable MCP name",
        "package_name": "kebab-case-package-name",
        "summary": "Short summary",
        "transport": "stdio or streamable-http",
        "architecture_notes": ["short bullet", "short bullet"],
        "dependencies": ["fastmcp>=3.0.0"],
        "validation_checks": ["short bullet"],
        "readme_highlights": ["short bullet"],
        "pandas_ai": {
            "enabled": True,
            "name": "PandasAI Analyst",
            "purpose": "Analyze tabular inputs passed from other MCPs",
            "allow_multiple_datasets": True,
            "notes": "Expect JSON records or mappings of datasets",
            "python_name": "pandas_ai",
            "env_vars": ["PANDASAI_MODEL", "PANDASAI_API_BASE"],
            "helper_name": "configure_pandasai",
            "setup_notes": ["Uses PandasAI with LiteLLM"],
        },
        "database_integrations": [
            {
                "kind": "clickhouse",
                "name": "ClickHouse",
                "purpose": "Safe analytics access",
                "read_only": True,
                "include_schema_tool": True,
                "include_query_tool": True,
                "notes": "Query only analytics tables",
                "python_name": "clickhouse",
                "env_vars": ["CLICKHOUSE_HOST", "CLICKHOUSE_USER"],
                "helper_name": "get_clickhouse_client",
                "setup_notes": ["Uses clickhouse-connect"],
            }
        ],
        "tools": [
            {
                "name": "tool name",
                "purpose": "business purpose",
                "output_description": "expected output",
                "implementation_notes": "concrete implementation notes",
                "safety_notes": "guardrails",
                "example_use": "example use",
                "workflow_steps": ["step 1", "step 2"],
                "python_name": "tool_python_name",
                "inputs": [
                    {
                        "name": "input_name",
                        "type": "string",
                        "description": "input meaning",
                        "required": True,
                    }
                ],
            }
        ],
        "resources": [
            {
                "name": "resource name",
                "uri": "project://resource",
                "description": "resource description",
                "content_outline": "what it contains",
                "sample_payload": "example resource content",
            }
        ],
        "prompts": [
            {
                "name": "prompt_name",
                "description": "prompt description",
                "goal": "prompt goal",
                "body": "prompt body template",
                "python_name": "prompt_python_name",
                "arguments": [
                    {
                        "name": "topic",
                        "description": "prompt arg",
                        "required": True,
                    }
                ],
            }
        ],
    }


def llm_blueprint(spec: ProjectSpec, settings: LLMSettings) -> ProjectBlueprint:
    system_prompt = (
        "You are a senior FastMCP architect. Return only valid JSON. "
        "Design precise, implementation-ready MCP blueprints with safe tools, clear resource URIs, "
        "and prompts that help clients use the MCP well."
    )
    user_prompt = (
        "Build a FastMCP blueprint from the following project spec.\n"
        "Important rules:\n"
        "- Return JSON only, without markdown.\n"
        "- Keep tool names readable and python_name values valid Python identifiers.\n"
        "- Preserve pandas_ai and database_integrations and tailor notes/dependencies when they are selected.\n"
        "- Make workflow_steps explicit and practical.\n"
        "- Prefer safe, deterministic implementation notes.\n"
        "- Do not omit arrays; use empty arrays if needed.\n\n"
        f"Project spec:\n{json.dumps(spec.model_dump(), indent=2)}\n\n"
        f"Response schema hint:\n{json.dumps(_response_schema_hint(), indent=2)}\n"
    )
    payload = request_json_completion(
        settings,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    payload["generation_mode"] = "llm"
    return normalize_blueprint(payload, spec)


def normalize_blueprint(payload: dict[str, Any], spec: ProjectSpec) -> ProjectBlueprint:
    fallback = fallback_blueprint(spec)
    merged = fallback.model_dump()
    merged.update(
        {
            "server_name": payload.get("server_name") or fallback.server_name,
            "package_name": slugify(payload.get("package_name") or fallback.package_name),
            "summary": payload.get("summary") or fallback.summary,
            "transport": payload.get("transport") or fallback.transport,
            "architecture_notes": payload.get("architecture_notes") or fallback.architecture_notes,
            "dependencies": payload.get("dependencies") or fallback.dependencies,
            "validation_checks": payload.get("validation_checks") or fallback.validation_checks,
            "readme_highlights": payload.get("readme_highlights") or fallback.readme_highlights,
            "generation_mode": payload.get("generation_mode") or "llm",
        }
    )

    raw_pandas_ai = payload.get("pandas_ai")
    if raw_pandas_ai:
        pandas_ai_data = BlueprintPandasAIIntegration.model_validate(raw_pandas_ai).model_dump()
        pandas_ai_data["python_name"] = python_name(
            pandas_ai_data.get("python_name") or pandas_ai_data["name"] or "pandas_ai"
        )
        pandas_ai_data["helper_name"] = pandas_ai_data.get("helper_name") or "configure_pandasai"
        pandas_ai_data["env_vars"] = pandas_ai_data.get("env_vars") or [
            "PANDASAI_MODEL",
            "PANDASAI_API_KEY",
            "PANDASAI_API_BASE",
        ]
        pandas_ai_data["setup_notes"] = pandas_ai_data.get("setup_notes") or [
            "Uses PandasAI with a LiteLLM backend.",
            "Accepts JSON datasets from upstream MCPs.",
        ]
        merged["pandas_ai"] = pandas_ai_data
    else:
        merged["pandas_ai"] = fallback.pandas_ai.model_dump() if fallback.pandas_ai else None

    merged["database_integrations"] = []
    raw_integrations = payload.get("database_integrations") or fallback.database_integrations
    for raw_integration in raw_integrations:
        item = BlueprintDatabaseIntegration.model_validate(raw_integration).model_dump()
        item["python_name"] = python_name(item.get("python_name") or item["name"] or item["kind"])
        item["helper_name"] = item.get("helper_name") or (
            "get_clickhouse_client" if item["kind"] == "clickhouse" else "get_oracle_connection"
        )
        item["env_vars"] = item.get("env_vars") or _db_env_vars(item["kind"])
        item["setup_notes"] = item.get("setup_notes") or _db_setup_notes(
            DatabaseIntegrationSpec.model_validate(item)
        )
        merged["database_integrations"].append(item)

    merged["tools"] = []
    for index, raw_tool in enumerate(payload.get("tools") or fallback.tools, start=1):
        tool_data = BlueprintTool.model_validate(raw_tool).model_dump()
        tool_data["name"] = tool_data["name"] or f"tool_{index}"
        tool_data["python_name"] = python_name(tool_data.get("python_name") or tool_data["name"])
        if not tool_data.get("workflow_steps"):
            tool_data["workflow_steps"] = [
                "Validate the inputs.",
                "Execute the core domain workflow.",
                "Return a structured payload with summary and next actions.",
            ]
        merged["tools"].append(tool_data)

    merged["resources"] = []
    for raw_resource in payload.get("resources") or fallback.resources:
        resource_data = BlueprintResource.model_validate(raw_resource).model_dump()
        resource_data["uri"] = resource_data["uri"] or f"{merged['package_name']}://resource"
        merged["resources"].append(resource_data)

    merged["prompts"] = []
    for raw_prompt in payload.get("prompts") or fallback.prompts:
        prompt_data = BlueprintPrompt.model_validate(raw_prompt).model_dump()
        prompt_data["python_name"] = python_name(
            prompt_data.get("python_name") or prompt_data["name"] or "project_prompt"
        )
        merged["prompts"].append(prompt_data)

    deduped_dependencies: list[str] = []
    for dependency in merged["dependencies"]:
        if dependency not in deduped_dependencies:
            deduped_dependencies.append(dependency)
    merged["dependencies"] = deduped_dependencies

    return ProjectBlueprint.model_validate(merged)


def create_blueprint(spec: ProjectSpec, settings: LLMSettings) -> tuple[ProjectBlueprint, bool, list[str]]:
    warnings: list[str] = []
    if settings.base_url and settings.model:
        try:
            return llm_blueprint(spec, settings), True, warnings
        except Exception as exc:  # noqa: BLE001
            warnings.append(
                "Le LLM local n'a pas pu produire un JSON exploitable. "
                f"Fallback active: {exc}"
            )

    blueprint = fallback_blueprint(spec)
    return blueprint, False, warnings


def _pandasai_block(integration: BlueprintPandasAIIntegration) -> str:
    setup_resource = {
        "name": integration.name,
        "purpose": integration.purpose,
        "env_vars": integration.env_vars,
        "notes": integration.setup_notes + ([integration.notes] if integration.notes else []),
    }

    multi_dataset_tool = ""
    if integration.allow_multiple_datasets:
        multi_dataset_tool = '''
@mcp.tool
def pandasai_analyze_datasets(question: str, datasets_json: str) -> dict[str, Any]:
    """Analyze multiple datasets that may come from upstream MCP outputs."""
    configure_pandasai()
    frames, dataset_names = _load_named_datasets(datasets_json)
    result = pai.chat(question, *frames)
    return {
        "tool": "pandasai_analyze_datasets",
        "datasets": dataset_names,
        "question": question,
        "result": _serialize_pandasai_result(result),
    }
'''

    return f'''
try:
    import pandas as pd
    import pandasai as pai
    from pandasai_litellm.litellm import LiteLLM
except ImportError:
    pd = None
    pai = None
    LiteLLM = None


def configure_pandasai() -> None:
    if pd is None or pai is None or LiteLLM is None:
        raise RuntimeError("Install pandas, pandasai, and pandasai-litellm to enable PandasAI support.")

    model = os.getenv("PANDASAI_MODEL")
    if not model:
        raise RuntimeError("PANDASAI_MODEL is required.")

    llm_kwargs: dict[str, Any] = {{"model": model}}
    api_key = os.getenv("PANDASAI_API_KEY")
    api_base = os.getenv("PANDASAI_API_BASE")

    if api_key:
        llm_kwargs["api_key"] = api_key
    if api_base:
        llm_kwargs["api_base"] = api_base

    pai.config.set({{"llm": LiteLLM(**llm_kwargs)}})


def _normalize_records_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item if isinstance(item, dict) else {{"value": item}} for item in payload]
    if isinstance(payload, dict):
        if isinstance(payload.get("records"), list):
            return _normalize_records_payload(payload["records"])
        return [payload]
    raise ValueError("Expected a JSON list of records or an object containing records.")


def _load_dataframe(records_json: str):
    payload = json.loads(records_json)
    records = _normalize_records_payload(payload)
    dataframe = pd.DataFrame(records)
    return pai.DataFrame(dataframe), records


def _load_named_datasets(datasets_json: str) -> tuple[list[Any], list[str]]:
    payload = json.loads(datasets_json)
    frames: list[Any] = []
    names: list[str] = []

    if isinstance(payload, dict):
        for dataset_name, records in payload.items():
            normalized = _normalize_records_payload(records)
            frames.append(pai.DataFrame(pd.DataFrame(normalized)))
            names.append(str(dataset_name))
        return frames, names

    if isinstance(payload, list):
        for index, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                raise ValueError("Expected each dataset item to be an object.")
            dataset_name = str(item.get("name") or f"dataset_{{index}}")
            records = _normalize_records_payload(item.get("records", []))
            frames.append(pai.DataFrame(pd.DataFrame(records)))
            names.append(dataset_name)
        return frames, names

    raise ValueError("Expected datasets_json to be an object map or a list of named datasets.")


def _serialize_pandasai_result(result: Any) -> dict[str, Any]:
    if pd is not None and isinstance(result, pd.DataFrame):
        return {{
            "type": "dataframe",
            "rows": result.to_dict(orient="records"),
            "columns": list(result.columns),
            "row_count": len(result.index),
        }}

    if isinstance(result, (str, int, float, bool)) or result is None:
        return {{
            "type": type(result).__name__ if result is not None else "null",
            "value": result,
        }}

    if isinstance(result, list):
        return {{
            "type": "list",
            "value": result,
        }}

    if isinstance(result, dict):
        return {{
            "type": "dict",
            "value": result,
        }}

    return {{
        "type": type(result).__name__,
        "value": str(result),
    }}


@mcp.resource("project://pandasai/setup")
def pandasai_setup() -> dict[str, Any]:
    """Expose the generated PandasAI integration guide."""
    return {_python_literal(setup_resource)}


@mcp.tool
def pandasai_profile_records(records_json: str, dataset_name: str = "dataset") -> dict[str, Any]:
    """Profile incoming tabular data before running deeper analysis."""
    configure_pandasai()
    dataframe, records = _load_dataframe(records_json)
    pandas_df = pd.DataFrame(records)
    return {{
        "tool": "pandasai_profile_records",
        "dataset_name": dataset_name,
        "row_count": len(pandas_df.index),
        "columns": list(pandas_df.columns),
        "dtypes": {{column: str(dtype) for column, dtype in pandas_df.dtypes.items()}},
        "preview": pandas_df.head(10).to_dict(orient="records"),
        "analysis_ready": True,
    }}


@mcp.tool
def pandasai_analyze_records(question: str, records_json: str, dataset_name: str = "dataset") -> dict[str, Any]:
    """Analyze a single tabular dataset passed in as JSON records."""
    configure_pandasai()
    dataframe, _ = _load_dataframe(records_json)
    result = dataframe.chat(question)
    return {{
        "tool": "pandasai_analyze_records",
        "dataset_name": dataset_name,
        "question": question,
        "result": _serialize_pandasai_result(result),
    }}

{multi_dataset_tool}
'''


def _render_tool_signature(tool: BlueprintTool) -> str:
    if not tool.inputs:
        return ""

    parts = []
    for item in tool.inputs:
        parameter_name = python_name(item.name)
        annotation = _input_annotation(item.type, item.required)
        parts.append(f"{parameter_name}: {annotation}")
    return ", ".join(parts)


def _render_tool_payload(tool: BlueprintTool) -> str:
    if not tool.inputs:
        return "{}"
    payload = ",\n        ".join(
        f"{_safe_python_string(python_name(item.name))}: {python_name(item.name)}"
        for item in tool.inputs
    )
    return "{\n        " + payload + "\n    }"


def _clickhouse_block(integration: BlueprintDatabaseIntegration) -> str:
    setup_resource = {
        "kind": integration.kind,
        "name": integration.name,
        "purpose": integration.purpose,
        "env_vars": integration.env_vars,
        "notes": integration.setup_notes + ([integration.notes] if integration.notes else []),
    }

    schema_tool = ""
    if integration.include_schema_tool:
        schema_tool = '''
@mcp.tool
def clickhouse_list_tables(limit: int = 50) -> dict[str, Any]:
    """List the tables available in ClickHouse."""
    client = get_clickhouse_client()
    safe_limit = max(1, min(limit, 200))
    result = client.query(
        f"SELECT database, name, engine FROM system.tables ORDER BY database, name LIMIT {safe_limit}"
    )
    return {
        "database": "clickhouse",
        "columns": list(getattr(result, "column_names", []) or []),
        "rows": [list(row) for row in (getattr(result, "result_set", []) or [])],
        "row_count": len(getattr(result, "result_set", []) or []),
    }
'''

    query_tool = ""
    if integration.include_query_tool:
        query_tool = '''
@mcp.tool
def clickhouse_query(sql: str, limit: int = 100) -> dict[str, Any]:
    """Run a read-only query against ClickHouse."""
    statement = sql.strip().rstrip(";")
    if not statement.lower().startswith("select"):
        raise ValueError("Only SELECT statements are allowed in the ClickHouse scaffold.")

    client = get_clickhouse_client()
    result = client.query(statement)
    rows = [list(row) for row in (getattr(result, "result_set", []) or [])][: max(1, min(limit, 500))]
    return {
        "database": "clickhouse",
        "columns": list(getattr(result, "column_names", []) or []),
        "rows": rows,
        "row_count": len(rows),
        "read_only": True,
    }
'''

    return f'''
try:
    import clickhouse_connect
except ImportError:
    clickhouse_connect = None


def get_clickhouse_client():
    if clickhouse_connect is None:
        raise RuntimeError("Install 'clickhouse-connect' to enable ClickHouse support.")

    host = os.getenv("CLICKHOUSE_HOST")
    if not host:
        raise RuntimeError("CLICKHOUSE_HOST is required.")

    port = int(os.getenv("CLICKHOUSE_PORT", "8443"))
    secure = os.getenv("CLICKHOUSE_SECURE", "true").lower() in {{"1", "true", "yes", "on"}}
    return clickhouse_connect.get_client(
        host=host,
        port=port,
        username=os.getenv("CLICKHOUSE_USER", "default"),
        password=os.getenv("CLICKHOUSE_PASSWORD", ""),
        database=os.getenv("CLICKHOUSE_DATABASE", "default"),
        secure=secure,
    )


@mcp.resource("project://clickhouse/setup")
def clickhouse_setup() -> dict[str, Any]:
    """Expose the generated ClickHouse integration guide."""
    return {_python_literal(setup_resource)}


@mcp.tool
def clickhouse_ping() -> dict[str, Any]:
    """Validate the ClickHouse connection."""
    client = get_clickhouse_client()
    result = client.query("SELECT 1 AS ok")
    rows = [list(row) for row in (getattr(result, "result_set", []) or [])]
    return {{
        "database": "clickhouse",
        "status": "ok",
        "rows": rows,
    }}

{schema_tool}

{query_tool}
'''


def _oracle_block(integration: BlueprintDatabaseIntegration) -> str:
    setup_resource = {
        "kind": integration.kind,
        "name": integration.name,
        "purpose": integration.purpose,
        "env_vars": integration.env_vars,
        "notes": integration.setup_notes + ([integration.notes] if integration.notes else []),
    }

    schema_tool = ""
    if integration.include_schema_tool:
        schema_tool = '''
@mcp.tool
def oracle_list_tables(limit: int = 50) -> dict[str, Any]:
    """List Oracle tables visible to the current account."""
    safe_limit = max(1, min(limit, 200))
    with get_oracle_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT owner, table_name
                FROM all_tables
                ORDER BY owner, table_name
                FETCH FIRST {safe_limit} ROWS ONLY
                """
            )
            rows = [list(row) for row in cursor.fetchall()]
            columns = [item[0] for item in (cursor.description or [])]
    return {
        "database": "oracle",
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
    }
'''

    query_tool = ""
    if integration.include_query_tool:
        query_tool = '''
@mcp.tool
def oracle_query(sql: str, limit: int = 100) -> dict[str, Any]:
    """Run a read-only query against Oracle Database."""
    statement = sql.strip().rstrip(";")
    lowered = statement.lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        raise ValueError("Only SELECT or WITH statements are allowed in the Oracle scaffold.")

    safe_limit = max(1, min(limit, 500))
    with get_oracle_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(statement)
            rows = [list(row) for row in cursor.fetchmany(safe_limit)]
            columns = [item[0] for item in (cursor.description or [])]
    return {
        "database": "oracle",
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "read_only": True,
    }
'''

    return f'''
try:
    import oracledb
except ImportError:
    oracledb = None


def get_oracle_connection():
    if oracledb is None:
        raise RuntimeError("Install 'oracledb' to enable Oracle Database support.")

    user = os.getenv("ORACLE_USER")
    password = os.getenv("ORACLE_PASSWORD", "")
    dsn = os.getenv("ORACLE_DSN")

    if not dsn:
        host = os.getenv("ORACLE_HOST")
        port = os.getenv("ORACLE_PORT", "1521")
        service_name = os.getenv("ORACLE_SERVICE_NAME")
        if host and service_name:
            dsn = f"{{host}}:{{port}}/{{service_name}}"

    if not user or not dsn:
        raise RuntimeError("ORACLE_USER and ORACLE_DSN, or ORACLE_HOST plus ORACLE_SERVICE_NAME, are required.")

    return oracledb.connect(user=user, password=password, dsn=dsn)


@mcp.resource("project://oracle/setup")
def oracle_setup() -> dict[str, Any]:
    """Expose the generated Oracle integration guide."""
    return {_python_literal(setup_resource)}


@mcp.tool
def oracle_ping() -> dict[str, Any]:
    """Validate the Oracle connection."""
    with get_oracle_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM dual")
            row = cursor.fetchone()
    return {{
        "database": "oracle",
        "status": "ok",
        "row": list(row) if row else [],
    }}

{schema_tool}

{query_tool}
'''


def build_server_file(blueprint: ProjectBlueprint) -> str:
    resource_blocks = []
    for resource in blueprint.resources:
        function_name = python_name(f"resource_{resource.name}")
        payload = {
            "name": resource.name,
            "description": resource.description,
            "content_outline": resource.content_outline,
            "sample_payload": resource.sample_payload,
        }
        resource_blocks.append(
            f'''@mcp.resource({_safe_python_string(resource.uri)})
def {function_name}() -> dict[str, Any]:
    """Generated resource."""
    return {_python_literal(payload)}
'''
        )

    prompt_blocks = []
    for prompt in blueprint.prompts:
        signature = ", ".join(
            f"{python_name(argument.name)}: str" + ("" if argument.required else " | None = None")
            for argument in prompt.arguments
        )
        args_summary = "\\n".join(
            f"- {argument.name}: {{{python_name(argument.name)}}}"
            for argument in prompt.arguments
        )
        args_summary = args_summary or "- No arguments."
        prompt_content = f"Goal: {prompt.goal}\n\n{prompt.body}\n\nArguments:\n{args_summary}\n"
        prompt_blocks.append(
            f'''@mcp.prompt
def {prompt.python_name}({signature}) -> str:
    """Generated prompt template."""
    return {_safe_python_string(prompt_content)}
'''
        )

    tool_blocks = []
    for tool in blueprint.tools:
        signature = _render_tool_signature(tool)
        tool_blocks.append(
            f'''@mcp.tool
def {tool.python_name}({signature}) -> dict[str, Any]:
    """Generated tool scaffold."""
    payload = {_render_tool_payload(tool)}
    return {{
        "tool": {_safe_python_string(tool.name)},
        "status": "implemented_scaffold",
        "summary": {_safe_python_string(tool.output_description)},
        "purpose": {_safe_python_string(tool.purpose)},
        "workflow_steps": {_python_literal(tool.workflow_steps)},
        "guardrails": {_python_literal(_split_sentences(tool.safety_notes))},
        "implementation_notes": {_safe_python_string(tool.implementation_notes)},
        "example_use": {_safe_python_string(tool.example_use)},
        "inputs": payload,
        "next_actions": [
            "Replace the scaffold payload with domain-specific logic.",
            "Connect downstream services or data sources if needed.",
            "Add tests for the nominal and failure paths."
        ],
    }}
'''
        )

    if not resource_blocks:
        resource_blocks.append(
            '''@mcp.resource("project://overview")
def project_overview() -> dict[str, Any]:
    """Read-only overview of the generated MCP."""
    return PROJECT_BLUEPRINT
'''
        )

    pandas_ai_block = _pandasai_block(blueprint.pandas_ai) if blueprint.pandas_ai else ""

    database_blocks = []
    for integration in blueprint.database_integrations:
        if integration.kind == "clickhouse":
            database_blocks.append(_clickhouse_block(integration))
        elif integration.kind == "oracle":
            database_blocks.append(_oracle_block(integration))

    return f'''from __future__ import annotations

import json
import os
from typing import Any

from fastmcp import FastMCP
from fastmcp.server.transforms import PromptsAsTools, ResourcesAsTools


mcp = FastMCP({_safe_python_string(blueprint.server_name)})
mcp.add_transform(ResourcesAsTools(mcp))
mcp.add_transform(PromptsAsTools(mcp))

PROJECT_BLUEPRINT: dict[str, Any] = {_python_literal(blueprint.model_dump())}


@mcp.resource("project://blueprint")
def project_blueprint() -> dict[str, Any]:
    """Expose the generated blueprint as a resource."""
    return PROJECT_BLUEPRINT


{pandas_ai_block}

{chr(10).join(database_blocks)}

{chr(10).join(resource_blocks)}

{chr(10).join(prompt_blocks)}

{chr(10).join(tool_blocks)}


if __name__ == "__main__":
    mcp.run()
'''


def build_readme(blueprint: ProjectBlueprint) -> str:
    tool_lines = "\n".join(
        f"- `{tool.python_name}`: {tool.purpose}" for tool in blueprint.tools
    ) or "- No custom tools generated."
    resource_lines = "\n".join(
        f"- `{resource.uri}`: {resource.description}" for resource in blueprint.resources
    ) or "- No explicit resources generated."
    prompt_lines = "\n".join(
        f"- `{prompt.python_name}`: {prompt.description}" for prompt in blueprint.prompts
    ) or "- No explicit prompts generated."
    validation_lines = "\n".join(f"- {item}" for item in blueprint.validation_checks)
    database_lines = "\n".join(
        f"- `{item.kind}`: env vars {', '.join(item.env_vars)}"
        for item in blueprint.database_integrations
    ) or "- No database helpers selected."
    pandas_ai_lines = (
        "\n".join(f"- `{item}`" for item in blueprint.pandas_ai.env_vars)
        if blueprint.pandas_ai
        else "- PandasAI is not enabled for this project."
    )
    python_version_note = (
        "This project includes PandasAI. Verify the supported Python version for your selected PandasAI release before deployment."
        if blueprint.pandas_ai
        else "This project targets Python 3.10+."
    )

    return f"""# {blueprint.server_name}

{blueprint.summary}

## Overview

This project was generated by `MCP_creator` to provide a `FastMCP` server scaffold.

### Highlights

{chr(10).join(f"- {item}" for item in blueprint.readme_highlights)}

## Database Integrations

{database_lines}

## PandasAI

{pandas_ai_lines}

### PandasAI note

{python_version_note}

### Oracle note

The generated Oracle scaffold uses `python-oracledb` in Thin mode by default. This mode does not require Oracle Client libraries.

## Tools

{tool_lines}

## Resources

{resource_lines}

## Prompts

{prompt_lines}

## Run

### Windows PowerShell

```powershell
py -3 -m venv .venv
.venv\\Scripts\\Activate.ps1
python -m pip install -r requirements.txt
fastmcp run server.py
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
fastmcp run server.py
```

## Validation ideas

{validation_lines}
"""


def build_requirements(blueprint: ProjectBlueprint) -> str:
    unique: list[str] = []
    for dependency in blueprint.dependencies:
        if dependency not in unique:
            unique.append(dependency)
    return "\n".join(unique) + "\n"


def build_env_example(blueprint: ProjectBlueprint) -> str:
    lines = ["LOG_LEVEL=INFO"]

    if blueprint.pandas_ai:
        lines.extend(
            [
                "",
                "PANDASAI_MODEL=openai/your-local-model",
                "PANDASAI_API_KEY=local-key",
                "PANDASAI_API_BASE=http://127.0.0.1:1234/v1",
            ]
        )

    has_clickhouse = any(item.kind == "clickhouse" for item in blueprint.database_integrations)
    if has_clickhouse:
        lines.extend(
            [
                "",
                "CLICKHOUSE_HOST=localhost",
                "CLICKHOUSE_PORT=8443",
                "CLICKHOUSE_USER=default",
                "CLICKHOUSE_PASSWORD=",
                "CLICKHOUSE_DATABASE=default",
                "CLICKHOUSE_SECURE=true",
            ]
        )

    has_oracle = any(item.kind == "oracle" for item in blueprint.database_integrations)
    if has_oracle:
        lines.extend(
            [
                "",
                "ORACLE_USER=system",
                "ORACLE_PASSWORD=",
                "ORACLE_DSN=localhost/FREEPDB1",
                "ORACLE_HOST=localhost",
                "ORACLE_PORT=1521",
                "ORACLE_SERVICE_NAME=FREEPDB1",
            ]
        )

    return "\n".join(lines) + "\n"


def build_pyproject(blueprint: ProjectBlueprint) -> str:
    description = blueprint.summary.replace('"', "'").replace("\n", " ").strip()
    requires_python = ">=3.10"
    return f"""[project]
name = "{blueprint.package_name}"
version = "0.1.0"
description = "{description}"
requires-python = "{requires_python}"
dependencies = []

[tool.ruff]
line-length = 100
"""


def render_project(blueprint: ProjectBlueprint) -> dict[str, str]:
    return {
        "server.py": build_server_file(blueprint),
        "README.md": build_readme(blueprint),
        "requirements.txt": build_requirements(blueprint),
        ".env.example": build_env_example(blueprint),
        "pyproject.toml": build_pyproject(blueprint),
    }


def write_project(blueprint: ProjectBlueprint) -> tuple[Path, list[str]]:
    ensure_directories()
    target = GENERATED_DIR / blueprint.package_name
    if target.exists():
        raise FileExistsError(
            f"Le dossier {target} existe deja. Choisis un autre nom de projet."
        )

    target.mkdir(parents=True, exist_ok=False)
    files = render_project(blueprint)
    written_files: list[str] = []

    for relative_path, content in files.items():
        full_path = target / relative_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")
        written_files.append(relative_path)

    return target, written_files
