import { describe, expect, it } from "vitest";
import {
  NetworkProxyConfigDecryptError,
  NetworkProxyConfigService,
  normalizeProxyTemplate
} from "../src/services/network-proxy-config-service.js";
import { InMemoryNetworkProxyConfigStore } from "../src/store/network-proxy-config-store.js";

const ROOT_SECRET = "test-network-proxy-secret-32-characters";
const TEMPLATE = "http://node.{uuid}:pass@172.17.0.1:9200";

describe("NetworkProxyConfigService", () => {
  it("encrypts and independently clears both proxy scopes", async () => {
    const store = new InMemoryNetworkProxyConfigStore();
    const service = new NetworkProxyConfigService(store, ROOT_SECRET);

    expect(await service.get("mailbox")).toEqual({ configured: false });
    expect(await service.save("mailbox", TEMPLATE)).toMatchObject({ configured: true });
    expect(await service.save("registration", TEMPLATE)).toMatchObject({ configured: true });

    const mailboxRaw = await store.get("mailbox");
    expect(mailboxRaw?.urlTemplateEnc).not.toContain(TEMPLATE);
    expect(await service.urlTemplate("mailbox")).toBe(TEMPLATE);

    expect(await service.clear("mailbox")).toEqual({ configured: false });
    expect(await service.get("registration")).toMatchObject({ configured: true });
  });

  it("rejects malformed templates without echoing credentials", () => {
    expect(() => normalizeProxyTemplate("http://node:secret@127.0.0.1:9200")).toThrow(
      "urlTemplate must contain exactly one {uuid}"
    );
    expect(() => normalizeProxyTemplate("ftp://node.{uuid}:secret@127.0.0.1:9200")).toThrow(
      "urlTemplate protocol must be http or https"
    );
    expect(() => normalizeProxyTemplate("http://node.{uuid}.{uuid}:secret@127.0.0.1:9200")).toThrow(
      "urlTemplate must contain exactly one {uuid}"
    );
  });

  it("cannot decrypt ciphertext copied across proxy scopes", async () => {
    const store = new InMemoryNetworkProxyConfigStore();
    const service = new NetworkProxyConfigService(store, ROOT_SECRET);
    await service.save("mailbox", TEMPLATE);
    const mailboxRaw = await store.get("mailbox");
    await store.save("registration", mailboxRaw!.urlTemplateEnc);

    await expect(service.urlTemplate("registration")).rejects.toBeInstanceOf(NetworkProxyConfigDecryptError);
  });
});
