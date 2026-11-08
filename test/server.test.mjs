import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { gatewayBase, isFullKey, pickKeys } from "../lib/gateway.mjs";
import { createApp } from "../lib/server.mjs";
import { sameSecret } from "../lib/session.mjs";

// ---- 网关 key 与地址 --------------------------------------------------------

test("only enabled, unrestricted keys can spend resets", () => {
  const s = "sk-magpie-" + "x".repeat(40);
  assert.equal(isFullKey({ secret: s }), true);
  assert.equal(isFullKey({ secret: s, off: true }), false);
  assert.equal(isFullKey({ secret: s, readOnly: true }), false);
  assert.equal(isFullKey({ secret: s, limit: { tokens: 1 } }), false);
  assert.equal(isFullKey({ secret: s, models: ["a/b"] }), false);
  assert.equal(isFullKey({ secret: s, accounts: ["codex/x"] }), false);
  assert.equal(isFullKey({ masked: "sk-…" }), false);
  const picked = pickKeys([
    { id: "1", name: "ro", secret: s + "1", readOnly: true },
    { id: "2", name: "full", secret: s + "2" },
    { id: "3", name: "lan", secret: s + "3", lan: true },
    { id: "4", name: "off", secret: s + "4", off: true },
  ]);
  assert.deepEqual(picked.map((k) => [k.name, k.full]), [["lan", true], ["full", true], ["ro", false]]);
});

test("gateway address", () => {
  assert.equal(gatewayBase("", {}), "http://127.0.0.1:3425");
  assert.equal(gatewayBase("", { MAGPIE_ADDR: "0.0.0.0:3425" }), "http://127.0.0.1:3425");
  assert.equal(gatewayBase("", { MAGPIE_ADDR: "127.0.0.1:9000", MAGPIE_TLS_CERT: "c", MAGPIE_TLS_KEY: "k" }), "https://127.0.0.1:9000");
  assert.equal(gatewayBase("http://127.0.0.1:43425/", {}), "http://127.0.0.1:43425");
  assert.equal(gatewayBase("127.0.0.1:5000", {}), "http://127.0.0.1:5000");
});

test("secret comparison", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("", ""), false);
  assert.equal(sameSecret("abc", "abcd"), false);
});

// ---- 服务：用假网关跑一遍 ----------------------------------------------------

const KEY = "sk-magpie-test-" + "k".repeat(30);
const asked = [];
let fake, app, appPort;

function listen(server) {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
}

before(async () => {
  fake = http.createServer((req, res) => {
    asked.push({ method: req.method, url: req.url, auth: req.headers.authorization || "" });
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer " + KEY) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { message: "no key", type: "authentication_error" } }));
    }
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/v1/magpie/quotas/cards" || u.pathname === "/v1/magpie/quotas/refresh") {
      return res.end(JSON.stringify({ data: [{ provider: "codex", user: "a@example.com", windows: [{ name: "7 days", used: 100 }] }] }));
    }
    if (u.pathname === "/v1/magpie/quotas/codex-reset") {
      return res.end(JSON.stringify({ code: "reset", windows: 1, user: u.searchParams.get("user"), credit: u.searchParams.get("credit") }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  const fakePort = await listen(fake);
  const server = http.createServer();
  appPort = await listen(server);
  const handle = createApp({ port: appPort, options: { gatewayUrl: "http://127.0.0.1:" + fakePort, gatewayKey: KEY }, secret: "s3cret-value" });
  server.on("request", (req, res) => handle(req, res));
  app = server;
});

after(() => {
  app.close();
  fake.close();
});

function call(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: appPort, method, path, headers: { host: "127.0.0.1:" + appPort, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) {
      req.setHeader("content-type", "application/json");
      req.end(JSON.stringify(body));
    } else req.end();
  });
}

const auth = { "x-cred-session": "s3cret-value" };

test("api needs the session secret", async () => {
  const r = await call("GET", "/api/state");
  assert.equal(r.status, 401);
  assert.equal(r.json.type, "session");
  const ok = await call("GET", "/api/state", { headers: auth });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.cards.length, 1);
  assert.equal(ok.headers["access-control-allow-origin"], "*");
  assert.ok(!ok.text.includes(KEY), "the gateway key never leaves the service");
});

test("foreign origins and rebound hosts are refused", async () => {
  const evil = await call("GET", "/api/state", { headers: { ...auth, origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  const sandboxed = await call("GET", "/api/state", { headers: { ...auth, origin: "null" } });
  assert.equal(sandboxed.status, 200);
  const rebound = await call("GET", "/", { headers: { host: "evil.example:" + appPort } });
  assert.equal(rebound.status, 421);
});

test("preflight and static page", async () => {
  const pre = await call("OPTIONS", "/api/reset", { headers: { origin: "null" } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers["access-control-allow-headers"], /x-cred-session/);
  const page = await call("GET", "/");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-security-policy"], /connect-src 'self' http:\/\/127\.0\.0\.1:\d+/);
  const traversal = await call("GET", "/../package.json");
  assert.equal(traversal.status, 404);
});

test("reset passes user and credit to the gateway with the key", async () => {
  asked.length = 0;
  const r = await call("POST", "/api/reset", { headers: auth, body: { user: "a@example.com", credit: "RateLimitResetCredit_x" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.outcome.code, "reset");
  const reset = asked.find((a) => a.url.startsWith("/v1/magpie/quotas/codex-reset"));
  assert.ok(reset);
  assert.equal(reset.method, "POST");
  assert.equal(reset.auth, "Bearer " + KEY);
  assert.equal(new URL(reset.url, "http://x").searchParams.get("user"), "a@example.com");
  assert.equal(new URL(reset.url, "http://x").searchParams.get("credit"), "RateLimitResetCredit_x");
});

test("reset refuses remote cards and bad input", async () => {
  const remote = await call("POST", "/api/reset", { headers: auth, body: { user: "a@example.com", provider: "office/codex" } });
  assert.equal(remote.status, 400);
  const noUser = await call("POST", "/api/reset", { headers: auth, body: {} });
  assert.equal(noUser.status, 400);
  const badCredit = await call("POST", "/api/reset", { headers: auth, body: { user: "a@example.com", credit: "x y" } });
  assert.equal(badCredit.status, 400);
});

test("refresh names the card", async () => {
  asked.length = 0;
  const r = await call("POST", "/api/refresh", { headers: auth, body: { provider: "codex", user: "a@example.com" } });
  assert.equal(r.status, 200);
  const q = new URL(asked.find((a) => a.url.startsWith("/v1/magpie/quotas/refresh")).url, "http://x").searchParams;
  assert.equal(q.get("provider"), "codex");
  assert.equal(q.get("user"), "a@example.com");
  const remote = await call("POST", "/api/refresh", { headers: auth, body: { provider: "office/codex" } });
  assert.equal(remote.status, 400);
});
