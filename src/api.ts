import type {
  GenerateResponse,
  LLMSettings,
  LLMModelsResponse,
  LLMTestResponse,
  PreviewResponse,
  ProjectSpec,
  TemplateRecord
} from "./types";

function toSnakeCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelCase(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function convertKeys(input: unknown, keyMapper: (key: string) => string): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => convertKeys(item, keyMapper));
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        keyMapper(key),
        convertKeys(value, keyMapper)
      ])
    );
  }

  return input;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const payload = await response.text();
    let parsedDetail = "";

    try {
      const parsed = JSON.parse(payload) as { detail?: string };
      parsedDetail = parsed.detail || "";
    } catch {
      // Ignore JSON parsing errors and fall back to raw text below.
    }

    throw new Error(parsedDetail || payload || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function loadSettings() {
  return request<{
    base_url: string;
    api_key: string;
    model: string;
    temperature: number;
  }>("/api/settings").then((payload) => ({
    baseUrl: payload.base_url,
    apiKey: payload.api_key,
    model: payload.model,
    temperature: payload.temperature
  }));
}

export function saveSettings(settings: LLMSettings) {
  return request<{
    base_url: string;
    api_key: string;
    model: string;
    temperature: number;
  }>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      base_url: settings.baseUrl,
      api_key: settings.apiKey,
      model: settings.model,
      temperature: settings.temperature
    })
  }).then((payload) => ({
    baseUrl: payload.base_url,
    apiKey: payload.api_key,
    model: payload.model,
    temperature: payload.temperature
  }));
}

export function listModels(settings: LLMSettings) {
  return request<LLMModelsResponse>("/api/llm/models", {
    method: "POST",
    body: JSON.stringify({
      base_url: settings.baseUrl,
      api_key: settings.apiKey,
      model: settings.model,
      temperature: settings.temperature
    })
  });
}

export function testLLMConnection(settings: LLMSettings) {
  return request<LLMTestResponse>("/api/llm/test", {
    method: "POST",
    body: JSON.stringify({
      base_url: settings.baseUrl,
      api_key: settings.apiKey,
      model: settings.model,
      temperature: settings.temperature
    })
  });
}

export function previewProject(spec: ProjectSpec) {
  return request<PreviewResponse>("/api/preview", {
    method: "POST",
    body: JSON.stringify(convertKeys(spec, toSnakeCase))
  });
}

export function generateProject(spec: ProjectSpec) {
  return request<GenerateResponse>("/api/generate", {
    method: "POST",
    body: JSON.stringify(convertKeys(spec, toSnakeCase))
  });
}

function mapTemplate(payload: {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  spec: unknown;
}): TemplateRecord {
  return {
    id: payload.id,
    name: payload.name,
    description: payload.description,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    spec: convertKeys(payload.spec, toCamelCase) as ProjectSpec
  };
}

export function loadTemplates() {
  return request<
    Array<{
      id: string;
      name: string;
      description: string;
      created_at: string;
      updated_at: string;
      spec: unknown;
    }>
  >("/api/templates").then((payload) => payload.map(mapTemplate));
}

export function createTemplate(template: {
  name: string;
  description: string;
  spec: ProjectSpec;
}) {
  return request<{
    id: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
    spec: unknown;
  }>("/api/templates", {
    method: "POST",
    body: JSON.stringify({
      name: template.name,
      description: template.description,
      spec: convertKeys(template.spec, toSnakeCase)
    })
  }).then(mapTemplate);
}

export function updateTemplate(
  templateId: string,
  template: {
    name: string;
    description: string;
    spec: ProjectSpec;
  }
) {
  return request<{
    id: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
    spec: unknown;
  }>(`/api/templates/${templateId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: template.name,
      description: template.description,
      spec: convertKeys(template.spec, toSnakeCase)
    })
  }).then(mapTemplate);
}

export function deleteTemplate(templateId: string) {
  return request<{ status: string }>(`/api/templates/${templateId}`, {
    method: "DELETE"
  });
}
