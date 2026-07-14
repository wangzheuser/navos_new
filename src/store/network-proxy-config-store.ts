import type { Pool, RowDataPacket } from "mysql2/promise";
import { resolveMysqlPool, type MysqlPoolInput } from "./mysql-config.js";

export type NetworkProxyScope = "mailbox" | "registration";

export interface NetworkProxyConfigRaw {
  scope: NetworkProxyScope;
  urlTemplateEnc: string;
  createdAt: number;
  updatedAt: number;
}

export interface NetworkProxyConfigStore {
  ensureSchema?(): Promise<void>;
  get(scope: NetworkProxyScope): Promise<NetworkProxyConfigRaw | undefined>;
  save(scope: NetworkProxyScope, urlTemplateEnc: string): Promise<NetworkProxyConfigRaw>;
  delete(scope: NetworkProxyScope): Promise<void>;
}

interface NetworkProxyConfigRow extends RowDataPacket {
  scope: NetworkProxyScope;
  url_template_enc: string;
  created_at: number;
  updated_at: number;
}

export class InMemoryNetworkProxyConfigStore implements NetworkProxyConfigStore {
  private readonly configs = new Map<NetworkProxyScope, NetworkProxyConfigRaw>();

  /** Return a copy of the proxy config for one scope. */
  async get(scope: NetworkProxyScope): Promise<NetworkProxyConfigRaw | undefined> {
    const config = this.configs.get(scope);
    return config ? { ...config } : undefined;
  }

  /** Save an encrypted proxy template for one scope. */
  async save(scope: NetworkProxyScope, urlTemplateEnc: string): Promise<NetworkProxyConfigRaw> {
    const now = Date.now();
    const existing = this.configs.get(scope);
    const config = {
      scope,
      urlTemplateEnc,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.configs.set(scope, config);
    return { ...config };
  }

  /** Delete the proxy config for one scope. */
  async delete(scope: NetworkProxyScope): Promise<void> {
    this.configs.delete(scope);
  }
}

export class MysqlNetworkProxyConfigStore implements NetworkProxyConfigStore {
  private readonly pool: Pool;

  constructor(input: MysqlPoolInput) {
    this.pool = resolveMysqlPool(input);
  }

  /** Create the network proxy config table. */
  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS network_proxy_config (
        scope VARCHAR(32) PRIMARY KEY,
        url_template_enc TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
  }

  /** Load the proxy config for one scope. */
  async get(scope: NetworkProxyScope): Promise<NetworkProxyConfigRaw | undefined> {
    const [rows] = await this.pool.execute<NetworkProxyConfigRow[]>(
      "SELECT * FROM network_proxy_config WHERE scope = :scope LIMIT 1",
      { scope }
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  /** Save an encrypted proxy template for one scope. */
  async save(scope: NetworkProxyScope, urlTemplateEnc: string): Promise<NetworkProxyConfigRaw> {
    const now = Date.now();
    await this.pool.execute(
      `INSERT INTO network_proxy_config
        (scope, url_template_enc, created_at, updated_at)
       VALUES
        (:scope, :urlTemplateEnc, :now, :now)
       ON DUPLICATE KEY UPDATE
        url_template_enc = VALUES(url_template_enc),
        updated_at = VALUES(updated_at)`,
      { scope, urlTemplateEnc, now }
    );
    const saved = await this.get(scope);
    if (!saved) {
      throw new Error("failed to load saved network proxy config");
    }
    return saved;
  }

  /** Delete the proxy config for one scope. */
  async delete(scope: NetworkProxyScope): Promise<void> {
    await this.pool.execute("DELETE FROM network_proxy_config WHERE scope = :scope", { scope });
  }
}

function fromRow(row: NetworkProxyConfigRow): NetworkProxyConfigRaw {
  return {
    scope: row.scope,
    urlTemplateEnc: row.url_template_enc,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}
