// magpie 网关客户端：读额度卡片、刷新、使用重置卡（Codex / 智谱 GLM / 远程 Magpie）。
//
// 只走回环地址上的网关（插件宿主与网关在同一台机器 / 同一个容器里）。
// 用 node:http 直连，不用宿主改造过的 fetch —— 后者会按 MAGPIE_*_PROXY
// 走代理，对 127.0.0.1 没有意义。
//
// 网关 key：使用 Codex 重置卡（POST /v1/magpie/quotas/codex-reset）即使从本机发起
// 也必须带「满权限」的网关 key（magpie 源码 gateway.go codexReset）。
// 优先用插件选项 gatewayKey；否则读 magpie 配置目录里的 caller-keys.json，
// 选第一把启用的、非只读、未被限制预算/模型/账户的 key。key 只在本进程内存里
// 使用，绝不出现在任何 HTTP 响应、页面或日志里。

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const DEFAULT_ADDR = "127.0.0.1:3425";

// configDirs 是可能的 magpie 配置目录：宿主进程就运行在配置目录里
// （host.js：「the host runs in magpie's config folder」），其后是常见位置。
export function configDirs(env = process.env, cwd = process.cwd()) {
  const out = [cwd];
  if (env.XDG_CONFIG_HOME) out.push(path.join(env.XDG_CONFIG_HOME, "magpie"));
  out.push(path.join(os.homedir(), ".config", "magpie"));
  out.push("/config/magpie");
  return [...new Set(out)];
}

// isFullKey：启用、有明文 secret、非只读、非浏览器扩展专用、未被限制。
export function isFullKey(k) {
  if (!k || typeof k !== "object") return false;
  if (k.off || k.readOnly || k.browser) return false;
  if (typeof k.secret !== "string" || k.secret.length < 8) return false;
  if (k.limit || (Array.isArray(k.moreLimits) && k.moreLimits.length)) return false;
  if (Array.isArray(k.models) && k.models.length) return false;
  if (Array.isArray(k.accounts) && k.accounts.length) return false;
  if (k.expires || k.expiresAt) {
    const t = Date.parse(k.expires || k.expiresAt);
    if (Number.isFinite(t) && t < Date.now()) return false;
  }
  return true;
}

// isReadableKey：至少能读额度（只读 key 也行）。
function isReadableKey(k) {
  return !!k && typeof k === "object" && !k.off && !k.browser && typeof k.secret === "string" && k.secret.length >= 8;
}

// pickKeys 从 caller-keys.json 的内容里挑 key：满权限的在前（LAN / 默认 key 优先），
// 只读 key 在后（只能读，不能用重置卡）。
export function pickKeys(list) {
  if (!Array.isArray(list)) return [];
  const full = list.filter(isFullKey).sort((a, b) => (b.lan ? 1 : 0) - (a.lan ? 1 : 0));
  const read = list.filter((k) => isReadableKey(k) && !isFullKey(k) && k.readOnly);
  return [
    ...full.map((k) => ({ secret: k.secret, name: k.name || k.id || "key", full: true, source: "caller-keys" })),
    ...read.map((k) => ({ secret: k.secret, name: k.name || k.id || "key", full: false, source: "caller-keys" })),
  ];
}

export function readCallerKeys(dirs = configDirs()) {
  for (const d of dirs) {
    const f = path.join(d, "caller-keys.json");
    let raw;
    try {
      raw = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    try {
      return { file: f, keys: pickKeys(JSON.parse(raw)) };
    } catch {
      return { file: f, keys: [] };
    }
  }
  return { file: "", keys: [] };
}

export function readProviders(dirs = configDirs()) {
  for (const d of dirs) {
    const f = path.join(d, "providers.json");
    let raw;
    try {
      raw = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.providers) ? parsed.providers : [];
      return list;
    } catch {
      return [];
    }
  }
  return [];
}

// gatewayBase 是网关地址：选项 gatewayUrl > MAGPIE_ADDR > 127.0.0.1:3425。
// 0.0.0.0 / :: 是监听值，换成回环地址。
export function gatewayBase(opt = "", env = process.env) {
  let s = typeof opt === "string" ? opt.trim() : "";
  if (!s) {
    const addr = (env.MAGPIE_ADDR || "").trim() || DEFAULT_ADDR;
    const tls = !!(env.MAGPIE_TLS_CERT && env.MAGPIE_TLS_KEY);
    s = (tls ? "https://" : "http://") + addr;
  }
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    u = new URL("http://" + DEFAULT_ADDR);
  }
  if (u.hostname === "0.0.0.0" || u.hostname === "[::]" || u.hostname === "::" || u.hostname === "") u.hostname = "127.0.0.1";
  if (!u.port) u.port = u.protocol === "https:" ? "443" : "3425";
  u.pathname = u.pathname.replace(/\/+$/, "");
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

export class GatewayError extends Error {
  constructor(message, status = 0, type = "") {
    super(message);
    this.status = status;
    this.type = type;
  }
}

// request 发一个 HTTP/HTTPS 请求，返回解析后的 JSON。
function request(base, method, pathAndQuery, key, timeoutMs, { rawAuth = false, jsonBody = undefined, extraHeaders = {} } = {}) {
  const u = new URL(base + pathAndQuery);
  const mod = u.protocol === "https:" ? https : http;
  const headers = { accept: "application/json", "user-agent": "magpie-page-credentials", ...extraHeaders };
  if (key) headers.authorization = rawAuth ? key : "Bearer " + key;
  const payload = jsonBody !== undefined ? Buffer.from(JSON.stringify(jsonBody), "utf8") : null;
  if (payload) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(payload.length);
  } else if (method !== "GET") {
    headers["content-length"] = "0";
  }
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method,
        headers,
        timeout: timeoutMs,
        // 回环上的网关多半是自签证书
        rejectUnauthorized: !isLoopback(u.hostname),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(body);
          const msg = body?.error?.message || body?.msg || text.slice(0, 300) || `HTTP ${res.statusCode}`;
          reject(new GatewayError(msg, res.statusCode, body?.error?.type || body?.error?.code || ""));
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new GatewayError(`服务在 ${Math.round(timeoutMs / 1000)} 秒内没有回应`, 504, "timeout")));
    req.on("error", (e) => reject(e instanceof GatewayError ? e : new GatewayError(`连接失败（${u.host}）：${e.code || e.message}`, 502, "unreachable")));
    if (payload) req.write(payload);
    req.end();
  });
}

// 识别智谱 / Z.ai 编码套餐的业务域名与认证方式
function zhipuConfigOf(p) {
  if (!p || typeof p !== "object") return null;
  const key = typeof p.key === "string" ? p.key.trim() : "";
  if (!key) return null;
  for (const base of [p.chat, p.anthropic, p.responses, p.website]) {
    if (typeof base !== "string" || !base) continue;
    try {
      const h = new URL(base).hostname.toLowerCase();
      if (h === "open.bigmodel.cn" || h.endsWith(".bigmodel.cn") || h === "bigmodel.cn") {
        return { root: "https://open.bigmodel.cn", key, rawAuth: true };
      }
      if (h === "api.z.ai" || h.endsWith(".z.ai")) {
        return { root: "https://api.z.ai", key, rawAuth: false };
      }
    } catch {
      /* ignore invalid URL */
    }
  }
  if (p.preset === "zhipu" || p.icon === "zhipu-color") {
    return { root: "https://open.bigmodel.cn", key, rawAuth: true };
  }
  return null;
}

export class Gateway {
  constructor(options = {}) {
    this.options = options;
    this.base = gatewayBase(options.gatewayUrl);
    this.working = null; // 上次成功的 key（secret 只留在内存）
  }

  // keys：选项里的 key 永远第一个；再是 caller-keys.json 的；最后「不带 key」
  //（本机网关读额度可以不带 key）。
  keys() {
    const out = [];
    const opt = typeof this.options.gatewayKey === "string" ? this.options.gatewayKey.trim() : "";
    if (opt) out.push({ secret: opt, name: "插件选项 gatewayKey", full: true, source: "option" });
    for (const k of readCallerKeys().keys) if (!out.some((x) => x.secret === k.secret)) out.push(k);
    if (this.working && !out.some((x) => x.secret === this.working.secret)) this.working = null;
    // 上次成功的排最前
    if (this.working) out.sort((a, b) => (b.secret === this.working.secret ? 1 : 0) - (a.secret === this.working.secret ? 1 : 0));
    out.push({ secret: "", name: "（不带 key）", full: false, source: "none" });
    return out;
  }

  // call 依次试 key：401 / 403 换下一把；其他错误直接抛。
  async call(method, pathAndQuery, { timeoutMs = 20000, needFull = false } = {}) {
    let last = null;
    for (const k of this.keys()) {
      if (needFull && !k.full) continue;
      try {
        const body = await request(this.base, method, pathAndQuery, k.secret, timeoutMs);
        this.working = k;
        return body;
      } catch (e) {
        last = e;
        // 401 / 403（key 不对、只读、被限制）：换下一把
        if (e instanceof GatewayError && (e.status === 401 || e.status === 403)) continue;
        throw e;
      }
    }
    if (needFull && !last) {
      throw new GatewayError(
        "使用重置卡需要一把启用的、满权限（非只读、未限制预算/模型/账户）的网关 key：在 magpie「网关 › 网关 key」里新建一把，或在插件选项 gatewayKey 里填写",
        401,
        "no_full_key",
      );
    }
    throw last || new GatewayError("网关拒绝了请求", 401);
  }

  // who：给页面看的 key 概况（不含 secret）。
  who() {
    const ks = this.keys();
    const full = ks.find((k) => k.full);
    return {
      gateway: this.base,
      key: this.working ? this.working.name : null,
      canReset: !!full,
      resetKey: full ? full.name : null,
    };
  }

  async cards() {
    try {
      const body = await this.call("GET", "/v1/magpie/quotas/cards", { timeoutMs: 15000 });
      return Array.isArray(body?.data) ? body.data : [];
    } catch (e) {
      // 旧版 magpie 没有 /cards：退回 /quotas
      if (e instanceof GatewayError && e.status === 404) {
        const body = await this.call("GET", "/v1/magpie/quotas", { timeoutMs: 15000 });
        return Array.isArray(body?.data) ? body.data : [];
      }
      throw e;
    }
  }

  async refresh(provider = "", user = "") {
    const q = new URLSearchParams();
    if (provider) q.set("provider", provider);
    if (user) q.set("user", user);
    const qs = q.toString();
    const body = await this.call("POST", "/v1/magpie/quotas/refresh" + (qs ? "?" + qs : ""), { timeoutMs: provider ? 35000 : 60000 });
    return Array.isArray(body?.data) ? body.data : null;
  }

  async codexReset(user, credit = "") {
    const q = new URLSearchParams({ user });
    if (credit) q.set("credit", credit);
    return this.call("POST", "/v1/magpie/quotas/codex-reset?" + q.toString(), { timeoutMs: 40000, needFull: true });
  }

  // 远程 magpie 的 Codex 重置卡（provider 形如 "office/codex"）
  async remoteCodexReset(provider, user, credit = "", dirs = configDirs()) {
    const [remoteId, sub] = String(provider || "").split("/");
    if (!remoteId || sub !== "codex") {
      throw new GatewayError(`不支持远程服务 ${provider} 的重置卡`, 400);
    }
    const p = readProviders(dirs).find((x) => x && x.id === remoteId);
    const base = p && (p.chat || p.baseURL || p.url || p.endpoint);
    const key = p && p.key;
    if (!base || !key) {
      throw new GatewayError(`未找到远程 magpie（${remoteId}）的地址或网关 key，请在那台机器上使用重置卡`, 400);
    }
    const root = new URL(base).origin;
    const q = new URLSearchParams({ user });
    if (credit) q.set("credit", credit);
    const out = await request(root, "POST", "/v1/magpie/quotas/codex-reset?" + q.toString(), key, 35000);
    try {
      await this.refresh("", "");
    } catch {
      /* ignore refresh error */
    }
    return out;
  }

  // 智谱 GLM Coding Plan / Z.ai 的按窗口重置卡（fiveHour / weekly）
  async zhipuReset(provider, windowKind = "", expireAt = "", dirs = configDirs()) {
    const p = readProviders(dirs).find((x) => x && x.id === provider);
    const cfg = zhipuConfigOf(p);
    if (!cfg) {
      throw new GatewayError(`未在 providers.json 中找到 ${provider} 的智谱/Z.ai 密钥配置`, 400);
    }
    const extraHeaders = { "User-Agent": "ZCode/3.14.3" };
    const listEnv = await request(
      cfg.root,
      "GET",
      "/api/biz/customer-package-reset/list?targetType=PERSONAL",
      cfg.key,
      15000,
      { rawAuth: cfg.rawAuth, extraHeaders },
    );
    const okCode = listEnv && (listEnv.code === 200 || listEnv.code === 0) && listEnv.success !== false;
    if (!okCode || !listEnv.data) {
      throw new GatewayError(listEnv?.msg || "无法读取智谱重置卡列表", 502);
    }
    const five = (listEnv.data.fiveHourResets || [])
      .filter((x) => x && x.available === true && x.recordId != null)
      .map((x) => ({ ...x, resetType: "FIVE_HOUR", window: "fiveHour" }));
    const week = (listEnv.data.weekResets || [])
      .filter((x) => x && x.available === true && x.recordId != null)
      .map((x) => ({ ...x, resetType: "WEEK", window: "weekly" }));

    let pool = [...week, ...five];
    if (windowKind === "weekly" || windowKind === "WEEK") pool = week;
    else if (windowKind === "fiveHour" || windowKind === "FIVE_HOUR") pool = five;

    if (!pool.length) {
      return { code: "no_credit" };
    }
    // 按过期时间升序，优先选用户指定过期时间的卡或最早过期的一张
    pool.sort((a, b) => (Date.parse(a.expireTime) || Infinity) - (Date.parse(b.expireTime) || Infinity));
    let chosen = pool[0];
    if (expireAt) {
      const targetMs = Date.parse(expireAt);
      const exact = pool.find((x) => x.expireTime === expireAt || (Number.isFinite(targetMs) && Math.abs(Date.parse(x.expireTime) - targetMs) < 2000));
      if (exact) chosen = exact;
    }

    const useEnv = await request(
      cfg.root,
      "POST",
      "/api/biz/customer-package-reset/use",
      cfg.key,
      20000,
      {
        rawAuth: cfg.rawAuth,
        extraHeaders,
        jsonBody: {
          targetType: listEnv.data.targetType || "PERSONAL",
          resetType: chosen.resetType,
          recordId: chosen.recordId,
          grantType: chosen.grantType || "DIRECT",
          requestId: crypto.randomUUID(),
        },
      },
    );
    const useOk = useEnv && (useEnv.code === 200 || useEnv.code === 0) && useEnv.success === true;
    if (!useOk) {
      throw new GatewayError(useEnv?.msg || "使用重置卡失败", 502);
    }
    // 智谱后端结算需约 2 秒，等待后触发网关刷新该卡片
    await new Promise((r) => setTimeout(r, 2000));
    try {
      await this.refresh(provider, "");
    } catch {
      /* ignore */
    }
    return { code: "reset", windows: chosen.resetType === "WEEK" ? 2 : 1, resetType: chosen.resetType };
  }

  // 通用重置卡入口：根据 provider / byWindow 自动分发
  async useReset({ provider = "codex", user = "", credit = "", window: windowKind = "", until = "", byWindow = false } = {}) {
    if (byWindow || (provider && provider !== "codex" && !provider.endsWith("/codex") && !user)) {
      return this.zhipuReset(provider, windowKind, until);
    }
    if (provider && provider.includes("/")) {
      return this.remoteCodexReset(provider, user, credit);
    }
    if (!provider || provider === "codex") {
      return this.codexReset(user, credit);
    }
    // 先尝试是否为智谱套餐，否则回退网关接口
    const p = readProviders().find((x) => x && x.id === provider);
    if (zhipuConfigOf(p)) {
      return this.zhipuReset(provider, windowKind, until);
    }
    return this.codexReset(user || provider, credit);
  }

  async history(days = 2) {
    const d = Math.min(Math.max(Number(days) || 2, 1), 45);
    const body = await this.call("GET", "/v1/magpie/quotas/history?days=" + d, { timeoutMs: 15000 });
    return Array.isArray(body?.data) ? body.data : [];
  }
}
