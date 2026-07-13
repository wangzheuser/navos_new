/**
 * 端到端验证:用集成后的 ZeroConfigMailClient + 真实 VipClient 跑完整注册链路,
 * 证明免配置渠道能在 NavOS 真实注册成功(建箱 -> 发码 -> 收码 -> login 拿 uid/token)。
 * 作者:wangqiupei
 * 运行:HTTPS_PROXY=... tsx scripts/verify_zeroconfig_e2e.ts
 */
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { ZeroConfigMailClient } from "../src/protocols/mail/zero-config-mail.js";
import { VipClient } from "../src/protocols/vip-client.js";

// 境外服务需走代理:让全局 fetch(undici)经过本机代理出网。
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy) {
  setGlobalDispatcher(new ProxyAgent(proxy));
}

const VIP_BASE = "https://navos-mind-server-vip.tec-do.com";
const VIP_SECRET = "5c1d6c1dcd777dbe26f1422f03e5b3749ed87432";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const mail = new ZeroConfigMailClient();
  const vip = new VipClient({ baseUrl: VIP_BASE, hmacSecret: VIP_SECRET });

  // 1. 免配置建箱
  const mailbox = await mail.createMailbox();
  console.log(`[1] 建箱: ${mailbox.address} (domain=${mailbox.domain})`);

  // 2. NavOS 发验证码
  await vip.sendEmailCode(mailbox.address);
  console.log(`[2] sendEmailCode ok`);

  // 3. 轮询收码(复用注册流程同样的 findVerificationCode)
  const auth = { address: mailbox.address, token: mailbox.token };
  let code: string | undefined;
  for (let i = 1; i <= 20 && !code; i++) {
    if (i > 1) await sleep(4000);
    code = (await mail.findVerificationCode(auth)).code;
    console.log(`[3] 第${i}次轮询 code=${code ?? "(未到)"}`);
  }
  if (!code) {
    console.log("[FAIL] 未收到验证码");
    process.exit(1);
  }

  // 4. login 完成真实注册
  const { uid, token } = await vip.login(mailbox.address, code);
  console.log(`[4] login ok uid=${uid} token=${token ? "***" : "(空)"}`);

  // 5. 查余额,确认账号真实可用
  const bal = await vip.queryBalance(uid, token);
  console.log(`[5] 余额: available=${bal.availableBalance} total=${bal.totalBalance}`);

  console.log(`\n[✓] 集成后免配置渠道真实注册成功 email=${mailbox.address} uid=${uid}`);
}

main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
