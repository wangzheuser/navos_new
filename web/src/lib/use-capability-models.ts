import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import type { ModelModality } from "../types";
import { modelIdsByOutput, normalizeModelList } from "./model-catalog";

type ModelLoadPhase = "loading" | "ready" | "fallback";

interface CapabilityModelsState {
  modelIds: string[];
  phase: ModelLoadPhase;
}

export interface CapabilityModelsResult {
  loading: boolean;
  message?: string;
  modelIds: string[];
}

/** 加载指定输出能力的模型，并在请求失败时回退到页面默认模型。 */
export function useCapabilityModels(
  apiKey: string,
  output: ModelModality,
  fallbackModel: string
): CapabilityModelsResult {
  const [state, setState] = useState<CapabilityModelsState>({
    modelIds: [fallbackModel],
    phase: "loading"
  });

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, phase: "loading" }));
    void apiRequest<unknown>(apiKey, "/v1/models", { method: "GET" })
      .then((response) => {
        if (!active) return;
        setState({
          modelIds: modelIdsByOutput(normalizeModelList(response), output),
          phase: "ready"
        });
      })
      .catch(() => {
        if (!active) return;
        setState({ modelIds: [fallbackModel], phase: "fallback" });
      });
    return () => {
      active = false;
    };
  }, [apiKey, fallbackModel, output]);

  return {
    loading: state.phase === "loading",
    message: modelLoadMessage(state),
    modelIds: state.modelIds
  };
}

/** 将模型加载阶段转换为页面提示，不暴露请求错误细节。 */
function modelLoadMessage(state: CapabilityModelsState): string | undefined {
  if (state.phase === "loading") {
    return "正在加载可用模型";
  }
  if (state.phase === "fallback") {
    return "模型列表加载失败，已使用默认模型";
  }
  return state.modelIds.length === 0 ? "当前没有支持该功能的模型" : undefined;
}
