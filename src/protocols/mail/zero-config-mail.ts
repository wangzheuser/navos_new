import { randomBytes } from "node:crypto";
import type { FetchLike } from "../http.js";
import {
  YydsMailError,
  extractVerificationCode,
  type YydsMailbox,
  type YydsMailboxAuth
} from "./yyds-mail.js";

/**
 * 免配置(zero-config)临时邮箱客户端。
 *
 * 与 YydsMailClient 结构兼容(同样暴露 createMailbox / findVerificationCode),
 * 因此可直接注入 RegistrationService,无需修改注册流程。区别在于:这些渠道
 * 是纯 HTTP 的公共临时邮箱服务,不需要任何 API Key 或自定义域名配置。
 *
 * 每个渠道自带固定的收信域名,createMailbox 忽略调用方传入的 domain
 * (免配置渠道无法接管 navos 域名池里的域名)。多个渠道按顺序尝试,
 * 前一个失败自动切换到下一个,提升可用性。
 */

/** 单个零配置邮箱渠道需要实现的最小能力。 */
interface ZeroConfigProvider {
  readonly id: string;
  /** 创建一个临时邮箱,返回地址;可在实例上保存所需的收信凭证。 */
  createMailbox(fetchImpl: FetchLike): Promise<string>;
  /** 拉取当前邮箱的消息列表(原始 JSON 结构,交给通用验证码提取)。 */
  listMessages(fetchImpl: FetchLike): Promise<unknown[]>;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const ADJECTIVES = ["brisk", "calm", "cool", "keen", "swift", "quiet", "bright", "sharp", "mild", "neat"];
const NOUNS = ["pine", "moss", "reef", "dawn", "cove", "flint", "vale", "wren", "grove", "onyx"];

function randomLocalPart(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}${randomBytes(2).toString("hex")}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new YydsMailError(
      `zero-config mail HTTP ${response.status}: ${text.slice(0, 200)}`,
      response.status,
      text,
      "mailbox_create_failed"
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new YydsMailError("zero-config mail returned non-JSON body", response.status, text, "message_poll_failed");
  }
}

/** 从任意嵌套结构中取出消息数组。 */
function toMessageList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["data", "emails", "messages", "items"]) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        return nested;
      }
    }
  }
  return [];
}

function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "user-agent": DEFAULT_UA, accept: "application/json,text/plain,*/*", ...extra };
}

/** TempMail.lol —— 已实测可在 NavOS 注册成功的主渠道。 */
class TempMailLolProvider implements ZeroConfigProvider {
  readonly id = "tempmail_lol";
  private token = "";
  private address = "";

  async createMailbox(fetchImpl: FetchLike): Promise<string> {
    const data = (await readJson(
      await fetchImpl("https://api.tempmail.lol/v2/inbox/create", { headers: baseHeaders() })
    )) as { address?: unknown; token?: unknown };
    if (typeof data.address !== "string" || typeof data.token !== "string" || !data.address || !data.token) {
      throw new YydsMailError("TempMail.lol response missing address/token", 502, data, "mailbox_create_failed");
    }
    this.address = data.address.toLowerCase();
    this.token = data.token;
    return this.address;
  }

  async listMessages(fetchImpl: FetchLike): Promise<unknown[]> {
    const url = `https://api.tempmail.lol/v2/inbox?token=${encodeURIComponent(this.token)}`;
    const data = (await readJson(await fetchImpl(url, { headers: baseHeaders() }))) as { emails?: unknown; expired?: unknown };
    if (data.expired === true) {
      throw new YydsMailError("TempMail.lol mailbox expired", 410, data, "message_poll_failed");
    }
    return toMessageList(data.emails ?? data);
  }
}

/** GoneBox —— 备用渠道。 */
class GoneBoxProvider implements ZeroConfigProvider {
  readonly id = "gonebox";
  private static readonly BASE = "https://api.gonebox.email/api/v1";
  private address = "";

  async createMailbox(fetchImpl: FetchLike): Promise<string> {
    const data = (await readJson(
      await fetchImpl(`${GoneBoxProvider.BASE}/inboxes`, {
        method: "POST",
        headers: baseHeaders({ "content-type": "application/json", referer: "https://gonebox.email/" }),
        body: JSON.stringify({ domain: "gonebox.email" })
      })
    )) as { data?: { address?: unknown } };
    const address = data.data?.address;
    if (typeof address !== "string" || !address.includes("@")) {
      throw new YydsMailError("GoneBox did not return a mailbox address", 502, data, "mailbox_create_failed");
    }
    this.address = address.toLowerCase();
    return this.address;
  }

  async listMessages(fetchImpl: FetchLike): Promise<unknown[]> {
    const url = `${GoneBoxProvider.BASE}/inboxes/${encodeURIComponent(this.address)}/messages`;
    const data = await readJson(await fetchImpl(url, { headers: baseHeaders({ referer: "https://gonebox.email/" }) }));
    return toMessageList(data);
  }
}

const PROVIDER_FACTORIES: Record<string, () => ZeroConfigProvider> = {
  tempmail_lol: () => new TempMailLolProvider(),
  gonebox: () => new GoneBoxProvider()
};

const DEFAULT_PROVIDER_ORDER = ["tempmail_lol", "gonebox"];

export interface ZeroConfigMailClientOptions {
  fetchImpl?: FetchLike;
  /** 渠道尝试顺序,默认 tempmail_lol 优先。 */
  providers?: string[];
}

export class ZeroConfigMailClient {
  private readonly fetchImpl: FetchLike;
  private readonly providerOrder: string[];
  // 建箱时选中的渠道,收信轮询复用同一实例(持有该邮箱的收信凭证)。
  private active?: ZeroConfigProvider;

  constructor(options: ZeroConfigMailClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    const order = (options.providers ?? DEFAULT_PROVIDER_ORDER).filter((id) => id in PROVIDER_FACTORIES);
    this.providerOrder = order.length > 0 ? order : DEFAULT_PROVIDER_ORDER;
  }

  async createMailbox(): Promise<YydsMailbox> {
    const errors: string[] = [];
    for (const id of this.providerOrder) {
      const provider = PROVIDER_FACTORIES[id]();
      try {
        const address = await provider.createMailbox(this.fetchImpl);
        this.active = provider;
        return { address, domain: address.split("@").at(-1) };
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new YydsMailError(
      `all zero-config mail providers failed: ${errors.join(" | ")}`,
      502,
      errors,
      "mailbox_create_failed"
    );
  }

  async findVerificationCode(_auth: YydsMailboxAuth): Promise<{ code?: string; message?: unknown }> {
    if (!this.active) {
      throw new YydsMailError("zero-config mailbox has not been created", 500, undefined, "message_poll_failed");
    }
    const messages = await this.active.listMessages(this.fetchImpl);
    for (const message of messages) {
      const code = extractVerificationCode(message);
      if (code) {
        return { code, message };
      }
    }
    return {};
  }
}
