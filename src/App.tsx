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
  "Configuration LLM",
  "Cadrage & integrations",
  "Tools",
  "Ressources & prompts",
  "Preview & generation"
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
        ? "Exposer des requetes analytiques en lecture seule."
        : "Exposer des lectures Oracle en lecture seule.",
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
    "Valider et normaliser les entrees avant toute action externe.",
    "Retourner des reponses structurees et explicites en cas d'erreur."
  ],
  externalDependencies: [],
  testScenarios: [
    "Appel nominal d'un tool avec des parametres valides.",
    "Refus propre quand une entree obligatoire est absente."
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
    setMessage(`Template "${template.name}" applique.`);
    setError("");
  }

  function resetTemplateEditor() {
    setSelectedTemplateId("");
    setTemplateName("");
    setTemplateDescription("");
  }

  async function handleCreateTemplate() {
    if (!templateName.trim()) {
      setError("Renseigne un nom de template.");
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
      setMessage(`Template "${created.name}" enregistre.`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible d'enregistrer le template."
      );
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function handleUpdateTemplate() {
    if (!selectedTemplateId) {
      setError("Selectionne d'abord un template a mettre a jour.");
      setMessage("");
      return;
    }

    if (!templateName.trim()) {
      setError("Renseigne un nom de template.");
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
      setMessage(`Template "${updated.name}" mis a jour.`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de mettre a jour le template."
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
      setMessage("Template supprime.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de supprimer le template."
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
      setMessage("Configuration LLM enregistree.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible d'enregistrer les settings."
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
          : "Impossible de tester la connexion LLM."
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
          ? `${payload.models.length} modele(s) detecte(s).`
          : "Connexion reussie mais aucun modele n'a ete retourne."
      );
      if (payload.models.length && !settings.model.trim()) {
        setSettings((current) => ({ ...current, model: payload.models[0] }));
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de recuperer les modeles."
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
          ? "Blueprint genere avec le LLM local."
          : "Blueprint genere via le fallback interne."
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de generer le blueprint."
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
      setMessage(`Projet genere dans ${payload.output_path}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de generer le projet."
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
        <div>
          <p className="eyebrow">MCP Creator</p>
          <h1>Concois des serveurs FastMCP precis, guides et prets a etre affines.</h1>
          <p className="hero-copy">
            L&apos;app structure ton besoin, enrichit le blueprint avec ton LLM local puis
            genere un projet Python `FastMCP` dans `generated/`.
          </p>
        </div>
        <div className="hero-panel">
          <p>Checklist rapide</p>
          <ul>
            <li>setup Python automatise via `npm run setup:python`</li>
            <li>support Windows avec detection de `py -3` et `.venv\\Scripts\\python.exe`</li>
            <li>test de connexion LLM + chargement de la liste des modeles</li>
            <li>templates ClickHouse et Oracle pour les MCPs generes</li>
          </ul>
        </div>
      </header>

      <main className="workspace">
        <aside className="steps-panel card">
          <p className="panel-label">Parcours guide</p>
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
            <p className="panel-label">Etat du cadrage</p>
            <div className={`status-pill ${readiness.hasLLMConfig ? "ready" : ""}`}>
              Endpoint LLM {readiness.hasLLMConfig ? "configure" : "a configurer"}
            </div>
            <div className={`status-pill ${readiness.hasSelectedModel ? "ready" : ""}`}>
              Modele {readiness.hasSelectedModel ? "selectionne" : "a choisir"}
            </div>
            <div className={`status-pill ${readiness.hasProjectCore ? "ready" : ""}`}>
              Projet {readiness.hasProjectCore ? "cadre" : "a completer"}
            </div>
            <div className={`status-pill ${readiness.hasTooling ? "ready" : ""}`}>
              Capacites {readiness.hasTooling ? "decrites" : "a definir"}
            </div>
          </div>

          <div className="hint-box compact-box">
            <strong>Install Windows</strong>
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
                  <p className="panel-label">Etape 1</p>
                  <h2>Connexion au LLM local</h2>
                </div>
                <p className="muted">
                  Saisis un endpoint compatible OpenAI, puis teste la connexion et charge les
                  modeles exposes par ton serveur local.
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
                    placeholder="laisser vide si ton serveur n'en demande pas"
                  />
                </label>
                <label>
                  <span>Modele selectionne</span>
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
                  {isTestingLLM ? "Test en cours..." : "Tester la connexion"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={handleLoadModels}
                  disabled={isLoadingModels}
                >
                  {isLoadingModels ? "Chargement..." : "Charger les modeles"}
                </button>
                <button className="primary" type="submit" disabled={isSavingSettings}>
                  {isSavingSettings ? "Enregistrement..." : "Enregistrer la configuration"}
                </button>
                <button className="secondary" type="button" onClick={() => setCurrentStep(1)}>
                  Continuer
                </button>
              </div>

              {(llmStatus || availableModels.length > 0) && (
                <div className="subcard stack">
                  <div className="subcard-head">
                    <h3>Etat de la connexion</h3>
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
                    <p className="muted">Aucun modele liste pour le moment.</p>
                  )}
                </div>
              )}

              <div className="hint-box">
                <strong>Conseil</strong>
                <p>
                  Sur certains serveurs locaux, `/models` n&apos;est pas implemente. Le test tente
                  d&apos;abord la liste des modeles, puis peut basculer vers un test de chat minimal si
                  un modele est deja renseigne.
                </p>
              </div>
            </form>
          )}

          {currentStep === 1 && (
            <section className="card stack">
              <div className="section-head">
                <div>
                  <p className="panel-label">Etape 2</p>
                  <h2>Cadrage du MCP et integrations</h2>
                </div>
                <p className="muted">
                  Cette etape guide le LLM sur le perimetre fonctionnel du MCP et les moteurs de
                  donnees a preparer dans le scaffold.
                </p>
              </div>

              <div className="subcard stack">
                <div className="subcard-head">
                  <div>
                    <h3>Templates reutilisables</h3>
                    <p className="muted">
                      Sauvegarde un cadrage complet pour le recharger plus tard sur de nouveaux MCPs.
                    </p>
                  </div>
                  <button className="ghost" type="button" onClick={resetTemplateEditor}>
                    Nouveau template
                  </button>
                </div>

                <div className="grid two">
                  <label>
                    <span>Nom du template</span>
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
                      placeholder="Template de depart pour les MCPs orientes Oracle"
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
                    {isSavingTemplate ? "Enregistrement..." : "Enregistrer comme template"}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={handleUpdateTemplate}
                    disabled={!selectedTemplateId || isSavingTemplate}
                  >
                    Mettre a jour le template selectionne
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
                            <p>{template.description || "Sans description"}</p>
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
                            Appliquer
                          </button>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => handleDeleteTemplate(template.id)}
                            disabled={isDeletingTemplate}
                          >
                            Supprimer
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    Aucun template enregistre pour le moment.
                  </div>
                )}
              </div>

              <div className="grid two">
                <label>
                  <span>Nom du MCP</span>
                  <input
                    value={spec.name}
                    onChange={(event) =>
                      setSpec((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Revenue Ops Assistant"
                  />
                </label>
                <label>
                  <span>Audience cible</span>
                  <input
                    value={spec.audience}
                    onChange={(event) =>
                      setSpec((current) => ({ ...current, audience: event.target.value }))
                    }
                    placeholder="Equipe operations, analysts, support"
                  />
                </label>
                <label>
                  <span>Transport cible</span>
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
                  <span>Objectif principal</span>
                  <input
                    value={spec.primaryGoal}
                    onChange={(event) =>
                      setSpec((current) => ({ ...current, primaryGoal: event.target.value }))
                    }
                    placeholder="Acceder a la data CRM et guider les diagnostics commerciaux"
                  />
                </label>
              </div>

              <label>
                <span>Description du projet</span>
                <textarea
                  value={spec.description}
                  onChange={(event) =>
                    setSpec((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={5}
                  placeholder="Explique clairement le role du MCP, les systemes qu'il doit couvrir et la valeur attendue."
                />
              </label>

              <label>
                <span>Contexte metier / domaine</span>
                <textarea
                  value={spec.domainContext}
                  onChange={(event) =>
                    setSpec((current) => ({ ...current, domainContext: event.target.value }))
                  }
                  rows={5}
                  placeholder="Rappelle les entites, contraintes, nomenclatures et particularites du domaine."
                />
              </label>

              <label>
                <span>Role attendu pour le LLM dans les prompts</span>
                <textarea
                  value={spec.llmRole}
                  onChange={(event) =>
                    setSpec((current) => ({ ...current, llmRole: event.target.value }))
                  }
                  rows={4}
                  placeholder="Ex: agir comme un copilote d'analyse fiable, prudent, oriente actions et transparent sur ses limites."
                />
              </label>

              <div className="stack">
                <div className="subcard-head">
                  <h3>Integrations base de donnees</h3>
                  <div className="actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => addDatabaseIntegration("clickhouse")}
                    >
                      Ajouter ClickHouse
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => addDatabaseIntegration("oracle")}
                    >
                      Ajouter Oracle
                    </button>
                  </div>
                </div>

                {spec.databaseIntegrations.length === 0 && (
                  <div className="empty-state">
                    Ajoute ClickHouse et/ou Oracle si les MCPs generes doivent embarquer des
                    helpers de connexion, des tools de ping, de schema ou de requetes.
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
                        Supprimer
                      </button>
                    </div>

                    <div className="grid two">
                      <label>
                        <span>Nom affiche</span>
                        <input
                          value={integration.name}
                          onChange={(event) =>
                            updateDatabaseIntegration(integration.id, { name: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>Usage attendu</span>
                        <input
                          value={integration.purpose}
                          onChange={(event) =>
                            updateDatabaseIntegration(integration.id, { purpose: event.target.value })
                          }
                        />
                      </label>
                    </div>

                    <label>
                      <span>Notes de generation</span>
                      <textarea
                        value={integration.notes}
                        onChange={(event) =>
                          updateDatabaseIntegration(integration.id, { notes: event.target.value })
                        }
                        rows={3}
                        placeholder="Schemas a cibler, restrictions de lecture, tables critiques, conventions SQL..."
                      />
                    </label>

                    <div className="grid three compact">
                      <label className="checkbox-field">
                        <span>Lecture seule</span>
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
                        <span>Tool schema</span>
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
                        <span>Tool query</span>
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
                <span>Garde-fous et contraintes</span>
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
                <span>Dependances externes a prevoir</span>
                <textarea
                  value={joinLines(spec.externalDependencies)}
                  onChange={(event) =>
                    setSpec((current) => ({
                      ...current,
                      externalDependencies: splitLines(event.target.value)
                    }))
                  }
                  rows={4}
                  placeholder="Une dependance par ligne, ex: requests, pandas, psycopg"
                />
              </label>

              <label>
                <span>Scenarios de test importants</span>
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
                  Retour
                </button>
                <button className="primary" type="button" onClick={() => setCurrentStep(2)}>
                  Continuer vers les tools
                </button>
              </div>
            </section>
          )}

          {currentStep === 2 && (
            <section className="card stack">
              <div className="section-head">
                <div>
                  <p className="panel-label">Etape 3</p>
                  <h2>Definition des tools</h2>
                </div>
                <p className="muted">
                  Plus tes tools sont precis, plus le blueprint `FastMCP` sera utile et actionnable.
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
                        Supprimer
                      </button>
                    )}
                  </div>

                  <div className="grid two">
                    <label>
                      <span>Nom du tool</span>
                      <input
                        value={tool.name}
                        onChange={(event) => updateTool(tool.id, { name: event.target.value })}
                        placeholder="find_customer_risk"
                      />
                    </label>
                    <label>
                      <span>Sortie attendue</span>
                      <input
                        value={tool.outputDescription}
                        onChange={(event) =>
                          updateTool(tool.id, { outputDescription: event.target.value })
                        }
                        placeholder="Resume structure, score, recommandations"
                      />
                    </label>
                  </div>

                  <label>
                    <span>But du tool</span>
                    <textarea
                      value={tool.purpose}
                      onChange={(event) => updateTool(tool.id, { purpose: event.target.value })}
                      rows={4}
                    />
                  </label>

                  <label>
                    <span>Logique d'implementation attendue</span>
                    <textarea
                      value={tool.implementationNotes}
                      onChange={(event) =>
                        updateTool(tool.id, { implementationNotes: event.target.value })
                      }
                      rows={4}
                      placeholder="Detaille les etapes, appels externes, validations et cas limites."
                    />
                  </label>

                  <div className="grid two">
                    <label>
                      <span>Securite / garde-fous</span>
                      <textarea
                        value={tool.safetyNotes}
                        onChange={(event) =>
                          updateTool(tool.id, { safetyNotes: event.target.value })
                        }
                        rows={4}
                      />
                    </label>
                    <label>
                      <span>Exemple d'usage</span>
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
                      <h4>Entrees du tool</h4>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() =>
                          updateTool(tool.id, { inputs: [...tool.inputs, createToolInput()] })
                        }
                      >
                        Ajouter une entree
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
                            placeholder="Identifiant CRM interne"
                          />
                        </label>
                        <label className="checkbox-field">
                          <span>Obligatoire</span>
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
                  Ajouter un tool
                </button>
                <div className="actions">
                  <button className="secondary" type="button" onClick={() => setCurrentStep(1)}>
                    Retour
                  </button>
                  <button className="primary" type="button" onClick={() => setCurrentStep(3)}>
                    Continuer
                  </button>
                </div>
              </div>
            </section>
          )}

          {currentStep === 3 && (
            <section className="card stack">
              <div className="section-head">
                <div>
                  <p className="panel-label">Etape 4</p>
                  <h2>Ressources et prompts</h2>
                </div>
                <p className="muted">
                  Les ressources donnent du contexte lisible. Les prompts encadrent l'usage cote client.
                </p>
              </div>

              <div className="split-grid">
                <div className="stack">
                  <div className="subcard-head">
                    <h3>Ressources</h3>
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
                      Ajouter
                    </button>
                  </div>
                  {spec.resources.length === 0 && (
                    <div className="empty-state">
                      Ajoute une ressource si ton MCP doit exposer des donnees lisibles.
                    </div>
                  )}
                  {spec.resources.map((resource) => (
                    <article className="subcard stack" key={resource.id}>
                      <div className="subcard-head">
                        <h4>{resource.name || "Nouvelle ressource"}</h4>
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
                          Supprimer
                        </button>
                      </div>
                      <label>
                        <span>Nom</span>
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
                        <span>Contenu attendu</span>
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
                      Ajouter
                    </button>
                  </div>
                  {spec.prompts.length === 0 && (
                    <div className="empty-state">
                      Ajoute un prompt si tu veux cadrer des usages frequents cote client.
                    </div>
                  )}
                  {spec.prompts.map((prompt) => (
                    <article className="subcard stack" key={prompt.id}>
                      <div className="subcard-head">
                        <h4>{prompt.name || "Nouveau prompt"}</h4>
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
                          Supprimer
                        </button>
                      </div>
                      <label>
                        <span>Nom</span>
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
                            Ajouter
                          </button>
                        </div>

                        {prompt.arguments.map((argument) => (
                          <div className="grid three compact" key={argument.id}>
                            <label>
                              <span>Nom</span>
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
                              <span>Obligatoire</span>
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
                  Retour
                </button>
                <button className="primary" type="button" onClick={() => setCurrentStep(4)}>
                  Aller au preview
                </button>
              </div>
            </section>
          )}

          {currentStep === 4 && (
            <section className="card stack">
              <div className="section-head">
                <div>
                  <p className="panel-label">Etape 5</p>
                  <h2>Preview et generation</h2>
                </div>
                <p className="muted">
                  Relis le cadrage, genere un blueprint, puis cree le projet `FastMCP`.
                </p>
              </div>

              <div className="summary-grid">
                <div className="summary-card">
                  <p className="panel-label">Resume</p>
                  <h3>{spec.name || "Nom du projet a definir"}</h3>
                  <p>{spec.description || "Ajoute une description pour guider la generation."}</p>
                  <ul>
                    <li>{spec.tools.filter((tool) => tool.name.trim()).length} tools metier</li>
                    <li>{spec.databaseIntegrations.length} integration(s) DB</li>
                    <li>{spec.resources.length} ressources</li>
                    <li>{spec.prompts.length} prompts</li>
                  </ul>
                </div>
                <div className="summary-card accent">
                  <p className="panel-label">Mode de generation</p>
                  <h3>{readiness.hasSelectedModel ? "LLM local + fallback" : "Fallback uniquement"}</h3>
                  <p>
                    Si le LLM est configure, l&apos;app lui demande une structure JSON stricte puis
                    securise le resultat avant d&apos;ecrire les fichiers.
                  </p>
                </div>
              </div>

              {spec.databaseIntegrations.length > 0 && (
                <div className="subcard stack">
                  <h4>Integrations preparees</h4>
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
                  Retour
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={handlePreview}
                  disabled={!readiness.hasProjectCore || !readiness.hasTooling || isPreviewing}
                >
                  {isPreviewing ? "Generation du blueprint..." : "Generer le blueprint"}
                </button>
                <button
                  className="primary"
                  type="button"
                  onClick={handleGenerate}
                  disabled={!readiness.hasProjectCore || !readiness.hasTooling || isGenerating}
                >
                  {isGenerating ? "Generation du projet..." : "Generer le MCP"}
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
                      <h4>Integrations DB generees</h4>
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
                    <h4>Tools generes</h4>
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
                        Aucun tool metier explicite. Les integrations DB selectionnees pourront
                        tout de meme generer des helpers et tools de base.
                      </p>
                    )}
                  </div>

                  {generation && (
                    <div className="subcard stack success-box">
                      <h4>Projet genere</h4>
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
