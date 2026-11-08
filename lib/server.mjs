// 本地服务：托管额度看板（app/）并把页面的操作转给 magpie 网关。
//
// 访问路径：
//   - magpie web（浏览器）：magpie 把 /_magpie/plugin/<token>/_magpie/service/ 反代到这里；
//   - 桌面窗口：入口页直接跳到 http://127.0.0.1:<port>/。
// 两种情况下页面都在 sandbox="allow-scripts" 的 iframe 里（opaque origin），
// 所以 /api 回 Access-Control-Allow-Origin: *，并且只认带会话密钥的请求（session.mjs）。

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Gateway, GatewayError } from "./gateway.mjs";
import { newSecret, removeSession, sameSecret, sweep, writeSession } from "./session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT, "app");
const SESSION_DIR = path.join(ROOT, "page", "session");
export const DEFAULT_PORT = 4396;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

export function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function portOf(options) {
  const n = Number(options?.port);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_PORT;
}

// 偏好（筛选、排序、视图）：放在 magpie 配置目录的 plugin-work 下，插件升级不丢。
function prefsFile() {
  const base = fs.existsSync(path.join(process.cwd(), "settings.json")) ? path.join(process.cwd(), "plugin-work") : os.tmpdir();
  return path.join(base, "magpie-page-credentials", "prefs.json");
}

function readPrefs() {
  try {
    const v = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writePrefs(v) {
  const f = prefsFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + ".tmp", JSON.stringify(v));
  fs.renameSync(f + ".tmp", f);
}

function policy(port) {
  // 'self' 在 WebKit 的沙箱帧里什么也不匹配，所以把服务自己的地址也写上；
  // 经 magpie web 反代时，magpie 会把 'self' 换成服务的根路径（serviceSelf）。
  const own = `'self' http://127.0.0.1:${port} http://localhost:${port}`;
  return [
    "default-src 'none'",
    `script-src ${own}`,
    `style-src ${own} 'unsafe-inline'`,
    `img-src ${own} data:`,
    `font-src ${own}`,
    `connect-src ${own}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, {
    "content-length": buf.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  });
  res.end(buf);
}

function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
}

function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("请求体太大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text);
        resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {});
      } catch {
        reject(new Error("请求体不是 JSON"));
      }
    });
    req.on("error", reject);
  });
}

const str = (v, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function createApp({ port, options = {}, secret, log = () => {} }) {
  const gateway = new Gateway(options);
  const resetting = new Set();
  let cache = { at: 0, cards: null };
  let histCache = { at: 0, days: 0, data: null };

  async function cards(force = false) {
    if (!force && cache.cards && Date.now() - cache.at < 3000) return cache.cards;
    const c = await gateway.cards();
    cache = { at: Date.now(), cards: c };
    return c;
  }

  function fail(res, e) {
    const status = e instanceof GatewayError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 500;
    sendJSON(res, status, { ok: false, error: String(e?.message || e), type: e?.type || "" });
  }

  async function api(req, res, route) {
    if (route === "GET /api/state") {
      const list = await cards(new URL(req.url, "http://x").searchParams.has("fresh"));
      return sendJSON(res, 200, { ok: true, version: version(), now: new Date().toISOString(), who: gateway.who(), cards: list });
    }
    if (route === "POST /api/refresh") {
      const b = await readBody(req);
      const provider = str(b.provider, 120);
      const user = str(b.user, 300);
      if (provider.includes("/")) {
        return sendJSON(res, 400, { ok: false, error: "这张卡片来自另一台 magpie，只能在那台机器上刷新" });
      }
      const fresh = await gateway.refresh(provider, user);
      const list = fresh || (await cards(true));
      cache = { at: Date.now(), cards: list };
      return sendJSON(res, 200, { ok: true, now: new Date().toISOString(), who: gateway.who(), cards: list });
    }
    if (route === "POST /api/reset") {
      const b = await readBody(req);
      const user = str(b.user, 300);
      const credit = str(b.credit, 200);
      const provider = str(b.provider, 120);
      const windowKind = str(b.window, 40);
      const until = str(b.until, 64);
      const byWindow = !!b.byWindow;
      if (!user && !(byWindow && provider)) return sendJSON(res, 400, { ok: false, error: "缺少账户或服务标识" });
      if (credit && !/^[A-Za-z0-9_.:-]{1,200}$/.test(credit)) return sendJSON(res, 400, { ok: false, error: "重置卡 id 不对" });
      if (windowKind && !/^[A-Za-z0-9_-]{1,40}$/.test(windowKind)) return sendJSON(res, 400, { ok: false, error: "重置卡窗口类型不对" });
      const k = ((provider || "codex") + "|" + user).toLowerCase();
      if (resetting.has(k)) return sendJSON(res, 409, { ok: false, error: "这个账户的重置卡正在使用中，请稍候刷新查看结果" });
      resetting.add(k);
      try {
        log(`reset asked for ${provider || "codex"} ${user}${credit ? " (" + credit + ")" : ""}${windowKind ? " [" + windowKind + "]" : ""}`);
        const out = await gateway.useReset({ provider: provider || "codex", user, credit, window: windowKind, until, byWindow });
        let list = null;
        try {
          list = await cards(true);
        } catch {
          list = null;
        }
        return sendJSON(res, 200, { ok: true, outcome: out || {}, now: new Date().toISOString(), cards: list });
      } finally {
        resetting.delete(k);
      }
    }
    if (route === "GET /api/history") {
      const days = Math.min(Math.max(Number(new URL(req.url, "http://x").searchParams.get("days")) || 2, 1), 45);
      if (!histCache.data || histCache.days !== days || Date.now() - histCache.at > 60000) {
        histCache = { at: Date.now(), days, data: await gateway.history(days) };
      }
      return sendJSON(res, 200, { ok: true, days, data: histCache.data });
    }
    if (route === "GET /api/prefs") return sendJSON(res, 200, { ok: true, prefs: readPrefs() });
    if (route === "POST /api/prefs") {
      const b = await readBody(req, 4096);
      const prefs = b.prefs && typeof b.prefs === "object" && !Array.isArray(b.prefs) ? b.prefs : {};
      writePrefs(prefs);
      return sendJSON(res, 200, { ok: true, prefs });
    }
    return sendJSON(res, 404, { ok: false, error: "没有这个接口" });
  }

  function serveStatic(res, rel) {
    if (rel === "" || rel === "index.html") rel = "index.html";
    let f = "";
    let isIcon = false;
    if (/^icons\/[a-z0-9._-]+$/i.test(rel)) {
      f = path.join(APP_DIR, rel);
      isIcon = true;
    } else if (/^user-icons\/[a-z0-9._-]+$/i.test(rel)) {
      const name = rel.slice("user-icons/".length);
      const base = fs.existsSync(path.join(process.cwd(), "settings.json"))
        ? process.cwd()
        : path.join(os.homedir(), ".config", "magpie");
      f = path.join(base, "icons", name);
      isIcon = true;
    } else if (/^[a-z0-9._-]+$/i.test(rel)) {
      f = path.join(APP_DIR, rel);
    } else {
      return send(res, 404, "not found", { "content-type": "text/plain" });
    }
    let buf;
    try {
      buf = fs.readFileSync(f);
    } catch {
      return send(res, 404, "not found", { "content-type": "text/plain" });
    }
    const type = TYPES[path.extname(f).toLowerCase()] || "application/octet-stream";
    const headers = {
      "content-type": type,
      "cache-control": isIcon ? "max-age=3600" : "no-cache",
    };
    if (type.startsWith("text/html")) headers["content-security-policy"] = policy(port);
    return send(res, 200, buf, headers);
  }

  return async function handle(req, res) {
    // 防 DNS 重绑定：只认回环地址的 Host
    const host = String(req.headers.host || "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, "wrong host", { "content-type": "text/plain" });
    // 沙箱帧发的是 Origin: null；直接在浏览器里打开（开发预览）时是服务自己的地址
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== "null" && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      return sendJSON(res, 403, { ok: false, error: "只有本插件的页面可以访问这个服务" });
    }

    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    if (!p.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
      return serveStatic(res, p.replace(/^\/+/, ""));
    }
    if (req.method === "OPTIONS") {
      return send(res, 204, "", {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "content-type, x-cred-session",
        "access-control-max-age": "600",
      });
    }
    if (!sameSecret(String(req.headers["x-cred-session"] || ""), secret)) {
      return sendJSON(res, 401, { ok: false, error: "会话已失效（插件服务重启过），请重新打开本页", type: "session" });
    }
    try {
      await api(req, res, `${req.method} ${p}`);
    } catch (e) {
      fail(res, e);
    }
  };
}

// start 在 port 上监听；端口被占（例如另一个 magpie 进程的宿主）时每 3 秒重试。
export function start(options = {}, log = (m) => console.error("[credentials] " + m)) {
  const port = portOf(options);
  const secret = newSecret();
  const handle = createApp({ port, options, secret, log });
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      try {
        sendJSON(res, 500, { ok: false, error: String(e?.message || e) });
      } catch {
        /* 连接已断 */
      }
    });
  });
  server.requestTimeout = 120000;
  let timer = null;
  let closed = false;
  const state = { port, listening: false, sessionError: "" };

  const tryListen = () => {
    if (closed) return;
    server.once("error", (e) => {
      if (closed) return;
      if (e.code !== "EADDRINUSE" && e.code !== "EACCES") log(`listen ${port}: ${e.message}`);
      timer = setTimeout(tryListen, 3000);
      timer.unref?.();
    });
    server.listen(port, "127.0.0.1", () => {
      state.listening = true;
      server.removeAllListeners("error");
      server.on("error", (e) => log(`server: ${e.message}`));
      sweep(SESSION_DIR, port);
      state.sessionError = writeSession(SESSION_DIR, port, secret);
      if (state.sessionError) log(`can't write the page session file: ${state.sessionError}`);
    });
  };
  tryListen();
  server.unref?.();

  const cleanup = () => removeSession(SESSION_DIR, port, secret);
  process.once("exit", cleanup);

  return {
    state,
    close() {
      closed = true;
      clearTimeout(timer);
      process.removeListener("exit", cleanup);
      if (state.listening) cleanup();
      return new Promise((r) => server.close(() => r()));
    },
  };
}
