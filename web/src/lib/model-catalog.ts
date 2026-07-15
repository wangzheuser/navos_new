import type { ModelCapabilities, ModelListItem, ModelModality } from "../types";

export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  input: ["text"],
  output: ["text"],
  tools: false
};

const MODALITIES: ModelModality[] = ["text", "image", "video", "file"];

/** 在 API 边界解析模型目录，只保留前端能够识别的字段。 */
export function normalizeModelList(value: unknown): ModelListItem[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) {
    return [];
  }
  return (value as { data: unknown[] }).data
    .map(normalizeModel)
    .filter((model): model is ModelListItem => model !== undefined);
}

/** 按输出能力筛选模型 ID，并按服务端顺序执行精确去重。 */
export function modelIdsByOutput(models: ModelListItem[], output: ModelModality): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const model of models) {
    if (!model.capabilities?.output.includes(output) || seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    ids.push(model.id);
  }
  return ids;
}

/** 解析单个模型，同时对缺失能力的旧响应保持保守处理。 */
function normalizeModel(value: unknown): ModelListItem | undefined {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = (record.id as string).trim();
  if (!id) return undefined;
  const rawCapabilities = record.capabilities
    && typeof record.capabilities === "object"
    && !Array.isArray(record.capabilities)
    ? record.capabilities as Record<string, unknown>
    : undefined;
  const input = normalizeModalities(rawCapabilities?.input);
  const output = normalizeModalities(rawCapabilities?.output);
  return {
    id,
    object: typeof record.object === "string" ? record.object : undefined,
    owned_by: typeof record.owned_by === "string" ? record.owned_by : undefined,
    capabilities: rawCapabilities
      ? {
          input: input.length > 0 ? input : ["text"],
          output: output.length > 0 ? output : ["text"],
          tools: rawCapabilities.tools === true
        }
      : undefined
  };
}

/** 从不可信响应中筛出受支持的模态名称。 */
function normalizeModalities(value: unknown): ModelModality[] {
  return Array.isArray(value)
    ? value.filter((item): item is ModelModality => typeof item === "string" && MODALITIES.includes(item as ModelModality))
    : [];
}
