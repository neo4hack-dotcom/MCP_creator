import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createTemplate,
  deleteTemplate,
  generateProject,
  listModels,
  loadSettings,
  loadTemplates,
  previewProject,
  saveSettings,
  testLLMConnection,
  updateTemplate
} from "./api";
import type {
  DatabaseIntegration,
  GenerateResponse,
  LLMSettings,
  PreviewResponse,
  ProjectSpec,
  PromptArgument,
  PromptSpec,
  ResourceSpec,
  TemplateRecord,
  ToolInput,
  ToolSpec
} from "./types";

const steps = [
  "LLM Setup",
  "Scope & Integrations",
  "Tools",
  "Resources & Prompts",
  "Preview & Generate"
];

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createToolInput(): ToolInput {
  return {
    id: uid("input"),
    name: "",
    type: "string",
    description: "",
    required: true
  };
}

function createTool(): ToolSpec {
  return {
    id: uid("tool"),
    name: "",
    purpose: "",
    outputDescription: "",
    implementationNotes: "",
    safetyNotes: "",
    exampleUse: "",
    inputs: [createToolInput()]
  };
}

function createResource(): ResourceSpec {
  return {
    id: uid("resource"),
    name: "",
    uri: "",
    description: "",
    contentOutline: ""
  };
}

function createPromptArgument(): PromptArgument {
  return {
    id: uid("prompt-arg"),
    name: "",
    description: "",
    required: true
  };
}

function createPrompt(): PromptSpec {
  return {
    id: uid("prompt"),
    name: "",
    description: "",
    goal: "",
    arguments: [createPromptArgument()]
  };
}

function createDatabaseIntegration(kind: "clickhouse" | "oracle"): DatabaseIntegration {
  return {
    id: uid(kind),
    kind,
    name: kind === "clickhouse" ? "ClickHouse" : "Oracle Database",
    purpose:
      kind === "clickhouse"
        ? "Expose read-only analytics queries."
        : "Expose read-only Oracle reads.",
    readOnly: true,
    includeSchemaTool: true,
    includeQueryTool: true,
    notes: ""
  };
}

const initialSpec: ProjectSpec = {
  name: "",
  description: "",
  audience: "",
  transport: "stdio",
  primaryGoal: "",
  domainContext: "",
  llmRole: "",
  safetyGuardrails: [
    "Validate and normalize inputs before any external action.",
    "Return explicit structured responses when errors happen."
  ],
  externalDependencies: [],
  testScenarios: [
    "Nominal tool execution with valid parameters.",
    "Clean rejection when a required input is missing."
  ],
  databaseIntegrations: [],
  tools: [createTool()],
  resources: [],
  prompts: []
};

const initialSettings: LLMSettings = {
  baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: "",
  model: "",
  temperature: 0.2
};

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(items: string[]) {
  return items.join("\n");
}

function normalizeSpecForEditor(input: ProjectSpec): ProjectSpec {
  return {
    ...initialSpec,
    ...input,
    safetyGuardrails: input.safetyGuardrails ?? [],
    externalDependencies: input.externalDependencies ?? [],
    testScenarios: input.testScenarios ?? [],
    databaseIntegrations: (input.databaseIntegrations ?? []).map((integration) => ({
      ...createDatabaseIntegration(integration.kind),
      ...integration,
      id: uid(integration.kind)
    })),
    tools: (input.tools ?? []).map((tool) => ({
      ...createTool(),
      ...tool,
      id: uid("tool"),
      inputs: (tool.inputs ?? []).map((item) => ({
        ...createToolInput(),
        ...item,
        id: uid("input")
      }))
    })),
    resources: (input.resources ?? []).map((resource) => ({
      ...createResource(),
      ...resource,
      id: uid("resource")
    })),
    prompts: (input.prompts ?? []).map((prompt) => ({
      ...createPrompt(),
      ...prompt,
      id: uid("prompt"),
      arguments: (prompt.arguments ?? []).map((argument) => ({
        ...createPromptArgument(),
        ...argument,
        id: uid("prompt-arg")
      }))
    }))
  };
}

function App() {
  const [currentStep, setCurrentStep] = useState(0);
  const [settings, setSettings] = useState<LLMSettings>(initialSettings);
  const [spec, setSpec] = useState<ProjectSpec>(initialSpec);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [generation, setGeneration] = useState<GenerateResponse | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [llmStatus, setLLMStatus] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingLLM, setIsTestingLLM] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    loadSettings()
      .then((payload) => setSettings(payload))
      .catch(() => {
        // Keep defaults when settings file does not exist yet.
      });

    loadTemplates()
      .then((items) => setTemplates(items))
      .catch(() => {
        // Templates are optional; keep the UI usable even if storage has not been initialized.
      });
  }, []);

  const readiness = useMemo(() => {
    const namedTools = spec.tools.filter((tool) => tool.name.trim() && tool.purpose.trim());
    return {
      hasProjectCore: Boolean(spec.name.trim() && spec.description.trim()),
      hasTooling: namedTools.length > 0 || spec.databaseIntegrations.length > 0,
      hasLLMConfig: Boolean(settings.baseUrl.trim()),
      hasSelectedModel: Boolean(settings.model.trim())
    };
  }, [settings, spec]);

  function updateTool(toolId: string, patch: Partial<ToolSpec>) {
    setSpec((current) => ({
      ...current,
      tools: current.tools.map((tool) => (tool.id === toolId ? { ...tool, ...patch } : tool))
    }));
  }

  function updateToolInput(toolId: string, inputId: string, patch: Partial<ToolInput>) {
    setSpec((current) => ({
      ...current,
      tools: current.tools.map((tool) =>
        tool.id === toolId
          ? {
              ...tool,
              inputs: tool.inputs.map((input) =>
                input.id === inputId ? { ...input, ...patch } : input
              )
            }
          : tool
      )
    }));
  }

  function updateResource(resourceId: string, patch: Partial<ResourceSpec>) {
    setSpec((current) => ({
      ...current,
      resources: current.resources.map((resource) =>
        resource.id === resourceId ? { ...resource, ...patch } : resource
      )
    }));
  }

  function updatePrompt(promptId: string, patch: Partial<PromptSpec>) {
    setSpec((current) => ({
      ...current,
      prompts: current.prompts.map((prompt) =>
        prompt.id === promptId ? { ...prompt, ...patch } : prompt
      )
    }));
  }

  function updatePromptArgument(promptId: string, argumentId: string, patch: Partial<PromptArgument>) {
    setSpec((current) => ({
      ...current,
      prompts: current.prompts.map((prompt) =>
        prompt.id === promptId
          ? {
              ...prompt,
              arguments: prompt.arguments.map((argument) =>
                argument.id === argumentId ? { ...argument, ...patch } : argument
              )
            }
          : prompt
      )
    }));
  }

  function updateDatabaseIntegration(
    integrationId: string,
    patch: Partial<DatabaseIntegration>
  ) {
    setSpec((current) => ({
      ...current,
      databaseIntegrations: current.databaseIntegrations.map((integration) =>
        integration.id === integrationId ? { ...integration, ...patch } : integration
      )
    }));
  }

  function addDatabaseIntegration(kind: "clickhouse" | "oracle") {
    setSpec((current) => {
      if (current.databaseIntegrations.some((item) => item.kind === kind)) {
        return current;
      }

      return {
        ...current,
        databaseIntegrations: [...current.databaseIntegrations, createDatabaseIntegration(kind)]
      };
    });
  }

  function applyTemplate(template: TemplateRecord) {
    setSpec(normalizeSpecForEditor(template.spec));
    setSelectedTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateDescription(template.description);
    setCurrentStep(1);
    setMessage(`Template "${template.name}" applied.`);
    setError("");
  }

  function resetTemplateEditor() {
    setSelectedTemplateId("");
    setTemplateName("");
    setTemplateDescription("");
  }

  async function handleCreateTemplate() {
    if (!templateName.trim()) {
      setError("Enter a template name.");
      setMessage("");
      return;
    }

    setError("");
    setMessage("");
    setIsSavingTemplate(true);

    try {
      const created = await createTemplate({
        name: templateName,
        description: templateDescription,
        spec
      });
      setTemplates((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedTemplateId(created.id);
      setMessage(`Template "${created.name}" saved.`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save the template."
      );
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function handleUpdateTemplate() {
    if (!selectedTemplateId) {
      setError("Select a template to update first.");
      setMessage("");
      return;
    }

    if (!templateName.trim()) {
      setError("Enter a template name.");
      setMessage("");
      return;
    }

    setError("");
    setMessage("");
    setIsSavingTemplate(true);

    try {
      const updated = await updateTemplate(selectedTemplateId, {
        name: templateName,
        description: templateDescription,
        spec
      });
      setTemplates((current) =>
        [updated, ...current.filter((item) => item.id !== updated.id)].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        )
      );
      setMessage(`Template "${updated.name}" updated.`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update the template."
      );
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    setError("");
    setMessage("");
    setIsDeletingTemplate(true);

    try {
      await deleteTemplate(templateId);
      setTemplates((current) => current.filter((item) => item.id !== templateId));
      if (selectedTemplateId === templateId) {
        resetTemplateEditor();
      }
      setMessage("Template deleted.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to delete the template."
      );
    } finally {
      setIsDeletingTemplate(false);
    }
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSavingSettings(true);

    try {
      const payload = await saveSettings(settings);
      setSettings(payload);
      setMessage("LLM settings saved.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save the settings."
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleTestLLM() {
    setError("");
    setMessage("");
    setLLMStatus("");
    setIsTestingLLM(true);

    try {
      const payload = await testLLMConnection(settings);
      setLLMStatus(payload.message);
      if (payload.models.length) {
        setAvailableModels(payload.models);
        if (!settings.model.trim()) {
          setSettings((current) => ({ ...current, model: payload.models[0] }));
        }
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to test the LLM connection."
      );
    } finally {
      setIsTestingLLM(false);
    }
  }

  async function handleLoadModels() {
    setError("");
    setMessage("");
    setLLMStatus("");
    setIsLoadingModels(true);

    try {
      const payload = await listModels(settings);
      setAvailableModels(payload.models);
      setLLMStatus(
        payload.models.length
          ? `${payload.models.length} model(s) detected.`
          : "Connection succeeded but no models were returned."
      );
      if (payload.models.length && !settings.model.trim()) {
        setSettings((current) => ({ ...current, model: payload.models[0] }));
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load models."
      );
    } finally {
      setIsLoadingModels(false);
    }
  }

  async function handlePreview() {
    setError("");
    setMessage("");
    setGeneration(null);
    setIsPreviewing(true);

    try {
      const payload = await previewProject(spec);
      setPreview(payload);
      setCurrentStep(4);
      setMessage(
        payload.llm_used
          ? "Blueprint generated with the local LLM."
          : "Blueprint generated with the internal fallback."
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to generate the blueprint."
      );
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleGenerate() {
    setError("");
    setMessage("");
    setIsGenerating(true);

    try {
      const payload = await generateProject(spec);
      setGeneration(payload);
      setPreview(payload);
      setCurrentStep(4);
      setMessage(`Project generated in ${payload.output_path}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to generate the project."
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />
      <header className="hero">
        <div className="hero-copyblock">
          <p className="eyebrow">MCP Creator</p>
          <h1>Design precise FastMCP servers with a cleaner guided flow.</h1>
          <p className="hero-copy">
            Define the scope, enrich the blueprint with your local LLM, and generate a reusable
            Python MCP project in `generated/`.
          </p>
        </div>
        <div className="hero-panel minimal-panel">
          <div className="hero-metric">
            <strong>5</strong>
            <span>guided steps</span>
          </div>
          <div className="hero-metric">
            <strong>2</strong>
            <span>database presets</span>
          </div>
          <div className="hero-metric">
            <strong>1</strong>
            <span>reusable template flow</span>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="steps-panel card">
          <p className="panel-label">Workflow</p>
          <div className="step-list">
            {steps.map((step, index) => (
              <button
                key={step}
                className={`step-item ${index === currentStep ? "active" : ""}`}
                onClick={() => setCurrentStep(index)}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step}</strong>
              </button>
            ))}
          </div>

          <div className="status-block">
            <p className="panel-label">Readiness</p>
            <div className={`status-pill ${readiness.hasLLMConfig ? "ready" : ""}`}>
              LLM endpoint {readiness.hasLLMConfig ? "configured" : "missing"}
            </div>
            <div className={`status-pill ${readiness.hasSelectedModel ? "ready" : ""}`}>
              Model {readiness.hasSelectedModel ? "selected" : "missing"}
            </div>
            <div className={`status-pill ${readiness.hasProjectCore ? "ready" : ""}`}>
              Project {readiness.hasProjectCore ? "scoped" : "incomplete"}
            </div>
            <div className={`status-pill ${readiness.hasTooling ? "ready" : ""}`}>
              Capabilities {readiness.hasTooling ? "described" : "missing"}
            </div>
          </div>

          <div className="hint-box compact-box">
            <strong>Windows quick start</strong>
            <code>npm install</code>
            <code>npm run setup:python</code>
            <code>npm run dev</code>
          </div>
        </aside>

        <section className="content-column">
          {currentStep === 0 && (
            <form className="card stack" onSubmit={handleSaveSettings}>
              <div className="section-head">
                <div>
                  <p className="panel-label">Step 1</p>
                  <h2>Local LLM connection</h2>
                </div>
                <p className="muted">
                  Enter an OpenAI-compatible endpoint, then test the connection and load the
                  models exposed by your local server.
                </p>
              </div>

              <div className="grid two">
                <label>
                  <span>Base URL</span>
                  <input
                    value={settings.baseUrl}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, baseUrl: event.target.value }))
                    }
                    placeholder="http://127.0.0.1:1234/v1"
                  />
                </label>
                <label>
                  <span>API key</span>
                  <input
                    value={settings.apiKey}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, apiKey: event.target.value }))
                    }
                    placeholder="leave blank if your server does not require one"
                  />
                </label>
                <label>
                  <span>Selected model</span>
                  <input
                    value={settings.model}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, model: event.target.value }))
                    }
                    placeholder="qwen2.5-coder-32b-instruct"
                  />
                </label>
                <label>
                  <span>Temperature</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={settings.temperature}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        temperature: Number(event.target.value)
                      }))
                    }
                  />
                </label>
              </div>

              <div className="actions">
                <button className="secondary" type="button" onClick={handleTestLLM} disabled={isTestingLLM}>
                  {isTestingLLM ? "Testing..." : "Test connection"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={handleLoadModels}
                  disabled={isLoadingModels}
                >
                  {isLoadingModels ? "Loading..." : "Load models"}
                </button>
                <button className="primary" type="submit" disabled={isSavingSettings}>
                  {isSavingSettings ? "Saving..." : "Save settings"}
                </button>
                <button className="secondary" type="button" onClick={() => setCurrentStep(1)}>
                  Continue
                </button>
              </div>

              {(llmStatus || availableModels.length > 0) && (
                <div className="subcard stack">
                  <div className="subcard-head">
                    <h3>Connection status</h3>
                    {llmStatus ? <span className="status-pill ready">{llmStatus}</span> : null}
                  </div>

                  {availableModels.length > 0 ? (
                    <div className="model-list">
                      {availableModels.map((model) => (
                        <button
                          key={model}
                          className={`model-chip ${settings.model === model ? "selected" : ""}`}
                          type="button"
                          onClick={() =>
                            setSettings((current) => ({
                              ...current,
                              model
                            }))
                          }
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No models listed yet.</p>
                  )}
                </div>
              )}

              <div className="hint-box">
                <strong>Note</strong>
                <p>
                  Some local servers do not implement `/models`. The test first tries model
                  discovery, then can fall back to a minimal chat request if a model is already set.
                </p>
              </div>
            </form>
          )}

          {currentStep === 1 && (
            <section className="card stack">
              <div className="section-head">
                <div>
                  <p className="panel-label">Step 2</p>
                  <h2>MCP scope and integrations</h2>
                </div>
                <p className="muted">
                  This step gives the LLM the functional scope of the MCP and the data engines that
                  should be prepared in the scaffold.
                </p>
              </div>

              <div className="subcard stack">
                <div className="subcard-head">
                  <div>
                    <h3>Reusable templates</h3>
                    <p className="muted">
                      Save a full project setup and reuse it later for new MCPs.
                    </p>
                  </div>
                  <button className="ghost" type="button" onClick={resetTemplateEditor}>
                    New template
                  </button>
                </div>

                <div className="grid two">
                  <label>
                    <span>Template name</span>
                    <input
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="Oracle analyst base"
                    />
                  </label>
                  <label>
                    <span>Description</span>
                    <input
                      value={templateDescription}
                      onChange={(event) => setTemplateDescription(event.target.value)}
                      placeholder="Starting template for Oracle-oriented MCPs"
                    />
                  </label>
                </div>

                <div className="actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={handleCreateTemplate}
                    disabled={isSavingTemplate}
                  >
                    {isSavingTemplate ? "Saving..." : "Save as template"}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={handleUpdateTemplate}
                    disabled={!selectedTemplateId || isSavingTemplate}
                  >
                    Update selected template
                  </button>
                </div>

                {templates.length > 0 ? (
                  <div className="template-list">
                    {templates.map((template) => (
                      <article
                        key={template.id}
                        className={`template-card ${
                          selectedTemplateId === template.id ? "selected" : ""
                        }`}
                      >
                        <div className="template-card-head">
                          <div>
                            <strong>{template.name}</strong>
                            <p>{template.description || "No description"}</p>
                          </div>
                          <span>{new Date(template.updatedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="template-meta">
                          <span>{template.spec.tools.length} tools</span>
                          <span>{template.spec.databaseIntegrations.length} DB</span>
                          <span>{template.spec.prompts.length} prompts</span>
                        </div>
                        <div className="actions">
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => applyTemplate(template)}
                          >
                            Apply
                          </button>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => handleDeleteTemplate(template.id)}
                            disabled={isDeletingTemplate}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No templates saved yet.</div>
                )}
              </div>

              <div className="grid two">
                <label>
                  <span>MCP name</span>
                  <input
                    value={spec.name}
                    onChange={(event) =>
                      setSpec((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Revenue Ops Assistant"
                  />
                </label>
                <label>
                  <span>Target audience</span>
                  <input
                    value={spec.audience}
                    onChange={(event) =>
                      setSpec((current) => ({ ...current, audience: event.target.value }))
                    }
                    placeholder="Operations, analysts, support"
                  />
                </label>
                <label>
                  <span>Target transport</span>
                  <select
                    value={spec.transport}
                    onChange={(event) =>
                      setSpec((current) => ({ ...current, transport: event.target.value }))
                    }
                  >
                    <option value="stdio">stdio</option>
                    <option value="streamable-http">streamable-http</option>
                  </select>
                </label>
                <label>
                  <span>Primary goal</span>
                  <input
                    value={spec.primaryGoal}
                    onChange={(event) =>
                      setSpec((current) => ({ ...current, primaryGoal: event.target.value }))
                    }
                    placeholder="Access CRM data and guide commercial diagnostics"
                  />
                </label>
              </div>

              <label>
                <span>Project description</span>
                <textarea
                  value={spec.description}
                  onChange={(event) =>
                    setSpec((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={5}
                  placeholder="Explain the MCP role clearly, the systems it should cover, and the expected value."
                />
              </label>

              <label>
                <span>Business / domain context</span>
                <textarea
                  value={spec.domainContext}
                  onChange={(event) =>
                    setSpec((current) => ({ ...current, domainContext: event.target.value }))
                  }
                  rows={5}
                  placeholder="Summarize the entities, constraints, naming rules, and domain specifics."
                />
              </label>

              <label>
                <span>Expected LLM role in prompts</span>
                <textarea
                  value={spec.llmRole}
                  onChange={(event) =>
                    setSpec((current) => ({ ...current, llmRole: event.target.value }))
                  }
                  rows={4}
                  placeholder="Example: act like a reliable analytical copilot, cautious, action-oriented, and transparent about uncertainty."
                />
              </label>

              <div className="stack">
                <div className="subcard-head">
                  <h3>Database integrations</h3>
                  <div className="actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => addDatabaseIntegration("clickhouse")}
                    >
                      Add ClickHouse
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => addDatabaseIntegration("oracle")}
                    >
                      Add Oracle
                    </button>
                  </div>
                </div>

                {spec.databaseIntegrations.length === 0 && (
                  <div className="empty-state">
                    Add ClickHouse and/or Oracle when generated MCPs should include connection
                    helpers, ping tools, schema tools, or query tools.
                  </div>
                )}

                {spec.databaseIntegrations.map((integration) => (
                  <article className="subcard stack" key={integration.id}>
                    <div className="subcard-head">
                      <h4>{integration.kind === "clickhouse" ? "ClickHouse" : "Oracle Database"}</h4>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() =>
                          setSpec((current) => ({
                            ...current,
                            databaseIntegrations: current.databaseIntegrations.filter(
                              (item) => item.id !== integration.id
                            )
                          }))
                        }
                      >
                        Delete
                      </button>
                    </div>

                    <div className="grid two">
                      <label>
                        <span>Display name</span>
                        <input
                          value={integration.name}
                          onChange={(event) =>
                            updateDatabaseIntegration(integration.id, { name: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>Intended usage</span>
                        <input
                          value={integration.purpose}
                          onChange={(event) =>
                            updateDatabaseIntegration(integration.id, { purpose: event.target.value })
                          }
                        />
                      </label>
                    </div>

                    <label>
                      <span>Generation notes</span>
                      <textarea
                        value={integration.notes}
                        onChange={(event) =>
                          updateDatabaseIntegration(integration.id, { notes: event.target.value })
                        }
                        rows={3}
                        placeholder="Target schemas, read restrictions, critical tables, SQL conventions..."
                      />
                    </label>

                    <div className="grid three compact">
                      <label className="checkbox-field">
                        <span>Read only</span>
                        <input
                          type="checkbox"
                          checked={integration.readOnly}
                          onChange={(event) =>
                            updateDatabaseIntegration(integration.id, {
                              readOnly: event.target.checked
                            })
                          }
                        />
                      </label>
                      <label className="checkbox-field">
                        <span>Schema tool</span>
                        <input
                          type="checkbox"
                          checked={integration.includeSchemaTool}
                          onChange={(event) =>
                            updateDatabaseIntegration(integration.id, {
                              includeSchemaTool: event.target.checked
                            })
                          }
                        />
                      </label>
                      <label className="checkbox-field">
                        <span>Query tool</span>
                        <input
                          type="checkbox"
                          checked={integration.includeQueryTool}
                          onChange={(event) =>
                            updateDatabaseIntegration(integration.id, {
                              includeQueryTool: event.target.checked
                            })
                          }
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>

              <label>
                <span>Guardrails and constraints</span>
                <textarea
                  value={joinLines(spec.safetyGuardrails)}
                  onChange={(event) =>
                    setSpec((current) => ({
                      ...current,
                      safetyGuardrails: splitLines(event.target.value)
                    }))
                  }
                  rows={5}
                />
              </label>

              <label>
                <span>External dependencies to include</span>
                <textarea
                  value={joinLines(spec.externalDependencies)}
                  onChange={(event) =>
                    setSpec((current) => ({
                      ...current,
                      externalDependencies: splitLines(event.target.value)
                    }))
                  }
                  rows={4}
                  placeholder="One dependency per line, for example requests, pandas, psycopg"
                />
              </label>

              <label>
                <span>Important test scenarios</span>
                <textarea
                  value={joinLines(spec.testScenarios)}
                  onChange={(event) =>
                    setSpec((current) => ({
                      ...current,
                      testScenarios: splitLines(event.target.value)
                    }))
                  }
                  rows={4}
                />
              </label>

              <div className="actions">
                <button className="secondary" type="button" onClick={() => setCurrentStep(0)}>
                  Back
                </button>
                <button className="primary" type="button" onClick={() => setCurrentStep(2)}>
                  Continue to tools
                </button>
              </div>
            </section>
          )}

          {currentStep === 2 && (
            <section className="card stack">
              <div className="section-head">
                <div>
                  <p className="panel-label">Step 3</p>
                  <h2>Tool definition</h2>
                </div>
                <p className="muted">
                  The more precise your tools are, the more useful and actionable the `FastMCP`
                  blueprint becomes.
                </p>
              </div>

              {spec.tools.map((tool, toolIndex) => (
                <article className="subcard stack" key={tool.id}>
                  <div className="subcard-head">
                    <h3>Tool {toolIndex + 1}</h3>
                    {spec.tools.length > 1 && (
                      <button
                        className="ghost"
                        type="button"
                        onClick={() =>
                          setSpec((current) => ({
                            ...current,
                            tools: current.tools.filter((item) => item.id !== tool.id)
                          }))
                        }
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  <div className="grid two">
                    <label>
                      <span>Tool name</span>
                      <input
                        value={tool.name}
                        onChange={(event) => updateTool(tool.id, { name: event.target.value })}
                        placeholder="find_customer_risk"
                      />
                    </label>
                    <label>
                      <span>Expected output</span>
                      <input
                        value={tool.outputDescription}
                        onChange={(event) =>
                          updateTool(tool.id, { outputDescription: event.target.value })
                        }
                        placeholder="Structured summary, score, recommendations"
                      />
                    </label>
                  </div>

                  <label>
                    <span>Tool purpose</span>
                    <textarea
                      value={tool.purpose}
                      onChange={(event) => updateTool(tool.id, { purpose: event.target.value })}
                      rows={4}
                    />
                  </label>

                  <label>
                    <span>Expected implementation logic</span>
                    <textarea
                      value={tool.implementationNotes}
                      onChange={(event) =>
                        updateTool(tool.id, { implementationNotes: event.target.value })
                      }
                      rows={4}
                      placeholder="Detail the steps, external calls, validations, and edge cases."
                    />
                  </label>

                  <div className="grid two">
                    <label>
                      <span>Safety / guardrails</span>
                      <textarea
                        value={tool.safetyNotes}
                        onChange={(event) =>
                          updateTool(tool.id, { safetyNotes: event.target.value })
                        }
                        rows={4}
                      />
                    </label>
                    <label>
                      <span>Example usage</span>
                      <textarea
                        value={tool.exampleUse}
                        onChange={(event) =>
                          updateTool(tool.id, { exampleUse: event.target.value })
                        }
                        rows={4}
                      />
                    </label>
                  </div>

                  <div className="stack">
                    <div className="subcard-head">
                      <h4>Tool inputs</h4>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() =>
                          updateTool(tool.id, { inputs: [...tool.inputs, createToolInput()] })
                        }
                      >
                        Add input
                      </button>
                    </div>

                    {tool.inputs.map((input) => (
                      <div className="grid four compact" key={input.id}>
                        <label>
                          <span>Nom</span>
                          <input
                            value={input.name}
                            onChange={(event) =>
                              updateToolInput(tool.id, input.id, { name: event.target.value })
                            }
                            placeholder="customer_id"
                          />
                        </label>
                        <label>
                          <span>Type</span>
                          <select
                            value={input.type}
                            onChange={(event) =>
                              updateToolInput(tool.id, input.id, { type: event.target.value })
                            }
                          >
                            <option value="string">string</option>
                            <option value="integer">integer</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="object">object</option>
                            <option value="array">array</option>
                          </select>
                        </label>
                        <label>
                          <span>Description</span>
                          <input
                            value={input.description}
                            onChange={(event) =>
                              updateToolInput(tool.id, input.id, { description: event.target.value })
                            }
                            placeholder="Internal CRM identifier"
                          />
                        </label>
                        <label className="checkbox-field">
                          <span>Required</span>
                          <input
                            checked={input.required}
                            onChange={(event) =>
                              updateToolInput(tool.id, input.id, { required: event.target.checked })
                            }
                            type="checkbox"
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </article>
              ))}

              <div className="actions spread">
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    setSpec((current) => ({ ...current, tools: [...current.tools, createTool()] }))
                  }
                >
                  Add tool
                </button>
                <div className="actions">
                  <button className="secondary" type="button" onClick={() => setCurrentStep(1)}>
                    Back
                  </button>
                  <button className="primary" type="button" onClick={() => setCurrentStep(3)}>
                    Continue
                  </button>
                </div>
              </div>
            </section>
          )}

          {currentStep === 3 && (
            <section className="card stack">
              <div className="section-head">
                <div>
                  <p className="panel-label">Step 4</p>
                  <h2>Resources and prompts</h2>
                </div>
                <p className="muted">
                  Resources provide readable context. Prompts help frame common client-side usage.
                </p>
              </div>

              <div className="split-grid">
                <div className="stack">
                  <div className="subcard-head">
                    <h3>Resources</h3>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() =>
                        setSpec((current) => ({
                          ...current,
                          resources: [...current.resources, createResource()]
                        }))
                      }
                    >
                      Add
                    </button>
                  </div>
                  {spec.resources.length === 0 && (
                    <div className="empty-state">Add a resource if your MCP should expose readable data.</div>
                  )}
                  {spec.resources.map((resource) => (
                    <article className="subcard stack" key={resource.id}>
                      <div className="subcard-head">
                        <h4>{resource.name || "New resource"}</h4>
                        <button
                          className="ghost"
                          type="button"
                          onClick={() =>
                            setSpec((current) => ({
                              ...current,
                              resources: current.resources.filter((item) => item.id !== resource.id)
                            }))
                          }
                        >
                          Delete
                        </button>
                      </div>
                      <label>
                        <span>Name</span>
                        <input
                          value={resource.name}
                          onChange={(event) =>
                            updateResource(resource.id, { name: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>URI</span>
                        <input
                          value={resource.uri}
                          onChange={(event) =>
                            updateResource(resource.id, { uri: event.target.value })
                          }
                          placeholder="crm://playbook"
                        />
                      </label>
                      <label>
                        <span>Description</span>
                        <textarea
                          value={resource.description}
                          onChange={(event) =>
                            updateResource(resource.id, { description: event.target.value })
                          }
                          rows={3}
                        />
                      </label>
                      <label>
                        <span>Expected content</span>
                        <textarea
                          value={resource.contentOutline}
                          onChange={(event) =>
                            updateResource(resource.id, { contentOutline: event.target.value })
                          }
                          rows={3}
                        />
                      </label>
                    </article>
                  ))}
                </div>

                <div className="stack">
                  <div className="subcard-head">
                    <h3>Prompts</h3>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() =>
                        setSpec((current) => ({
                          ...current,
                          prompts: [...current.prompts, createPrompt()]
                        }))
                      }
                    >
                      Add
                    </button>
                  </div>
                  {spec.prompts.length === 0 && (
                    <div className="empty-state">
                      Add a prompt if you want to guide common client-side workflows.
                    </div>
                  )}
                  {spec.prompts.map((prompt) => (
                    <article className="subcard stack" key={prompt.id}>
                      <div className="subcard-head">
                        <h4>{prompt.name || "New prompt"}</h4>
                        <button
                          className="ghost"
                          type="button"
                          onClick={() =>
                            setSpec((current) => ({
                              ...current,
                              prompts: current.prompts.filter((item) => item.id !== prompt.id)
                            }))
                          }
                        >
                          Delete
                        </button>
                      </div>
                      <label>
                        <span>Name</span>
                        <input
                          value={prompt.name}
                          onChange={(event) => updatePrompt(prompt.id, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Description</span>
                        <textarea
                          value={prompt.description}
                          onChange={(event) =>
                            updatePrompt(prompt.id, { description: event.target.value })
                          }
                          rows={3}
                        />
                      </label>
                      <label>
                        <span>Goal</span>
                        <textarea
                          value={prompt.goal}
                          onChange={(event) => updatePrompt(prompt.id, { goal: event.target.value })}
                          rows={3}
                        />
                      </label>

                      <div className="stack">
                        <div className="subcard-head">
                          <h4>Arguments</h4>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() =>
                              updatePrompt(prompt.id, {
                                arguments: [...prompt.arguments, createPromptArgument()]
                              })
                            }
                          >
                            Add
                          </button>
                        </div>

                        {prompt.arguments.map((argument) => (
                          <div className="grid three compact" key={argument.id}>
                            <label>
                              <span>Name</span>
                              <input
                                value={argument.name}
                                onChange={(event) =>
                                  updatePromptArgument(prompt.id, argument.id, {
                                    name: event.target.value
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>Description</span>
                              <input
                                value={argument.description}
                                onChange={(event) =>
                                  updatePromptArgument(prompt.id, argument.id, {
                                    description: event.target.value
                                  })
                                }
                              />
                            </label>
                            <label className="checkbox-field">
                              <span>Required</span>
                              <input
                                checked={argument.required}
                                onChange={(event) =>
                                  updatePromptArgument(prompt.id, argument.id, {
                                    required: event.target.checked
                                  })
                                }
                                type="checkbox"
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="actions">
                <button className="secondary" type="button" onClick={() => setCurrentStep(2)}>
                  Back
                </button>
                <button className="primary" type="button" onClick={() => setCurrentStep(4)}>
                  Go to preview
                </button>
              </div>
            </section>
          )}

          {currentStep === 4 && (
            <section className="card stack">
              <div className="section-head">
                <div>
                  <p className="panel-label">Step 5</p>
                  <h2>Preview and generation</h2>
                </div>
                <p className="muted">
                  Review the setup, generate a blueprint, then create the `FastMCP` project.
                </p>
              </div>

              <div className="summary-grid">
                <div className="summary-card">
                  <p className="panel-label">Summary</p>
                  <h3>{spec.name || "Project name is still missing"}</h3>
                  <p>{spec.description || "Add a description to guide the generation."}</p>
                  <ul>
                    <li>{spec.tools.filter((tool) => tool.name.trim()).length} business tools</li>
                    <li>{spec.databaseIntegrations.length} DB integration(s)</li>
                    <li>{spec.resources.length} resources</li>
                    <li>{spec.prompts.length} prompts</li>
                  </ul>
                </div>
                <div className="summary-card accent">
                  <p className="panel-label">Generation mode</p>
                  <h3>{readiness.hasSelectedModel ? "Local LLM + fallback" : "Fallback only"}</h3>
                  <p>
                    When the LLM is configured, the app requests a strict JSON structure and then
                    hardens the result before writing files.
                  </p>
                </div>
              </div>

              {spec.databaseIntegrations.length > 0 && (
                <div className="subcard stack">
                  <h4>Prepared integrations</h4>
                  {spec.databaseIntegrations.map((integration) => (
                    <div key={integration.id} className="integration-row">
                      <strong>{integration.name}</strong>
                      <span>{integration.kind}</span>
                      <p>{integration.purpose}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="actions">
                <button className="secondary" type="button" onClick={() => setCurrentStep(3)}>
                  Back
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={handlePreview}
                  disabled={!readiness.hasProjectCore || !readiness.hasTooling || isPreviewing}
                >
                  {isPreviewing ? "Generating blueprint..." : "Generate blueprint"}
                </button>
                <button
                  className="primary"
                  type="button"
                  onClick={handleGenerate}
                  disabled={!readiness.hasProjectCore || !readiness.hasTooling || isGenerating}
                >
                  {isGenerating ? "Generating project..." : "Generate MCP"}
                </button>
              </div>

              {(preview || generation) && (
                <div className="preview-panel">
                  <div className="preview-head">
                    <div>
                      <p className="panel-label">Blueprint</p>
                      <h3>{preview?.blueprint.server_name}</h3>
                    </div>
                    <span className="status-pill ready">
                      mode {preview?.blueprint.generation_mode}
                    </span>
                  </div>

                  {preview?.warnings.length ? (
                    <div className="warning-box">
                      {preview.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}

                  <div className="split-grid">
                    <div className="subcard stack">
                      <h4>Architecture</h4>
                      <ul>
                        {preview?.blueprint.architecture_notes.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="subcard stack">
                      <h4>Validation</h4>
                      <ul>
                        {preview?.blueprint.validation_checks.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {preview?.blueprint.database_integrations.length ? (
                    <div className="subcard stack">
                      <h4>Generated DB integrations</h4>
                      {preview.blueprint.database_integrations.map((integration) => (
                        <div key={integration.python_name} className="tool-preview">
                          <strong>{integration.name}</strong>
                          <p>{integration.purpose}</p>
                          <ul>
                            {integration.setup_notes.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="subcard stack">
                    <h4>Generated tools</h4>
                    {preview?.blueprint.tools.length ? (
                      preview.blueprint.tools.map((tool) => (
                        <div key={tool.python_name} className="tool-preview">
                          <strong>{tool.name}</strong>
                          <p>{tool.purpose}</p>
                          <ul>
                            {tool.workflow_steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ul>
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        No explicit business tools were provided. The selected DB integrations can
                        still generate helpers and baseline tools.
                      </p>
                    )}
                  </div>

                  {generation && (
                    <div className="subcard stack success-box">
                      <h4>Generated project</h4>
                      <p>{generation.output_path}</p>
                      <ul>
                        {generation.files.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {(message || error) && (
            <div className={`feedback ${error ? "error" : "success"}`}>
              {error || message}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
