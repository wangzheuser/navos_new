import { SecretBox } from "../security/secretbox.js";
import type {
  NetworkProxyConfigStore,
  NetworkProxyScope
} from "../store/network-proxy-config-store.js";

const UUID_PLACEHOLDER = "{uuid}";
const TEST_UUID = "00000000000000000000000000000000";

export interface NetworkProxyConfigDto {
  configured: boolean;
  updatedAt?: number;
}

export class NetworkProxyConfigDecryptError extends Error {
  constructor(scope: NetworkProxyScope, cause?: unknown) {
    super(`${scopeLabel(scope)} proxy configuration cannot be decrypted; re-save the proxy configuration`, { cause });
    this.name = "NetworkProxyConfigDecryptError";
  }
}

export class NetworkProxyConfigService {
  private readonly boxes: Record<NetworkProxyScope, SecretBox>;

  constructor(
    private readonly store: NetworkProxyConfigStore,
    rootSecret: string
  ) {
    this.boxes = {
      mailbox: new SecretBox(rootSecret, "navos:mailbox_proxy_config:v1"),
      registration: new SecretBox(rootSecret, "navos:registration_proxy_config:v1")
    };
  }

  /** Return proxy config status without exposing the template. */
  async get(scope: NetworkProxyScope): Promise<NetworkProxyConfigDto> {
    return toDto(await this.store.get(scope));
  }

  /** Validate, encrypt and save a proxy template. */
  async save(scope: NetworkProxyScope, input: unknown): Promise<NetworkProxyConfigDto> {
    const urlTemplate = normalizeProxyTemplate(input);
    const encrypted = this.boxes[scope].encrypt(urlTemplate);
    return toDto(await this.store.save(scope, encrypted));
  }

  /** Clear a proxy config so the scope returns to direct access. */
  async clear(scope: NetworkProxyScope): Promise<NetworkProxyConfigDto> {
    await this.store.delete(scope);
    return { configured: false };
  }

  /** Return the decrypted template used when a registration starts. */
  async urlTemplate(scope: NetworkProxyScope): Promise<string | undefined> {
    const raw = await this.store.get(scope);
    if (!raw) {
      return undefined;
    }
    try {
      return this.boxes[scope].decrypt(raw.urlTemplateEnc);
    } catch (error) {
      throw new NetworkProxyConfigDecryptError(scope, error);
    }
  }
}

/** Validate a proxy template and return its normalized value. */
export function normalizeProxyTemplate(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("urlTemplate is required");
  }
  const value = input.trim();
  if (value.split(UUID_PLACEHOLDER).length !== 2) {
    throw new Error("urlTemplate must contain exactly one {uuid}");
  }

  let parsed: URL;
  try {
    parsed = new URL(value.replace(UUID_PLACEHOLDER, TEST_UUID));
  } catch {
    throw new Error("urlTemplate must be a valid proxy URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("urlTemplate protocol must be http or https");
  }
  if (!parsed.hostname) {
    throw new Error("urlTemplate must include a proxy host");
  }
  return value;
}

function toDto(raw: { updatedAt: number } | undefined): NetworkProxyConfigDto {
  return raw ? { configured: true, updatedAt: raw.updatedAt } : { configured: false };
}

function scopeLabel(scope: NetworkProxyScope): string {
  return scope === "mailbox" ? "Mailbox" : "Registration";
}
