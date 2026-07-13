import { describe, expect, it } from "vitest";
import { ZeroConfigMailClient } from "../src/protocols/mail/zero-config-mail.js";
import { YydsMailError } from "../src/protocols/mail/yyds-mail.js";

// 用注入的假 fetch 断言:建箱失败会切换渠道、收码走通用提取。
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  return async (input: string | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) {
      return new Response("not found", { status: 404 });
    }
    const route = routes[key];
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  };
}

describe("ZeroConfigMailClient", () => {
  it("建箱成功后能从消息中提取验证码", async () => {
    const client = new ZeroConfigMailClient({
      providers: ["tempmail_lol"],
      fetchImpl: fakeFetch({
        "https://api.tempmail.lol/v2/inbox/create": { body: { address: "a@w1.temp.org", token: "tok" } },
        "https://api.tempmail.lol/v2/inbox": {
          body: { emails: [{ subject: "验证码", body: "your code is 654321" }] }
        }
      }) as never
    });

    const mailbox = await client.createMailbox();
    expect(mailbox.address).toBe("a@w1.temp.org");
    expect(mailbox.domain).toBe("w1.temp.org");

    const result = await client.findVerificationCode({ address: mailbox.address });
    expect(result.code).toBe("654321");
  });

  it("首个渠道失败时自动切换到下一个", async () => {
    const client = new ZeroConfigMailClient({
      providers: ["tempmail_lol", "gonebox"],
      fetchImpl: fakeFetch({
        "https://api.tempmail.lol/v2/inbox/create": { status: 500, body: { error: "boom" } },
        "https://api.gonebox.email/api/v1/inboxes": { body: { data: { address: "b@gonebox.email" } } }
      }) as never
    });

    const mailbox = await client.createMailbox();
    expect(mailbox.address).toBe("b@gonebox.email");
  });

  it("所有渠道失败时抛出 YydsMailError", async () => {
    const fetchImpl = vi.fn(fakeFetch({
      "https://api.tempmail.lol/v2/inbox/create": { status: 500, body: {} },
      "https://api.gonebox.email/api/v1/inboxes": { body: { data: { address: "unused@gonebox.email" } } }
    }));
    const client = new ZeroConfigMailClient({
      providers: ["tempmail_lol"],
      fetchImpl: fetchImpl as never
    });

    await expect(client.createMailbox()).rejects.toBeInstanceOf(YydsMailError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("api.tempmail.lol");
  });
});
