import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button as AntButton, Popconfirm } from "antd";
import { KeyRound, Network, Trash2 } from "lucide-react";
import { apiRequest, errorMessage } from "../api";
import { StatusLine } from "../components/feedback";
import { TextField } from "../components/fields";
import { idleStatus } from "../app/defaults";
import { YydsDomainPoolPanel } from "./YydsDomainPoolPanel";
import type { NetworkProxyConfig, StatusState, YydsMailConfig } from "../types";

const PROXY_PLACEHOLDER = "http://node.{uuid}:pass@172.17.0.1:9200";

interface ProxyCardProps {
  apiKey: string;
  config: NetworkProxyConfig;
  description: string;
  label: string;
  path: string;
  onConfigChange: (config: NetworkProxyConfig) => void;
}

export function YydsMailConfigPanel({ apiKey }: { apiKey: string }) {
  const [config, setConfig] = useState<YydsMailConfig | undefined>();
  const [mailboxProxy, setMailboxProxy] = useState<NetworkProxyConfig>({ configured: false });
  const [registrationProxy, setRegistrationProxy] = useState<NetworkProxyConfig>({ configured: false });
  const [mailKey, setMailKey] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);

  useEffect(() => {
    let active = true;
    async function loadConfig() {
      setStatus({ kind: "loading", message: "正在读取配置" });
      try {
        const [loaded, loadedMailboxProxy, loadedRegistrationProxy] = await Promise.all([
          apiRequest<YydsMailConfig>(apiKey, "/api/mail/yyds/config", { method: "GET" }),
          apiRequest<NetworkProxyConfig>(apiKey, "/api/mail/proxy/config", { method: "GET" }),
          apiRequest<NetworkProxyConfig>(apiKey, "/api/registration/proxy/config", { method: "GET" })
        ]);
        if (!active) {
          return;
        }
        setConfig(loaded);
        setMailboxProxy(loadedMailboxProxy);
        setRegistrationProxy(loadedRegistrationProxy);
        setMailKey("");
        setStatus({ kind: "idle", message: "" });
      } catch (error) {
        if (active) {
          setStatus({ kind: "error", message: errorMessage(error) ?? "读取 YYDS 配置失败" });
        }
      }
    }

    void loadConfig();
    return () => {
      active = false;
    };
  }, [apiKey]);

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: "loading", message: "正在保存 YYDS Mail Key" });
    try {
      const saved = await apiRequest<YydsMailConfig>(apiKey, "/api/mail/yyds/config", {
        method: "PUT",
        body: JSON.stringify({
          apiKey: mailKey || undefined,
          enabled: true
        })
      });
      setConfig(saved);
      setMailKey("");
      setStatus({ kind: "ok", message: "已保存" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? "保存 YYDS 配置失败" });
    }
  }

  return (
    <section className="panel narrow config-panel" aria-labelledby="yyds-config-title">
      <div className="panel-head config-hero">
        <div>
          <p className="eyebrow">注册机上游 · 邮箱 · 账号池护栏</p>
          <h2 id="yyds-config-title">邮箱配置</h2>
          <p className="panel-subtitle">把邮箱、域名和账号消耗策略放在一个地方，部署后也能安全调整。</p>
          <StatusLine status={status} />
        </div>
        <span className={`badge ${config?.apiKeyConfigured ? "active" : "disabled"}`}>
          {config?.apiKeyConfigured ? "密钥已保存" : "未配置密钥"}
        </span>
      </div>

      <NetworkProxyCard
        apiKey={apiKey}
        config={mailboxProxy}
        description="仅代理建箱、建箱重试和验证码轮询；下一次注册实时生效。"
        label="邮箱网络代理"
        path="/api/mail/proxy/config"
        onConfigChange={setMailboxProxy}
      />

      <NetworkProxyCard
        apiKey={apiKey}
        config={registrationProxy}
        description="代理发送验证码、登录、初始余额查询和企业认证；下一次注册实时生效。"
        label="注册网络代理"
        path="/api/registration/proxy/config"
        onConfigChange={setRegistrationProxy}
      />

      <form className="config-form key-config-card yyds-key-card" onSubmit={saveConfig}>
        <Alert
          showIcon
          type="info"
          title="保存 YYDS Mail Key"
          description="密钥会加密写入 MySQL，页面不会回显明文。留空保存时只更新启用状态，不会覆盖已有密钥。"
        />
        <TextField label="YYDS Mail Key" type="password" value={mailKey} onChange={setMailKey} />
        <div className="secret-note">
          <span>当前密钥：{config?.apiKeyConfigured ? "已保存" : "未保存"}</span>
          <span>用途：批量注册收码</span>
        </div>
        <div className="toolbar flush">
          <AntButton disabled={status.kind === "loading"} htmlType="submit" icon={<KeyRound size={16} />} type="primary">
            保存 YYDS 配置
          </AntButton>
        </div>
      </form>
      <YydsDomainPoolPanel apiKey={apiKey} />
    </section>
  );
}

/** Render one independently managed proxy config. */
function NetworkProxyCard({
  apiKey,
  config,
  description,
  label,
  path,
  onConfigChange
}: ProxyCardProps) {
  const [urlTemplate, setUrlTemplate] = useState("");
  const [status, setStatus] = useState<StatusState>(idleStatus);

  /** Save a complete proxy template without keeping the plaintext in the form. */
  async function saveProxy(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: "loading", message: `正在保存${label}` });
    try {
      const saved = await apiRequest<NetworkProxyConfig>(apiKey, path, {
        method: "PUT",
        body: JSON.stringify({ urlTemplate })
      });
      onConfigChange(saved);
      setUrlTemplate("");
      setStatus({ kind: "ok", message: "已保存，下一次注册生效" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? `保存${label}失败` });
    }
  }

  /** Clear the proxy config so future registrations use direct access. */
  async function clearProxy() {
    setStatus({ kind: "loading", message: `正在清除${label}` });
    try {
      const cleared = await apiRequest<NetworkProxyConfig>(apiKey, path, { method: "DELETE" });
      onConfigChange(cleared);
      setUrlTemplate("");
      setStatus({ kind: "ok", message: "已清除，下一次注册恢复直连" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) ?? `清除${label}失败` });
    }
  }

  return (
    <form className="config-form key-config-card network-proxy-card" onSubmit={saveProxy}>
      <div className="panel-head">
        <div>
          <h3>{label}</h3>
          <p className="panel-subtitle">{description}</p>
        </div>
        <span className={`badge ${config.configured ? "active" : "disabled"}`}>
          {config.configured ? "已配置代理" : "当前直连"}
        </span>
      </div>
      <Alert
        showIcon
        type="info"
        title="动态代理模板"
        description="每个账号注册会将 {uuid} 替换为独立的32位无横线 UUID。代理地址会加密保存且不回显；macOS Docker Desktop 请使用 host.docker.internal。"
      />
      <TextField
        label={`${label}地址`}
        type="password"
        placeholder={PROXY_PLACEHOLDER}
        value={urlTemplate}
        onChange={setUrlTemplate}
      />
      <div className="secret-note">
        <span>当前状态：{config.configured ? "已配置" : "直连"}</span>
        <span>进行中的注册不会切换出口</span>
      </div>
      <StatusLine status={status} />
      <div className="toolbar flush">
        <AntButton
          disabled={!urlTemplate.trim() || status.kind === "loading"}
          htmlType="submit"
          icon={<Network size={16} />}
          type="primary"
        >
          保存代理
        </AntButton>
        <Popconfirm
          title={`清除${label}？`}
          description="清除后，下一次注册将恢复直连。"
          okText="确认清除"
          cancelText="取消"
          disabled={!config.configured || status.kind === "loading"}
          onConfirm={() => void clearProxy()}
        >
          <AntButton
            danger
            disabled={!config.configured || status.kind === "loading"}
            icon={<Trash2 size={16} />}
          >
            清除代理
          </AntButton>
        </Popconfirm>
      </div>
    </form>
  );
}
