// magpie 网关客户端：读额度卡片、刷新、使用 Codex 重置卡。
//
// 只走回环地址上的网关（插件宿主与网关在同一台机器 / 同一个容器里）。
// 用 node:http 直连，不用宿主改造过的 fetch —— 后者会按 MAGPIE_*_PROXY
// 走代理，对 127.0.0.1 没有意义。
//
// 网关 key：使用重置卡（POST /v1/magpie/quotas/codex-reset）即使从本机发起
// 也必须带「满权限」的网关 key（magpie 源码 gateway.go codexReset）。
// 优先用插件选项 gatewayKey；否则读 magpie 配置目录里的 caller-keys.json，
// 选第一把启用的、非只读、未被限制预算/模型/账户的 key。key 只在本进程内存里
// 使用，绝不出现在任何 HTTP 响应、页面或日志里。

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

// request 发一个网关请求，返回解析后的 JSON。
function request(base, method, pathAndQuery, key, timeoutMs) {
  const u = new URL(base + pathAndQuery);
  const mod = u.protocol === "https:" ? https : http;
  const headers = { accept: "application/json", "user-agent": "magpie-page-credentials" };
  if (key) headers.authorization = "Bearer " + key;
  if (method !== "GET") headers["content-length"] = "0";
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
          const msg = body?.error?.message || text.slice(0, 300) || `HTTP ${res.statusCode}`;
          reject(new GatewayError(msg, res.statusCode, body?.error?.type || body?.error?.code || ""));
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new GatewayError(`网关在 ${Math.round(timeoutMs / 1000)} 秒内没有回应`, 504, "timeout")));
    req.on("error", (e) => reject(e instanceof GatewayError ? e : new GatewayError(`连不上网关 ${base}：${e.code || e.message}`, 502, "unreachable")));
    req.end();
  });
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

  async history(days = 2) {
    const d = Math.min(Math.max(Number(days) || 2, 1), 45);
    const body = await this.call("GET", "/v1/magpie/quotas/history?days=" + d, { timeoutMs: 15000 });
    return Array.isArray(body?.data) ? body.data : [];
  }
}
