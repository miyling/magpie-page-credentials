// 纯数据逻辑（不碰 DOM），浏览器里挂在 window.CredModel，测试里用 vm 加载。
(function (root) {
  "use strict";

  var PROVIDERS = {
    claude: { name: "Claude", color: "#d97757", icon: "claude-color" },
    anthropic: { name: "Claude", color: "#d97757", icon: "claude-color" },
    claudecode: { name: "Claude Code", color: "#d97757", icon: "claudecode-color" },
    codex: { name: "Codex", color: "#10a37f", icon: "codex-color" },
    openai: { name: "OpenAI", color: "#10a37f", icon: "openai" },
    antigravity: { name: "Antigravity", color: "#4285f4", icon: "antigravity-color" },
    gemini: { name: "Gemini", color: "#8e75f0", icon: "gemini-color" },
    geminicli: { name: "Gemini", color: "#8e75f0", icon: "geminicli-color" },
    "gemini-cli": { name: "Gemini CLI", color: "#8e75f0", icon: "geminicli-color" },
    google: { name: "Google", color: "#4285f4", icon: "google-color" },
    vertexai: { name: "Vertex AI", color: "#4285f4", icon: "vertexai-color" },
    copilot: { name: "Copilot", color: "#8250df", icon: "githubcopilot" },
    githubcopilot: { name: "Copilot", color: "#8250df", icon: "githubcopilot" },
    workbuddy: { name: "WorkBuddy", color: "#2f6bff", icon: "workbuddy-color" },
    codebuddy: { name: "CodeBuddy", color: "#2f6bff", icon: "codebuddy-color" },
    zhipu: { name: "GLM", color: "#3b6cf6", icon: "zhipu-color" },
    chatglm: { name: "GLM", color: "#3b6cf6", icon: "zhipu-color" },
    glm: { name: "GLM", color: "#3b6cf6", icon: "zhipu-color" },
    zai: { name: "Z.ai", color: "#3b6cf6", icon: "zai" },
    deepseek: { name: "DeepSeek", color: "#4d6bfe", icon: "deepseek-color" },
    minimax: { name: "MiniMax", color: "#f43f5e", icon: "minimax-color" },
    "minimax-cn": { name: "MiniMax", color: "#f43f5e", icon: "minimax-color" },
    stepfun: { name: "StepFun", color: "#0066ff", icon: "stepfun-color" },
    "stepfun-cn": { name: "StepFun", color: "#0066ff", icon: "stepfun-color" },
    kimi: { name: "Kimi", color: "#6366f1", icon: "kimi" },
    moonshot: { name: "Kimi", color: "#6366f1", icon: "kimi" },
    "kimi-code": { name: "Kimi Code", color: "#6366f1", icon: "kimi" },
    "kimi-code-cn": { name: "Kimi Code", color: "#6366f1", icon: "kimi" },
    qwen: { name: "Qwen", color: "#615ced", icon: "qwen-color" },
    "qwen-cn": { name: "Qwen", color: "#615ced", icon: "qwen-color" },
    bailian: { name: "Bailian", color: "#615ced", icon: "bailian-color" },
    newapi: { name: "New API", color: "#0ea5e9", icon: "newapi-color" },
    oneapi: { name: "One API", color: "#0ea5e9", icon: "oneapi" },
    veloera: { name: "Veloera", color: "#0ea5e9", icon: "veloera" },
    openrouter: { name: "OpenRouter", color: "#6366f1", icon: "openrouter" },
    siliconcloud: { name: "SiliconFlow", color: "#7c3aed", icon: "siliconcloud-color" },
    volcengine: { name: "Volcengine", color: "#3b82f6", icon: "volcengine-color" },
    doubao: { name: "Doubao", color: "#3b82f6", icon: "doubao-color" },
    kiro: { name: "Kiro", color: "#7b61ff", icon: "kiro-color" },
    cursor: { name: "Cursor", color: "#6b7280", icon: "cursor" },
    factory: { name: "Factory", color: "#f97316", icon: "factory" },
    qoder: { name: "Qoder", color: "#14b8a6", icon: "qoder" },
    trae: { name: "Trae", color: "#ef4444", icon: "trae-color" },
    windsurf: { name: "Windsurf", color: "#06b6d4", icon: "windsurf" },
    groq: { name: "Groq", color: "#f55036", icon: "groq" },
    xai: { name: "xAI", color: "#6b7280", icon: "xai" },
    grok: { name: "Grok", color: "#6b7280", icon: "grok" },
    mistral: { name: "Mistral", color: "#f97316", icon: "mistral-color" },
    magpie: { name: "Magpie", color: "#3b6cf6", icon: "magpie" },
  };

  function hue(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  // 远程 magpie 的卡片 provider 形如 "office/codex"
  function baseProvider(id) {
    id = String(id || "");
    var i = id.lastIndexOf("/");
    return i >= 0 ? id.slice(i + 1) : id;
  }

  function iconKey(icon) {
    return String(icon || "").toLowerCase().replace(/-color$/, "");
  }

  function resolveIcon(rawIcon, id, name) {
    var raw = String(rawIcon || "").trim();
    if (raw.indexOf("file:") === 0) return raw;
    var lowId = String(id || "").toLowerCase();
    var mId = PROVIDERS[lowId] || PROVIDERS[lowId.split("-")[0]];
    if (raw && raw !== "magpie") {
      if (PROVIDERS[raw] && PROVIDERS[raw].icon) return PROVIDERS[raw].icon;
      return raw;
    }
    if (mId && mId.icon) return mId.icon;
    var lowName = String(name || "").toLowerCase();
    if (PROVIDERS[lowName] && PROVIDERS[lowName].icon) return PROVIDERS[lowName].icon;
    return raw || "";
  }

  function providerMeta(card) {
    var id = baseProvider(card.provider);
    var m = PROVIDERS[id];
    var icon = resolveIcon(card.icon, id, card.name);
    if (m) return { id: id, name: m.name, color: m.color, icon: icon || m.icon };
    var ik = iconKey(card.icon);
    var im = PROVIDERS[ik];
    var name = card.name || (im && im.name) || id || "?";
    var color = im ? im.color : "hsl(" + hue(id || name) + " 55% 50%)";
    return { id: id, name: name, color: color, icon: icon || (im && im.icon) || "" };
  }

  function isBalanceCard(card) {
    if (!card) return false;
    if (card.kind === "balance") return true;
    var ws = Array.isArray(card.windows) ? card.windows : [];
    return !ws.length && !!(card.balance || card.sharedBalance);
  }

  // groupKey：将零散的纯余额 key 归入 "kind:balance"（API 余额），订阅/套餐按服务归组
  function groupKey(card) {
    if (isBalanceCard(card)) return "kind:balance";
    return String(card.provider || "");
  }

  function groupMeta(key, cards) {
    var list = Array.isArray(cards) ? cards : [];
    if (key === "kind:balance") {
      var icons = [];
      list.forEach(function (c) {
        var ic = providerMeta(c).icon;
        if (ic && icons.indexOf(ic) < 0) icons.push(ic);
      });
      return {
        key: key,
        name: "API 余额",
        color: "#0ea5e9",
        icon: icons[0] || "newapi-color",
        icons: icons.length ? icons : ["newapi-color"],
        isBalanceGroup: true,
      };
    }
    var first = list[0];
    var m = first ? providerMeta(first) : { name: key, color: "#6b7280", icon: "" };
    return {
      key: key,
      name: m.name + (first && first.from ? " · " + first.from : ""),
      color: m.color,
      icon: m.icon || "",
      icons: m.icon ? [m.icon] : [],
      isBalanceGroup: false,
    };
  }

  // ---- 窗口 -------------------------------------------------------------------

  var WORDS = {
    credits: "积分", "extra credits": "额外积分", "total credits": "总积分",
    "extra usage": "额外用量", "on-demand": "按量计费",
    month: "月", week: "周", day: "天", daily: "每日", weekly: "每周", monthly: "每月",
    requests: "请求", premium: "高级请求", tokens: "tokens",
  };

  function windowLabel(name) {
    var s = String(name || "").trim();
    var m = /^(\d+(?:\.\d+)?)\s*(hours?|h|days?|d|minutes?|min|weeks?)$/i.exec(s);
    if (m) {
      var u = m[2].toLowerCase();
      var unit = /^h/.test(u) ? " 小时" : /^d/.test(u) ? " 天" : /^w/.test(u) ? " 周" : " 分钟";
      return m[1] + unit;
    }
    var lower = s.toLowerCase();
    if (WORDS[lower]) return WORDS[lower];
    return s
      .replace(/\s+tokens\s*\(est\.\)/i, "（估）")
      .replace(/\bMonth\b/g, "月")
      .replace(/\bWeek\b/g, "周")
      .replace(/\bDay\b/g, "天")
      .replace(/\(est\.\)/g, "（估）");
  }

  // windowSeconds：窗口长度（秒），从名字推断；不知道返回 0
  function windowSeconds(name) {
    var s = String(name || "").toLowerCase().trim();
    var m = /^(\d+(?:\.\d+)?)\s*(hours?|h)$/.exec(s);
    if (m) return Number(m[1]) * 3600;
    m = /^(\d+(?:\.\d+)?)\s*(days?|d)$/.exec(s);
    if (m) return Number(m[1]) * 86400;
    m = /^(\d+(?:\.\d+)?)\s*(minutes?|min)$/.exec(s);
    if (m) return Number(m[1]) * 60;
    if (/(^|\W)(week|weekly)$/.test(s)) return 7 * 86400;
    if (/(^|\W)(day|daily)$/.test(s)) return 86400;
    return 0;
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function usedOf(w) {
    if (w.unlimited) return 0;
    var u = Number(w.used);
    return Number.isFinite(u) ? clamp(u, 0, 100) : 0;
  }

  function remainingOf(w) {
    if (w.unlimited) return 100;
    return clamp(100 - usedOf(w), 0, 100);
  }

  // level：剩余越少越严重
  function level(remaining) {
    if (remaining <= 0.5) return "out";
    if (remaining < 20) return "low";
    if (remaining < 50) return "mid";
    return "ok";
  }

  function time(v) {
    if (!v) return NaN;
    var t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
  }

  // pace：窗口时间过去了多少 vs 用量用掉了多少。
  // elapsed / used 都是 0..1；ahead > 0 表示用得比时间快。
  function paceOf(w, now) {
    var end = time(w.resetsAt);
    if (!Number.isFinite(end)) return null;
    var len = windowSeconds(w.name) * 1000;
    var start = time(w.start);
    if (!Number.isFinite(start)) start = len ? end - len : NaN;
    if (!Number.isFinite(start) || end <= start) return null;
    var elapsed = clamp((now - start) / (end - start), 0, 1);
    var used = usedOf(w) / 100;
    return { elapsed: elapsed, used: used, ahead: used - elapsed };
  }

  // isAsideWindow：附加/工具窗口（如智谱的 MCP · Month、按量计费 Extra usage / On-demand，
  // 或存在 Total credits 时的子项 Credits / Extra credits），耗尽时不会阻断主模型对话。
  function isAsideWindow(w, allWindows) {
    if (!w) return false;
    if (w.text) return true;
    var name = String(w.name || "").trim();
    if (/^(mcp\b|extra usage$|on-demand$|video\s*·|image\s*·|free model tokens$|completions$)/i.test(name) || /tokens\s*\(est\.\)/i.test(name)) return true;
    if (/^(credits|extra credits)$/i.test(name) && Array.isArray(allWindows)) {
      var hasTotal = allWindows.some(function (x) { return /^total credits$/i.test(String(x.name || "").trim()); });
      if (hasTotal) return true;
    }
    return false;
  }

  // groupWindows：把窗口分组展示。
  // Antigravity 这类卡片有「池子级」窗口（5 小时 / 7 天，带 pool）和大量「模型级」
  // 窗口（带 family，名字形如 "Claude Opus 5.5 (High)"）：池子级按池分组直接显示，
  // 模型级里用量与重置时间完全相同的合并成一行，整体收进「模型明细」。
  function groupWindows(card) {
    var ws = Array.isArray(card.windows) ? card.windows : [];
    var main = [];
    var pools = {};
    var poolOrder = [];
    var models = [];
    ws.forEach(function (w, i) {
      var item = { w: w, i: i, label: windowLabel(w.name), aside: isAsideWindow(w, ws) };
      if (w.family && !windowSeconds(w.name)) { models.push(item); return; }
      if (w.pool) {
        if (!pools[w.pool]) { pools[w.pool] = []; poolOrder.push(w.pool); }
        pools[w.pool].push(item);
        return;
      }
      main.push(item);
    });
    var groups = [];
    if (main.length) groups.push({ title: "", items: main, collapsed: false });
    // 池子按窗口长度排序（5 小时在 7 天前面）
    poolOrder.forEach(function (p) {
      pools[p].sort(function (a, b) { return (windowSeconds(a.w.name) || 1e12) - (windowSeconds(b.w.name) || 1e12); });
      groups.push({ title: p, items: pools[p], collapsed: false });
    });
    if (models.length) {
      var merged = [];
      var byKey = {};
      models.forEach(function (it) {
        var m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(String(it.w.name || ""));
        var base = m ? m[1] : String(it.w.name || "");
        var key = base + "|" + usedOf(it.w).toFixed(2) + "|" + (it.w.resetsAt || "");
        if (byKey[key]) {
          if (m) byKey[key].variants.push(m[2]);
          return;
        }
        var row = { w: it.w, i: it.i, base: base, variants: m ? [m[2]] : [], label: "", aside: false };
        byKey[key] = row;
        merged.push(row);
      });
      merged.forEach(function (r) {
        r.label = r.variants.length ? r.base + " · " + r.variants.join("/") : r.base;
      });
      groups.push({ title: "模型明细", items: merged, collapsed: groups.length > 0 });
    }
    return groups;
  }

  // 用来判断账户状态的窗口：主模型/池子窗口（排除模型明细与 MCP · Month 等附加项）
  function primaryWindows(card) {
    var ws = Array.isArray(card.windows) ? card.windows : [];
    var nonModel = ws.filter(function (w) { return !(w.family && !windowSeconds(w.name)) && !w.text; });
    var core = nonModel.filter(function (w) { return !isAsideWindow(w, ws); });
    if (core.length) return core;
    return nonModel.length ? nonModel : ws.filter(function (w) { return !w.text; });
  }

  function cardKey(card) {
    return String(card.provider || "") + "|" + String(card.user || "").toLowerCase() + "|" + String(card.name || "");
  }

  // 按独立额度池（pool 或 family）聚合：
  // 同一池内的多个窗口（如 5h 和 7d）共享限制，取最小剩余；
  // 不同池（如 Antigravity 的 Gemini 与 Claude & GPT）彼此独立：
  // 只有所有池子都耗尽时整个账户才算「已耗尽（out）」，若仅部分池子耗尽则账户仍可用。
  function poolStats(card) {
    var ws = primaryWindows(card);
    if (!ws.length) {
      return { pools: [], byKey: {}, outPools: [], okPools: [], minAll: null, minUsable: null, allOut: false, partialOut: false };
    }
    var byKey = {};
    var order = [];
    ws.forEach(function (w) {
      var pk = w.pool || w.family || "__main__";
      if (!byKey[pk]) {
        byKey[pk] = { key: pk, name: w.pool || w.family || "主额度", rem: 100, resetsAt: 0 };
        order.push(pk);
      }
      var r = remainingOf(w);
      if (r < byKey[pk].rem) byKey[pk].rem = r;
      if (r <= 0.5) {
        var rt = time(w.resetsAt);
        if (Number.isFinite(rt) && rt > byKey[pk].resetsAt) byKey[pk].resetsAt = rt;
      }
    });
    var pools = order.map(function (k) { return byKey[k]; });
    var outPools = pools.filter(function (p) { return p.rem <= 0.5; });
    var okPools = pools.filter(function (p) { return p.rem > 0.5; });
    var minAll = 100;
    pools.forEach(function (p) { if (p.rem < minAll) minAll = p.rem; });
    var minUsable = okPools.length ? 100 : 0;
    okPools.forEach(function (p) { if (p.rem < minUsable) minUsable = p.rem; });
    return {
      pools: pools,
      byKey: byKey,
      outPools: outPools,
      okPools: okPools,
      minAll: minAll,
      minUsable: minUsable,
      allOut: pools.length > 0 && outPools.length === pools.length,
      partialOut: outPools.length > 0 && okPools.length > 0,
    };
  }

  function minRemaining(card) {
    var ps = poolStats(card);
    if (!ps.pools.length) return null;
    if (ps.allOut) return ps.minAll;
    return ps.minUsable;
  }

  // cardStatus：error / held / out / low / ok / info（无窗口，如余额卡）
  function cardStatus(card) {
    if (card.error) return "error";
    var ps = poolStats(card);
    if (!ps.pools.length) return card.held ? "held" : "info";
    if (ps.allOut) return "out";
    if (card.held) return "held";
    if (ps.minUsable < 20) return "low";
    return "ok";
  }

  // availableAt：当所有池子都耗尽时，最早恢复可用的池子的重置时刻
  function availableAt(card) {
    var ps = poolStats(card);
    if (!ps.outPools.length) return null;
    var best = Infinity;
    ps.outPools.forEach(function (p) {
      if (p.resetsAt > 0 && p.resetsAt < best) best = p.resetsAt;
    });
    return Number.isFinite(best) ? best : null;
  }

  function nextReset(card, now) {
    var best = null;
    primaryWindows(card).forEach(function (w) {
      var r = time(w.resetsAt);
      if (Number.isFinite(r) && r > now && (best === null || r < best.at)) best = { at: r, w: w };
    });
    return best;
  }

  function resetWindowLabel(w) {
    if (w === "weekly" || w === "WEEK") return "周额度";
    if (w === "fiveHour" || w === "FIVE_HOUR") return "5 小时额度";
    return w ? String(w) : "";
  }

  function resetCards(card) {
    var r = card && card.resets;
    if (!r || !(r.count > 0)) return [];
    var each = Array.isArray(r.each) ? r.each.slice() : [];
    each.sort(function (a, b) { return (time(a.until) || Infinity) - (time(b.until) || Infinity); });
    return each;
  }

  function isRemote(card) {
    return String(card.provider || "").indexOf("/") >= 0 || !!card.from;
  }

  // 支持所有本地拥有重置卡的服务（Codex、智谱 GLM 编码套餐等）
  function canUseReset(card) {
    return !isRemote(card) && !!(card && card.resets && card.resets.count > 0);
  }

  function displayName(card) {
    return card.alias || card.user || card.name || card.provider || "?";
  }

  // splitUser："a@example.com · Team · 1e3dc86e" → { main: "a@example.com", rest: "Team · 1e3dc86e" }
  function splitUser(card) {
    if (card.alias) return { main: card.alias, rest: card.user || "" };
    var u = String(card.user || card.name || card.provider || "?");
    var parts = u.split(" · ");
    return { main: parts[0], rest: parts.slice(1).join(" · ") };
  }

  // userParts：剔除与 plan 重复的段（例如 plan="team" 时不再重复显示 "Team"），
  // 并把短工作空间哈希（如 1e3dc86e）提取为独立 badge，方便多账户一眼区分。
  function userParts(card) {
    var s = splitUser(card);
    var planLower = String(card.plan || "").toLowerCase();
    var segs = s.rest ? s.rest.split(" · ").filter(function (x) {
      return x && x.toLowerCase() !== planLower;
    }) : [];
    var badges = [];
    var rest = [];
    segs.forEach(function (x) {
      if (/^[0-9a-f]{6,12}$/i.test(x)) badges.push(x);
      else rest.push(x);
    });
    return { main: s.main, badges: badges, rest: rest.join(" · ") };
  }

  // ---- 汇总 -------------------------------------------------------------------

  function summary(cards, now) {
    var s = { total: 0, ok: 0, low: 0, out: 0, held: 0, error: 0, info: 0, resets: 0, resetAccounts: 0, soonestResetCard: null, nextReset: null, expiringSubs: 0 };
    cards.forEach(function (c) {
      s.total++;
      var st = cardStatus(c);
      s[st] = (s[st] || 0) + 1;
      var rc = resetCards(c);
      if (c.resets && c.resets.count > 0) {
        s.resets += c.resets.count;
        s.resetAccounts++;
        var first = rc[0] && time(rc[0].until);
        if (!Number.isFinite(first)) first = time(c.resets.until);
        if (Number.isFinite(first) && (!s.soonestResetCard || first < s.soonestResetCard.at)) s.soonestResetCard = { at: first, card: c };
      }
      var n = nextReset(c, now);
      if (n && (!s.nextReset || n.at < s.nextReset.at)) s.nextReset = { at: n.at, w: n.w, card: c };
      var u = time(c.until);
      if (Number.isFinite(u) && u - now < 7 * 86400e3) s.expiringSubs++;
    });
    return s;
  }

  // ---- 排序与筛选 -----------------------------------------------------------

  // 「可用优先」：能用的在前，用不了的在后，纯余额卡排在订阅之后
  var STATUS_RANK = { ok: 0, low: 1, held: 2, out: 3, error: 4, info: 5 };

  function sortCards(cards, by, now) {
    var list = cards.slice();
    var name = function (c) { return displayName(c).toLowerCase(); };
    var mr = function (c) { var m = minRemaining(c); return m === null ? 101 : m; };
    var cmp = {
      risk: function (a, b) { return mr(a) - mr(b) || name(a).localeCompare(name(b)); },
      roomy: function (a, b) { return mr(b) - mr(a) || name(a).localeCompare(name(b)); },
      reset: function (a, b) {
        var ra = nextReset(a, now), rb = nextReset(b, now);
        return (ra ? ra.at : Infinity) - (rb ? rb.at : Infinity) || name(a).localeCompare(name(b));
      },
      status: function (a, b) {
        var d = STATUS_RANK[cardStatus(a)] - STATUS_RANK[cardStatus(b)];
        if (d) return d;
        var aa = availableAt(a), ab = availableAt(b);
        if (aa || ab) return (aa || Infinity) - (ab || Infinity);
        return mr(b) - mr(a) || name(a).localeCompare(name(b));
      },
      name: function (a, b) { return name(a).localeCompare(name(b)); },
    }[by] || null;
    if (cmp) list.sort(cmp);
    return list;
  }

  function matches(card, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return [card.user, card.alias, card.name, card.provider, card.plan, card.from].some(function (v) {
      return v && String(v).toLowerCase().indexOf(q) >= 0;
    });
  }

  // ---- 格式化 ---------------------------------------------------------------

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (d > 0) return d + " 天" + (h ? " " + h + " 小时" : "");
    if (h > 0) return h + " 小时" + (m ? " " + m + " 分" : "");
    if (m > 0) return m + " 分" + (m < 10 && s ? " " + s + " 秒" : "");
    return s + " 秒";
  }

  var WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function fmtClock(t, now) {
    var d = new Date(t), n = new Date(now);
    var hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
    var day0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var diffDays = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 86400e3);
    if (diffDays === 0) return "今天 " + hm;
    if (diffDays === 1) return "明天 " + hm;
    if (diffDays === -1) return "昨天 " + hm;
    if (diffDays > 1 && diffDays < 7) return WEEK[d.getDay()] + " " + hm;
    var md = (d.getMonth() + 1) + "/" + d.getDate();
    if (d.getFullYear() !== n.getFullYear()) md = d.getFullYear() + "/" + md;
    return md + " " + hm;
  }

  function fmtDate(t, now) {
    var d = new Date(t), n = new Date(now);
    var md = (d.getMonth() + 1) + "/" + d.getDate();
    return d.getFullYear() !== n.getFullYear() ? d.getFullYear() + "/" + md : md;
  }

  function fmtAgo(t, now) {
    var s = Math.round((now - t) / 1000);
    if (s < 45) return "刚刚";
    if (s < 3600) return Math.round(s / 60) + " 分钟前";
    if (s < 86400) return Math.round(s / 3600) + " 小时前";
    return Math.round(s / 86400) + " 天前";
  }

  function fmtPct(v) {
    if (v >= 99.95) return "100%";
    if (v > 0 && v < 1) return v.toFixed(1) + "%";
    return Math.round(v) + "%";
  }

  function fmtTokens(n) {
    n = Number(n) || 0;
    if (n <= 0) return "0";
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  }

  function fmtUSD(n) {
    n = Number(n) || 0;
    if (n <= 0) return "$0.00";
    if (n < 0.01) return "$" + n.toFixed(3);
    return "$" + n.toFixed(2);
  }

  // 计算窗口的「已用明细（routed）」与「推断满窗额度（inferred）」
  function windowMetrics(w, card) {
    if (!w) return null;
    var name = String(w.name || "").trim();
    // MCP 工具调用次数窗口不套用 LLM token 明细
    if (/^mcp\b/i.test(name)) return null;
    var allWins = (card && Array.isArray(card.windows)) ? card.windows : [];
    var hasTotalCredits = allWins.some(function (x) { return /^total\s+credits$/i.test(String(x && x.name || "").trim()); });
    if (hasTotalCredits && /^(credits|extra\s+credits)$/i.test(name)) return null;

    var usedPct = usedOf(w);
    var used = null;

    // 1. 优先使用 magpie 按窗口精确边界算出的 holds.routed
    if (w.holds && w.holds.routed && ((Number(w.holds.routed.tokens) || 0) > 0 || (Number(w.holds.routed.calls) || 0) > 0)) {
      var r = w.holds.routed;
      var io = Number(r.tokens) || 0;
      var cr = Number(r.cacheRead) || 0;
      var cw = Number(r.cacheWrite) || 0;
      used = {
        calls: Number(r.calls) || 0,
        ioTokens: io,
        cacheRead: cr,
        cacheWrite: cw,
        totalTokens: io + cr + cw,
        cost: Number(r.cost) || 0,
        credits: Number(r.credits) || 0,
        exact: true,
      };
    } else if (card && card.usage && usedPct > 0 && !w.family) {
      // 2. 当 holds 因 <5% 阈值、日志起点或无 user 缺失时，回退使用网关周期用量
      var ps2 = poolStats(card);
      // 多额度池卡片（如 Antigravity）在缺少池级精确 holds 时，仅在第一个池子的主周期窗口展示账户总用量
      if (ps2.pools.length > 1 && w.pool && w.pool !== ps2.pools[0].name) return null;
      var secs = windowSeconds(name);
      var isShort = (secs > 0 && secs <= 86400) || /tokens\s*\(est\.\)/i.test(name);
      var u = isShort ? card.usage.today : (card.usage.week || card.usage.today);
      if (u && (u.totalTokens > 0 || u.cost > 0 || u.credits > 0)) {
        used = {
          calls: Number(u.calls) || 0,
          ioTokens: Number(u.ioTokens) || 0,
          cacheRead: Number(u.cacheRead) || 0,
          cacheWrite: Number(u.cacheWrite) || 0,
          totalTokens: Number(u.totalTokens) || 0,
          cost: Number(u.cost) || 0,
          credits: Number(u.credits) || 0,
          exact: false,
        };
      }
    }

    if (!used) return null;

    var inferred = null;
    if (usedPct > 0 && !w.unlimited) {
      var ratio = usedPct / 100;
      var infCost = (w.holds && Number(w.holds.cost) > 0) ? Number(w.holds.cost) : (used.cost > 0 ? used.cost / ratio : 0);
      var infCredits = used.credits > 0 ? used.credits / ratio : 0;
      var infTotal = used.totalTokens > 0 ? Math.round(used.totalTokens / ratio) : ((w.holds && Number(w.holds.tokens)) || 0);
      var infIO = (w.holds && Number(w.holds.tokens) > 0) ? Number(w.holds.tokens) : (used.ioTokens > 0 ? Math.round(used.ioTokens / ratio) : 0);
      if (infTotal > 0 || infCost > 0 || infCredits > 0) {
        inferred = {
          cost: infCost,
          credits: infCredits,
          totalTokens: infTotal,
          ioTokens: infIO,
          usedPct: usedPct,
        };
      }
    }

    return { used: used, inferred: inferred };
  }

  var OUTCOMES = {
    reset: function (o) { return "已重置 " + (o.windows || 1) + " 个窗口"; },
    nothing_to_reset: function () { return "没有可重置的窗口（窗口都还没用过），重置卡保留"; },
    no_credit: function () { return "这个账户已经没有重置卡了"; },
    already_redeemed: function () { return "这张重置卡已经用过了"; },
    already_used: function () { return "这张重置卡已经用过了"; },
    not_limited: function () { return "还没有窗口用尽，无需重置，重置卡保留"; },
    cooldown: function () { return "刚刚用过重置卡，请稍后再试"; },
    ineligible: function () { return "这个账户不能使用重置卡"; },
    unavailable: function () { return "暂时无法使用重置卡，请稍后再试"; },
  };

  function resetOutcome(out) {
    out = out || {};
    var f = OUTCOMES[out.code];
    return f ? f(out) : String(out.code || "完成");
  }

  root.CredModel = {
    PROVIDERS: PROVIDERS,
    baseProvider: baseProvider,
    providerMeta: providerMeta,
    isBalanceCard: isBalanceCard,
    groupKey: groupKey,
    groupMeta: groupMeta,
    windowLabel: windowLabel,
    windowSeconds: windowSeconds,
    isAsideWindow: isAsideWindow,
    usedOf: usedOf,
    remainingOf: remainingOf,
    level: level,
    paceOf: paceOf,
    groupWindows: groupWindows,
    primaryWindows: primaryWindows,
    poolStats: poolStats,
    cardKey: cardKey,
    minRemaining: minRemaining,
    cardStatus: cardStatus,
    availableAt: availableAt,
    nextReset: nextReset,
    resetWindowLabel: resetWindowLabel,
    resetCards: resetCards,
    isRemote: isRemote,
    canUseReset: canUseReset,
    displayName: displayName,
    splitUser: splitUser,
    userParts: userParts,
    summary: summary,
    sortCards: sortCards,
    matches: matches,
    fmtDuration: fmtDuration,
    fmtClock: fmtClock,
    fmtDate: fmtDate,
    fmtAgo: fmtAgo,
    fmtPct: fmtPct,
    fmtTokens: fmtTokens,
    fmtUSD: fmtUSD,
    windowMetrics: windowMetrics,
    resetOutcome: resetOutcome,
    time: time,
  };
})(typeof window !== "undefined" ? window : globalThis);
