import { useEffect, useState } from "react";
import { Tag } from "antd";
import { apiRequest, errorMessage } from "../api";
import { idleStatus } from "../app/defaults";
import { StatusLine } from "../components/feedback";
import type { ModelCapabilities, ModelListItem, ModelModality, StatusState } from "../types";

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  input: ["text"],
  output: ["text"],
  tools: false
};
const MODALITIES: ModelModality[] = ["text", "image", "video", "file"];

/** Display the models available to the current administrator. */
export function ModelListPanel({ apiKey }: { apiKey: string }) {
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    setStatus({ kind: "loading", message: "正在加载模型列表" });
    void apiRequest<unknown>(apiKey, "/v1/models", { method: "GET" })
      .then((response) => {
        if (!active) return;
        setModels(normalizeModelList(response));
        setStatus(idleStatus);
      })
      .catch((error) => {
        if (!active) return;
        setModels([]);
        setStatus({ kind: "error", message: errorMessage(error) ?? "模型列表加载失败" });
      });
    return () => {
      active = false;
    };
  }, [apiKey]);

  /** Copy one model id and report the browser result. */
  async function copyModelId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      setStatus({ kind: "ok", message: `已复制：${id}` });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "复制模型 ID 失败" });
    }
  }

  return (
    <section className="panel model-list-panel" aria-labelledby="model-list-title">
      <div className="panel-head">
        <div>
          <h2 id="model-list-title">模型列表</h2>
          <p className="panel-subtitle">双击模型 ID 可复制；TOOLS 表示至少有一个协议端点支持工具调用，Claude 请使用 /v1/messages。</p>
          <StatusLine status={status} />
        </div>
      </div>
      {models.length > 0 ? (
        <ul className="model-list" aria-label="可用模型">
          {models.map((model) => {
            const capabilities = model.capabilities ?? DEFAULT_CAPABILITIES;
            return (
              <li className="model-list-item" key={model.id}>
                <button
                  className="model-id-button mono"
                  onDoubleClick={() => void copyModelId(model.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void copyModelId(model.id);
                    }
                  }}
                  title="双击复制模型 ID"
                  type="button"
                >
                  {model.id}
                </button>
                <div className="model-capabilities" aria-label={`${model.id} 能力`}>
                  {capabilities.input.map((modality) => (
                    <Tag className="model-capability input" key={`in-${modality}`}>IN · {modality.toUpperCase()}</Tag>
                  ))}
                  {capabilities.output.map((modality) => (
                    <Tag className="model-capability output" key={`out-${modality}`}>OUT · {modality.toUpperCase()}</Tag>
                  ))}
                  {capabilities.tools && <Tag className="model-capability tools">TOOLS</Tag>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty">{status.kind === "loading" ? "正在加载" : "暂无可用模型"}</p>
      )}
    </section>
  );
}

/** Normalize the model catalog at the API boundary. */
function normalizeModelList(value: unknown): ModelListItem[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) {
    return [];
  }
  return (value as { data: unknown[] }).data
    .map(normalizeModel)
    .filter((model): model is ModelListItem => model !== undefined);
}

/** Normalize one model while preserving only known capabilities. */
function normalizeModel(value: unknown): ModelListItem | undefined {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = (record.id as string).trim();
  if (!id) return undefined;
  const rawCapabilities = record.capabilities && typeof record.capabilities === "object"
    ? record.capabilities as Record<string, unknown>
    : undefined;
  const input = normalizeModalities(rawCapabilities?.input);
  const output = normalizeModalities(rawCapabilities?.output);
  return {
    id,
    capabilities: rawCapabilities
      ? {
          input: input.length > 0 ? input : ["text"],
          output: output.length > 0 ? output : ["text"],
          tools: rawCapabilities.tools === true
        }
      : undefined
  };
}

/** Keep only supported modality names from an untrusted response. */
function normalizeModalities(value: unknown): ModelModality[] {
  return Array.isArray(value)
    ? value.filter((item): item is ModelModality => typeof item === "string" && MODALITIES.includes(item as ModelModality))
    : [];
}
