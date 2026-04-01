export type ToolInput = {
  id: string;
  name: string;
  type: string;
  description: string;
  required: boolean;
};

export type ToolSpec = {
  id: string;
  name: string;
  purpose: string;
  outputDescription: string;
  implementationNotes: string;
  safetyNotes: string;
  exampleUse: string;
  inputs: ToolInput[];
};

export type ResourceSpec = {
  id: string;
  name: string;
  uri: string;
  description: string;
  contentOutline: string;
};

export type PromptArgument = {
  id: string;
  name: string;
  description: string;
  required: boolean;
};

export type PromptSpec = {
  id: string;
  name: string;
  description: string;
  goal: string;
  arguments: PromptArgument[];
};

export type DatabaseIntegration = {
  id: string;
  kind: "clickhouse" | "oracle";
  name: string;
  purpose: string;
  readOnly: boolean;
  includeSchemaTool: boolean;
  includeQueryTool: boolean;
  notes: string;
};

export type PandasAIIntegration = {
  enabled: boolean;
  name: string;
  purpose: string;
  allowMultipleDatasets: boolean;
  notes: string;
};

export type ProjectSpec = {
  name: string;
  description: string;
  audience: string;
  transport: string;
  primaryGoal: string;
  domainContext: string;
  llmRole: string;
  safetyGuardrails: string[];
  externalDependencies: string[];
  testScenarios: string[];
  pandasAi: PandasAIIntegration | null;
  databaseIntegrations: DatabaseIntegration[];
  tools: ToolSpec[];
  resources: ResourceSpec[];
  prompts: PromptSpec[];
};

export type LLMSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
};

export type LLMModelsResponse = {
  models: string[];
};

export type LLMTestResponse = {
  ok: boolean;
  message: string;
  models: string[];
  selected_model_available: boolean;
};

export type BlueprintTool = {
  name: string;
  purpose: string;
  output_description: string;
  implementation_notes: string;
  safety_notes: string;
  example_use: string;
  workflow_steps: string[];
  python_name: string;
  inputs: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
};

export type BlueprintResource = {
  name: string;
  uri: string;
  description: string;
  content_outline: string;
  sample_payload: string;
};

export type BlueprintPrompt = {
  name: string;
  description: string;
  goal: string;
  body: string;
  python_name: string;
  arguments: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
};

export type BlueprintDatabaseIntegration = {
  kind: "clickhouse" | "oracle";
  name: string;
  purpose: string;
  read_only: boolean;
  include_schema_tool: boolean;
  include_query_tool: boolean;
  notes: string;
  python_name: string;
  env_vars: string[];
  helper_name: string;
  setup_notes: string[];
};

export type BlueprintPandasAIIntegration = {
  enabled: boolean;
  name: string;
  purpose: string;
  allow_multiple_datasets: boolean;
  notes: string;
  python_name: string;
  env_vars: string[];
  helper_name: string;
  setup_notes: string[];
};

export type ProjectBlueprint = {
  server_name: string;
  package_name: string;
  summary: string;
  transport: string;
  architecture_notes: string[];
  dependencies: string[];
  validation_checks: string[];
  readme_highlights: string[];
  generation_mode: string;
  pandas_ai: BlueprintPandasAIIntegration | null;
  database_integrations: BlueprintDatabaseIntegration[];
  tools: BlueprintTool[];
  resources: BlueprintResource[];
  prompts: BlueprintPrompt[];
};

export type PreviewResponse = {
  blueprint: ProjectBlueprint;
  llm_used: boolean;
  warnings: string[];
};

export type GenerateResponse = PreviewResponse & {
  output_path: string;
  files: string[];
};

export type TemplateRecord = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  spec: ProjectSpec;
};
