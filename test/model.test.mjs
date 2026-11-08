import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const ctx = {};
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(new URL("../app/model.js", import.meta.url), "utf8"), ctx);
const M = ctx.CredModel;

const NOW = Date.parse("2026-11-09T00:30:00+08:00");
const iso = (ms) => new Date(NOW + ms).toISOString();

const codexTeam = {
  provider: "codex",
  name: "Codex",
  plan: "team",
  user: "a@example.com · Team · 1e3dc86e",
  held: true,
  windows: [
    { name: "5 hours", used: 0, resetsAt: iso(5 * 3600e3) },
    { name: "7 days", used: 100, resetsAt: iso(3 * 86400e3) },
  ],
  resets: {
    count: 2,
    until: "2026-11-30T19:54:05Z",
    each: [
      { until: "2026-12-01T22:28:57Z", id: "RateLimitResetCredit_b" },
      { until: "2026-11-30T19:54:05Z", id: "RateLimitResetCredit_a" },
    ],
  },
};

const claude = {
  provider: "claude",
  name: "Claude Code",
  plan: "pro",
  user: "c@example.com",
  windows: [
    { name: "5 hours", used: 70, resetsAt: iso(4 * 3600e3) },
    { name: "7 days", used: 10, resetsAt: iso(6 * 86400e3) },
  ],
};

const antigravity = {
  provider: "antigravity",
  name: "Antigravity",
  user: "g@example.com",
  windows: [
    { name: "Claude Opus 5.5 (High)", used: 100, resetsAt: iso(86400e3), family: "Claude" },
    { name: "Claude Opus 5.5 (Low)", used: 100, resetsAt: iso(86400e3), family: "Claude" },
    { name: "Gemini 4 Argon (High)", used: 9.8, resetsAt: iso(3600e3), family: "Gemini", pool: "Gemini" },
    { name: "7 days", used: 24, resetsAt: iso(5 * 86400e3), pool: "Gemini" },
    { name: "5 hours", used: 9.8, resetsAt: iso(3600e3), pool: "Gemini" },
    { name: "7 days", used: 100, resetsAt: iso(86400e3), pool: "Claude & GPT" },
  ],
};

test("window labels and lengths", () => {
  assert.equal(M.windowLabel("5 hours"), "5 小时");
  assert.equal(M.windowLabel("7 days"), "7 天");
  assert.equal(M.windowLabel("Total credits"), "总积分");
  assert.equal(M.windowLabel("MCP · Month"), "MCP · 月");
  assert.equal(M.windowLabel("deepseek-v4.1-flash tokens (est.)"), "deepseek-v4.1-flash（估）");
  assert.equal(M.windowSeconds("5 hours"), 18000);
  assert.equal(M.windowSeconds("7 days"), 604800);
  assert.equal(M.windowSeconds("Credits"), 0);
});

test("remaining, level and pace", () => {
  assert.equal(M.remainingOf({ used: 70 }), 30);
  assert.equal(M.remainingOf({ used: 140 }), 0);
  assert.equal(M.remainingOf({ unlimited: true, used: 50 }), 100);
  assert.equal(M.level(0), "out");
  assert.equal(M.level(10), "low");
  assert.equal(M.level(30), "mid");
  assert.equal(M.level(80), "ok");
  // 5 小时窗口还剩 4 小时 → 过去了 20%，已用 70% → 用得快
  const p = M.paceOf(claude.windows[0], NOW);
  assert.ok(Math.abs(p.elapsed - 0.2) < 1e-9);
  assert.ok(p.ahead > 0.4);
  assert.equal(M.paceOf({ name: "Credits", used: 10, resetsAt: iso(1000) }, NOW), null);
});

test("card status, availability and sorting", () => {
  assert.equal(M.cardStatus(codexTeam), "out");
  assert.equal(M.cardStatus(claude), "ok");
  assert.equal(M.cardStatus({ ...claude, held: true }), "held");
  assert.equal(M.cardStatus({ provider: "x", balance: "$3", windows: [] }), "info");
  assert.equal(M.cardStatus({ ...claude, error: "boom" }), "error");
  assert.equal(M.availableAt(codexTeam), Date.parse(codexTeam.windows[1].resetsAt));
  const sorted = M.sortCards([codexTeam, claude], "status", NOW);
  assert.equal(sorted[0], claude, "usable accounts first");
  assert.equal(M.sortCards([claude, codexTeam], "risk", NOW)[0], codexTeam);
});

test("reset cards are ordered by expiry and supported across local services", () => {
  const rc = M.resetCards(codexTeam);
  assert.deepEqual([...rc.map((x) => x.id)], ["RateLimitResetCredit_a", "RateLimitResetCredit_b"]);
  assert.equal(M.canUseReset(codexTeam), true);
  const glmPlan = {
    provider: "andy",
    name: "glm",
    icon: "zhipu-color",
    kind: "plan",
    windows: [
      { name: "5 hours", used: 0 },
      { name: "7 days", used: 4, resetsAt: iso(5 * 86400e3) },
      { name: "MCP · Month", used: 100, resetsAt: iso(8 * 86400e3) },
    ],
    resets: { count: 1, byWindow: true, weekly: 1, each: [{ until: "2026-12-22T23:59:59+08:00", window: "weekly" }] },
  };
  assert.equal(M.canUseReset(glmPlan), true);
  assert.equal(M.cardStatus(glmPlan), "ok", "aside MCP window does not mark GLM plan exhausted");
  assert.equal(M.providerMeta(glmPlan).icon, "zhipu-color");
  assert.equal(M.providerMeta(codexTeam).icon, "codex-color");
  assert.equal(M.providerMeta(claude).icon, "claude-color");
  assert.equal(M.groupKey({ provider: "newapikr", kind: "balance", balance: "$-10" }), "kind:balance");
  assert.equal(M.canUseReset({ ...codexTeam, provider: "office/codex" }), false);
  assert.equal(M.canUseReset({ ...codexTeam, from: "office" }), false);
  assert.equal(M.canUseReset(claude), false);
});

test("antigravity windows group by pool and merge model variants", () => {
  const g = M.groupWindows(antigravity);
  assert.deepEqual([...g.map((x) => x.title)], ["Gemini", "Claude & GPT", "模型明细"]);
  assert.deepEqual([...g[0].items.map((x) => x.w.name)], ["5 hours", "7 days"]);
  const models = g[2];
  assert.equal(models.collapsed, true);
  assert.equal(models.items.length, 2);
  assert.equal(models.items[0].label, "Claude Opus 5.5 · High/Low");
  // 状态只看池子级窗口：Claude & GPT 7 天用完 → out
  assert.equal(M.cardStatus(antigravity), "out");
});

test("summary counts", () => {
  const s = M.summary([codexTeam, claude, antigravity], NOW);
  assert.equal(s.total, 3);
  assert.equal(s.ok, 1);
  assert.equal(s.out, 2);
  assert.equal(s.resets, 2);
  assert.equal(s.soonestResetCard.at, Date.parse("2026-11-30T19:54:05Z"));
  assert.ok(s.nextReset.at > NOW);
});

test("splitUser and search", () => {
  assert.deepEqual({ ...M.splitUser(codexTeam) }, { main: "a@example.com", rest: "Team · 1e3dc86e" });
  assert.deepEqual({ ...M.splitUser({ alias: "work", user: "a@b.c" }) }, { main: "work", rest: "a@b.c" });
  const up = M.userParts(codexTeam);
  assert.equal(up.main, "a@example.com");
  assert.deepEqual([...up.badges], ["1e3dc86e"]);
  assert.equal(up.rest, "");
  assert.equal(M.matches(codexTeam, "1E3DC"), true);
  assert.equal(M.matches(codexTeam, "nope"), false);
});

test("formatting", () => {
  assert.equal(M.fmtDuration(90), "1 分 30 秒");
  assert.equal(M.fmtDuration(2 * 3600 + 25 * 60), "2 小时 25 分");
  assert.equal(M.fmtDuration(3 * 86400 + 4 * 3600), "3 天 4 小时");
  assert.equal(M.fmtPct(0.4), "0.4%");
  assert.equal(M.fmtPct(99.97), "100%");
  assert.equal(M.resetOutcome({ code: "reset", windows: 2 }), "已重置 2 个窗口");
  assert.equal(M.resetOutcome({ code: "no_credit" }), "这个账户已经没有重置卡了");
  assert.equal(M.resetOutcome({ code: "weird" }), "weird");
});
