// 纯数据逻辑（不碰 DOM），浏览器里挂在 window.CredModel，测试里用 vm 加载。
(function (root) {
  "use strict";

  var PROVIDERS = {
    claude: { name: "Claude", color: "#d97757" },
    codex: { name: "Codex", color: "#10a37f" },
    antigravity: { name: "Antigravity", color: "#4285f4" },
    gemini: { name: "Gemini", color: "#8e75f0" },
    copilot: { name: "Copilot", color: "#8250df" },
    workbuddy: { name: "WorkBuddy", color: "#2f6bff" },
    kiro: { name: "Kiro", color: "#7b61ff" },
    cursor: { name: "Cursor", color: "#6b7280" },
    factory: { name: "Factory", color: "#f97316" },
    qoder: { name: "Qoder", color: "#14b8a6" },
    trae: { name: "Trae", color: "#ef4444" },
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

  function providerMeta(card) {
    var id = baseProvider(card.provider);
    var m = PROVIDERS[id];
    if (m) return { id: id, name: m.name, color: m.color };
    var name = card.name || id || "?";
    return { id: id, name: name, color: "hsl(" + hue(id || name) + " 55% 50%)" };
  }

  // ---- 窗口 -------------------------------------------------------------------

  var WORDS = {
    credits: "积分", "extra credits": "额外积分", "total credits": "总积分",
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
    return s.replace(/\bMonth\b/g, "月").replace(/\bWeek\b/g, "周").replace(/\bDay\b/g, "天").replace(/\(est\.\)/g, "（估）");
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
      var item = { w: w, i: i, label: windowLabel(w.name) };
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
        var row = { w: it.w, i: it.i, base: base, variants: m ? [m[2]] : [], label: "" };
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

  // 用来判断账户状态的窗口：池子级 / 主窗口（不含模型明细）
  function primaryWindows(card) {
    var ws = Array.isArray(card.windows) ? card.windows : [];
    var p = ws.filter(function (w) { return !(w.family && !windowSeconds(w.name)) && !w.text; });
    return p.length ? p : ws.filter(function (w) { return !w.text; });
  }

  function cardKey(card) {
    return String(card.provider || "") + "|" + String(card.user || "").toLowerCase() + "|" + String(card.name || "");
  }

  function minRemaining(card) {
    var ws = primaryWindows(card);
    if (!ws.length) return null;
    var m = 100;
    ws.forEach(function (w) { m = Math.min(m, remainingOf(w)); });
    return m;
  }

  // cardStatus：error / held / out / low / ok / info（无窗口，如余额卡）
  function cardStatus(card) {
    if (card.error) return "error";
    var m = minRemaining(card);
    if (m !== null && m <= 0.5) return "out";
    if (card.held) return "held";
    if (m === null) return "info";
    if (m < 20) return "low";
    return "ok";
  }

  // availableAt：用尽的窗口全部重置的时刻（即账户恢复可用的最早时间）
  function availableAt(card) {
    var t = 0;
    primaryWindows(card).forEach(function (w) {
      if (remainingOf(w) <= 0.5) {
        var r = time(w.resetsAt);
        if (Number.isFinite(r) && r > t) t = r;
      }
    });
    return t || null;
  }

  function nextReset(card, now) {
    var best = null;
    primaryWindows(card).forEach(function (w) {
      var r = time(w.resetsAt);
      if (Number.isFinite(r) && r > now && (best === null || r < best.at)) best = { at: r, w: w };
    });
    return best;
  }

  function resetCards(card) {
    var r = card.resets;
    if (!r || !(r.count > 0)) return [];
    var each = Array.isArray(r.each) ? r.each.slice() : [];
    each.sort(function (a, b) { return (time(a.until) || Infinity) - (time(b.until) || Infinity); });
    return each;
  }

  function isRemote(card) {
    return String(card.provider || "").indexOf("/") >= 0 || !!card.from;
  }

  function canUseReset(card) {
    return card.provider === "codex" && !card.from && !!card.resets && card.resets.count > 0 && !!card.user;
  }

  function displayName(card) {
    return card.alias || card.user || card.name || card.provider || "?";
  }

  // splitUser："a@b.com · Team · 1e3dc86e" → { main: "a@b.com", rest: "Team · 1e3dc86e" }
  function splitUser(card) {
    if (card.alias) return { main: card.alias, rest: card.user || "" };
    var u = String(card.user || card.name || card.provider || "?");
    var parts = u.split(" · ");
    return { main: parts[0], rest: parts.slice(1).join(" · ") };
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

  // 「可用优先」：能用的在前，用不了的在后
  var STATUS_RANK = { ok: 0, low: 1, info: 2, held: 3, out: 4, error: 5 };

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
        // 都不可用时，恢复得早的在前；可用时剩余多的在前
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
    windowLabel: windowLabel,
    windowSeconds: windowSeconds,
    usedOf: usedOf,
    remainingOf: remainingOf,
    level: level,
    paceOf: paceOf,
    groupWindows: groupWindows,
    primaryWindows: primaryWindows,
    cardKey: cardKey,
    minRemaining: minRemaining,
    cardStatus: cardStatus,
    availableAt: availableAt,
    nextReset: nextReset,
    resetCards: resetCards,
    isRemote: isRemote,
    canUseReset: canUseReset,
    displayName: displayName,
    splitUser: splitUser,
    summary: summary,
    sortCards: sortCards,
    matches: matches,
    fmtDuration: fmtDuration,
    fmtClock: fmtClock,
    fmtDate: fmtDate,
    fmtAgo: fmtAgo,
    fmtPct: fmtPct,
    resetOutcome: resetOutcome,
    time: time,
  };
})(typeof window !== "undefined" ? window : globalThis);
