"""命门验证:免配置临时邮箱能否在 NavOS 真实注册成功。
对每个零配置渠道:建箱 -> NavOS send_email_code -> 轮询收码 -> login 拿 uid/token。
走到 uid/token 即证明该渠道可真实注册。作者:wangqiupei
"""
import hashlib
import hmac
import html
import json
import random
import re
import time
import urllib.parse
import urllib.request

VIP_BASE = "https://navos-mind-server-vip.tec-do.com"
VIP_SECRET = "5c1d6c1dcd777dbe26f1422f03e5b3749ed87432"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36"

ADJ = ["brisk", "calm", "cool", "keen", "swift", "quiet", "bright", "sharp"]
NOUN = ["pine", "moss", "reef", "dawn", "cove", "flint", "vale", "wren"]


def rand_local():
    return f"{random.choice(ADJ)}{random.choice(NOUN)}{random.randint(100, 9999)}"


def http(method, url, headers=None, data=None, timeout=45):
    body = None
    if data is not None:
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", "ignore")


def strip_html(raw):
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def extract_code(text):
    text = strip_html(text)
    m = re.search(r"(?:code|verification|验证码|校验码)[^0-9]{0,20}(\d{4,8})", text, re.I)
    if m:
        return m.group(1)
    m = re.search(r"(?<!\d)(\d{6})(?!\d)", text)
    return m.group(1) if m else None


# ---------- 零配置渠道:各自建箱 + 列信 ----------
class TempMailLOL:
    name = "tempmail_lol"

    def create(self):
        _, txt = http("GET", "https://api.tempmail.lol/v2/inbox/create", {"User-Agent": UA})
        d = json.loads(txt)
        self.token = d["token"]
        self.addr = d["address"].lower()
        return self.addr

    def messages(self):
        _, txt = http("GET", "https://api.tempmail.lol/v2/inbox?" + urllib.parse.urlencode({"token": self.token}), {"User-Agent": UA})
        d = json.loads(txt)
        return d.get("emails") or []


class GoneBox:
    name = "gonebox"
    base = "https://api.gonebox.email/api/v1"

    def create(self):
        _, txt = http("POST", self.base + "/inboxes", {"User-Agent": UA, "Content-Type": "application/json", "Referer": "https://gonebox.email/"}, {"domain": "gonebox.email"})
        d = json.loads(txt)
        self.addr = (d.get("data") or {}).get("address", "").lower()
        return self.addr

    def messages(self):
        _, txt = http("GET", self.base + "/inboxes/" + urllib.parse.quote(self.addr) + "/messages", {"User-Agent": UA, "Referer": "https://gonebox.email/"})
        d = json.loads(txt)
        return (d.get("data") if isinstance(d, dict) else d) or []


class FreeCustom:
    name = "fce_areueally"
    base = "https://www.freecustom.email"
    domain = "areueally.info"

    def _h(self, auth=False):
        h = {"User-Agent": UA, "Referer": self.base + "/en", "x-fce-client": "web-client"}
        if auth and getattr(self, "token", None):
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def create(self):
        _, txt = http("POST", self.base + "/api/auth", self._h())
        self.token = json.loads(txt)["token"]
        self.addr = f"{rand_local()}@{self.domain}"
        self.messages()  # 首次读取建立 mailbox
        return self.addr

    def messages(self):
        _, txt = http("GET", self.base + "/api/public-mailbox?" + urllib.parse.urlencode({"fullMailboxId": self.addr}), self._h(auth=True))
        d = json.loads(txt)
        return (d.get("data") if isinstance(d, dict) else d) or []


# ---------- NavOS VIP 签名调用 ----------
def vip_request(path, business, uid="0", token=""):
    common = {"token": token, "uid": uid, "open_id": uid, "app_id": "1000", "device_id": "",
              "platform": "web", "lang": "zhCN", "version": "0", "channel": "1600", "tryno": "1600", "oemid": ""}
    body = dict(business)
    body["common"] = common
    raw = json.dumps(body).encode()
    sig = hmac.new(VIP_SECRET.encode(), raw, hashlib.md5).hexdigest()
    status, txt = http("POST", VIP_BASE + path, {"Content-Type": "application/json", "Authorization": sig, "User-Agent": "NavosProtocolAdapter/0.1"}, raw)
    try:
        return status, json.loads(txt)
    except Exception:
        return status, txt


def send_code(email):
    return vip_request("/api/user/email/send_email_code", {"email": email, "template_scene": "login"})


def login(email, code):
    return vip_request("/api/user/login", {"login_type": 9, "email_params": {"email": email, "email_verify_code": code}, "user_attributes": {"register_time_zone": "Asia/Shanghai"}})


def try_channel(ch):
    print(f"\n===== 渠道 {ch.name} =====")
    try:
        addr = ch.create()
        print(f"[1] 建箱成功: {addr}")
    except Exception as e:
        print(f"[1] 建箱失败: {e}")
        return None
    try:
        st, resp = send_code(addr)
        ret = resp.get("resp_common", {}).get("ret") if isinstance(resp, dict) else None
        msg = resp.get("resp_common", {}).get("msg") if isinstance(resp, dict) else str(resp)[:200]
        print(f"[2] send_email_code HTTP {st} ret={ret} msg={msg}")
        if isinstance(resp, dict) and ret not in (None, 0, 200):
            print(f"[2] NavOS 拒绝该邮箱域名 -> 命门未过")
            return None
    except Exception as e:
        print(f"[2] send_email_code 异常: {e}")
        return None
    sent_at = time.time()
    code = None
    for i in range(1, 21):
        time.sleep(4)
        try:
            msgs = ch.messages()
        except Exception as e:
            print(f"[3] 第{i}次列信异常: {e}")
            continue
        for m in msgs:
            code = extract_code(json.dumps(m, ensure_ascii=False))
            if code:
                break
        print(f"[3] 第{i}次轮询: {len(msgs)}封, code={code}, 用时{int(time.time()-sent_at)}s")
        if code:
            break
    if not code:
        print(f"[3] 超时未收到验证码 -> 命门未过(NavOS 未发到此域名或延迟过高)")
        return None
    try:
        st, resp = login(addr, code)
        uid = resp.get("uid") if isinstance(resp, dict) else None
        token = resp.get("token") if isinstance(resp, dict) else None
        msg = resp.get("resp_common", {}).get("msg") if isinstance(resp, dict) else str(resp)[:200]
        print(f"[4] login HTTP {st} uid={uid} token={'***' if token else None} msg={msg}")
        if uid and token:
            print(f"[✓] 渠道 {ch.name} 真实注册成功！uid={uid}")
            return {"channel": ch.name, "email": addr, "uid": uid, "token": token}
    except Exception as e:
        print(f"[4] login 异常: {e}")
    return None


if __name__ == "__main__":
    winner = None
    for cls in (TempMailLOL, GoneBox, FreeCustom):
        try:
            r = try_channel(cls())
        except Exception as e:
            print(f"渠道 {cls.name} 顶层异常: {e}")
            r = None
        if r:
            winner = r
            break
    print("\n================ 结果 ================")
    print(json.dumps(winner, ensure_ascii=False) if winner else "无渠道能真实注册成功")
