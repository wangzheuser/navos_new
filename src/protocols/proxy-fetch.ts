import { ProxyAgent, type Dispatcher } from "undici";
import type { FetchLike } from "./http.js";

type RequestInitWithDispatcher = RequestInit & { dispatcher: Dispatcher };

export interface ProxyFetchSession {
  fetchImpl?: FetchLike;
  dispose(): Promise<void>;
}

/** Create an isolated proxy fetch session for one registration attempt. */
export function createProxyFetchSession(
  urlTemplate: string | undefined,
  sessionId: string
): ProxyFetchSession {
  if (!urlTemplate) {
    return { dispose: async () => undefined };
  }

  const dispatcher = new ProxyAgent(urlTemplate.replace("{uuid}", sessionId));
  return {
    fetchImpl: (input, init = {}) => fetch(input, {
      ...init,
      dispatcher
    } as RequestInitWithDispatcher),
    dispose: async () => {
      await dispatcher.close();
    }
  };
}
