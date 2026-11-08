// 额度看板（由插件本地服务托管，运行在 magpie 的沙箱帧里）。
// 只用 textContent / createElement 拼 DOM，不把任何数据当 HTML。
(function () {
  "use strict";

  var M = window.CredModel;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = "http://www.w3.org/2000/svg";

  // ---- 会话（入口页放在 fragment 里：s=密钥 l=入口页地址 d=深色） ---------------

  var hash = new URLSearchParams(location.hash.slice(1));
  var SECRET = hash.get("s") || "";
  var LAUNCHER = hash.get("l") || "";
  if (hash.get("d") === "1") document.documentElement.dataset.theme = "dark";
  else if (hash.get("d") === "0") document.documentElement.dataset.theme = "light";

  // ---- 与 magpie 窗口握手（主题、可见性）：帧跳转后仍是同一个 contentWindow ----------

  var bridge = (function () {
    var waiting = {};
    var next = 0;
    addEventListener("message", function (e) {
      if (e.source !== parent || parent === window) return;
      var m = e.data;
      if (!m || m.magpie !== 1) return;
      if (m.event === "theme") return paint(m.data);
      if (m.event === "visibility") return setVisible(!!(m.data && m.data.visible));
      var w = waiting[m.id];
      if (!w) return;
      delete waiting[m.id];
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m.result);
    });
    function call(method, params) {
      return new Promise(function (resolve, reject) {
        if (parent === window) return reject(new Error("not framed"));
        var id = "c" + (++next);
        waiting[id] = { resolve: resolve, reject: reject };
        setTimeout(function () { if (waiting[id]) { delete waiting[id]; reject(new Error("timeout")); } }, 8000);
        parent.postMessage({ magpie: 1, id: id, method: method, params: params }, "*");
      });
    }
    return { call: call };
  })();

  function paint(theme) {
    if (!theme) return;
    var root = document.documentElement;
    root.dataset.theme = theme.dark ? "dark" : "light";
    root.style.colorScheme = theme.dark ? "dark" : "light";
    var t = theme.tokens || {};
    Object.keys(t).forEach(function (k) { if (t[k]) root.style.setProperty("--magpie-" + k, t[k]); });
  }
  bridge.call("hello").then(paint, function () {});

  // ---- 状态 -------------------------------------------------------------------

  var S = {
    cards: [],
    loaded: false,
    who: null,
    fetchedAt: 0,
    error: "",
    history: null,
    busy: {},
    refreshingAll: false,
    visible: true,
    prefs: { provider: "all", status: "all", sort: "status", group: true, q: "" },
    lastRender: 0,
  };

  function setVisible(v) {
    var was = S.visible;
    S.visible = v;
    if (v && !was) { load(); tick(); }
  }
  document.addEventListener("visibilitychange", function () { setVisible(!document.hidden); });

  // ---- 接口 -------------------------------------------------------------------

  var sessionLost = false;
  function api(method, path, body) {
    var init = { method: method, headers: { "x-cred-session": SECRET }, cache: "no-store" };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "HTTP " + r.status }; }).then(function (j) {
        if (r.status === 401 && j.type === "session") onSessionLost();
        if (!r.ok || j.ok === false) {
          var e = new Error(j.error || "HTTP " + r.status);
          e.status = r.status;
          throw e;
        }
        return j;
      });
    }, function (e) {
      throw new Error("连不上插件服务：" + (e && e.message || e));
    });
  }

  function onSessionLost() {
    if (sessionLost) return;
    sessionLost = true;
    // 回到入口页，它会读新的会话密钥再跳回来
    if (LAUNCHER) {
      toast("插件服务重启过，正在重新连接…");
      setTimeout(function () { location.replace(LAUNCHER); }, 600);
    }
  }

  function takeCards(j) {
    if (Array.isArray(j.cards)) {
      S.cards = j.cards;
      S.fetchedAt = Date.now();
    }
    if (j.who) S.who = j.who;
    S.loaded = true;
    S.error = "";
  }

  var loading = null;
  function load() {
    if (loading) return loading;
    loading = api("GET", "api/state").then(function (j) {
      takeCards(j);
      render();
    }, function (e) {
      S.error = e.message;
      S.loaded = true;
      render();
    }).then(function () { loading = null; });
    return loading;
  }

  var histAt = 0;
  function loadHistory() {
    histAt = Date.now();
    api("GET", "api/history?days=2").then(function (j) {
      var map = {};
      (j.data || []).forEach(function (h) {
        var k = String(h.provider || "") + "|" + String(h.user || "").toLowerCase();
        var lines = map[k] || (map[k] = {});
        (h.lines || []).forEach(function (l) {
          if (!lines[l.name]) lines[l.name] = l.points || [];
        });
      });
      S.history = map;
      render();
    }, function () { /* 没有历史也无妨 */ });
  }

  // ---- 偏好 -------------------------------------------------------------------

  var prefsTimer = null;
  function savePrefs() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(function () {
      var p = { provider: S.prefs.provider, status: S.prefs.status, sort: S.prefs.sort, group: S.prefs.group };
      api("POST", "api/prefs", { prefs: p }).catch(function () {});
    }, 600);
  }

  // ---- DOM 工具 ---------------------------------------------------------------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function refreshIcon() {
    var s = svg("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "class": "spin-ic", "aria-hidden": "true" });
    s.appendChild(svg("path", { d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    return s;
  }
  // 倒计时元素：tick() 每秒刷新
  function countdown(at, prefix, suffix) {
    var s = el("span", "cd");
    s.dataset.at = String(at);
    s.dataset.pre = prefix || "";
    s.dataset.suf = suffix || "";
    fillCountdown(s, Date.now());
    return s;
  }
  function fillCountdown(s, now) {
    var at = Number(s.dataset.at);
    var left = (at - now) / 1000;
    s.textContent = left > 0 ? s.dataset.pre + M.fmtDuration(left) + s.dataset.suf : s.dataset.done || "已到时间，等待刷新";
  }
  function ago(t) {
    var s = el("span", "ago");
    s.dataset.ago = String(t);
    s.textContent = M.fmtAgo(t, Date.now());
    return s;
  }

  function toast(msg, kind) {
    var t = el("div", "toast" + (kind ? " " + kind : ""), msg);
    $("toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, kind === "err" ? 7000 : 4200);
  }

  // ---- 渲染：汇总 -------------------------------------------------------------

  var STATUS_TEXT = { ok: "可用", low: "紧张", out: "已耗尽", held: "暂停调度", error: "读取失败", info: "余额" };
  var STATUS_COLOR = { ok: "var(--green)", low: "var(--amber)", held: "color-mix(in srgb, var(--amber) 55%, var(--muted))", out: "var(--red)", error: "color-mix(in srgb, var(--red) 55%, var(--muted))", info: "var(--faint)" };

  function stat(k, v, small, d) {
    var box = el("div", "stat");
    box.appendChild(el("div", "k", k));
    var vv = el("div", "v num");
    if (v instanceof Node) vv.appendChild(v); else vv.textContent = v;
    if (small) vv.appendChild(el("small", "", small));
    box.appendChild(vv);
    if (d) {
      var dd = el("div", "d");
      if (d instanceof Node) dd.appendChild(d); else dd.textContent = d;
      box.appendChild(dd);
    }
    return box;
  }

  function renderStats(now) {
    var box = $("stats");
    box.replaceChildren();
    if (!S.cards.length) return;
    var s = M.summary(S.cards, now);

    var a = stat("账户", String(s.total), "个");
    var order = ["ok", "low", "held", "out", "error", "info"];
    var stack = el("div", "stack");
    var legend = el("div", "legend");
    order.forEach(function (k) {
      if (!s[k]) return;
      var i = el("i");
      i.style.width = (s[k] / s.total * 100) + "%";
      i.style.background = STATUS_COLOR[k];
      i.title = STATUS_TEXT[k] + " " + s[k];
      stack.appendChild(i);
      var l = el("span", "", STATUS_TEXT[k] + " " + s[k]);
      l.style.setProperty("--c", STATUS_COLOR[k]);
      legend.appendChild(l);
    });
    a.appendChild(stack);
    a.appendChild(legend);
    box.appendChild(a);

    var usable = s.ok + s.low;
    box.appendChild(stat("现在可用", String(usable), "/ " + (s.total - s.info), usable ? "有剩余额度、未被暂停的账户" : "所有订阅账户都暂时不可用"));

    if (s.nextReset) {
      var d = el("span", "");
      d.textContent = M.displayName(s.nextReset.card) + " · " + M.windowLabel(s.nextReset.w.name) + " · " + M.fmtClock(s.nextReset.at, now);
      box.appendChild(stat("下一次窗口重置", countdown(s.nextReset.at, "", " 后"), "", d));
    }

    if (s.resets) {
      var rd = s.soonestResetCard ? "最早一张 " + M.fmtDate(s.soonestResetCard.at, now) + " 过期（" + M.displayName(s.soonestResetCard.card) + "）" : s.resetAccounts + " 个账户";
      box.appendChild(stat("可用重置卡", String(s.resets), "张 · " + s.resetAccounts + " 个账户", rd));
    }
  }

  // ---- 渲染：筛选 -------------------------------------------------------------

  function chip(label, n, pressed, onclick, color) {
    var b = el("button", "chip");
    b.type = "button";
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    if (color) {
      var dot = el("span", "dot");
      dot.style.setProperty("--c", color);
      b.appendChild(dot);
    }
    b.appendChild(el("span", "", label));
    if (n !== null && n !== undefined) b.appendChild(el("span", "n", String(n)));
    b.onclick = onclick;
    return b;
  }

  function renderFilters() {
    var box = $("filters");
    box.replaceChildren();
    if (!S.cards.length) return;
    var provs = {};
    var order = [];
    S.cards.forEach(function (c) {
      var m = M.providerMeta(c);
      var key = c.provider;
      if (!provs[key]) { provs[key] = { meta: m, n: 0, label: c.from ? m.name + " · " + c.from : m.name }; order.push(key); }
      provs[key].n++;
    });
    var p1 = el("div", "chips");
    p1.appendChild(chip("全部", S.cards.length, S.prefs.provider === "all", function () { setPref("provider", "all"); }));
    order.forEach(function (k) {
      p1.appendChild(chip(provs[k].label, provs[k].n, S.prefs.provider === k, function () { setPref("provider", k); }, provs[k].meta.color));
    });
    if (S.prefs.provider !== "all" && !provs[S.prefs.provider]) S.prefs.provider = "all";
    box.appendChild(p1);
    box.appendChild(el("span", "sep"));

    var counts = { all: 0, usable: 0, tight: 0, blocked: 0, resets: 0 };
    S.cards.forEach(function (c) {
      counts.all++;
      var st = M.cardStatus(c);
      if (st === "ok" || st === "low") counts.usable++;
      if (st === "low") counts.tight++;
      if (st === "out" || st === "held" || st === "error") counts.blocked++;
      if (c.resets && c.resets.count > 0) counts.resets++;
    });
    var p2 = el("div", "chips");
    [["all", "全部状态"], ["usable", "可用"], ["tight", "紧张"], ["blocked", "耗尽 / 暂停"], ["resets", "有重置卡"]].forEach(function (x) {
      if (x[0] !== "all" && !counts[x[0]] && S.prefs.status !== x[0]) return;
      p2.appendChild(chip(x[1], x[0] === "all" ? null : counts[x[0]], S.prefs.status === x[0], function () { setPref("status", x[0]); }));
    });
    box.appendChild(p2);
  }

  function statusMatch(c, f) {
    if (f === "all") return true;
    var st = M.cardStatus(c);
    if (f === "usable") return st === "ok" || st === "low";
    if (f === "tight") return st === "low";
    if (f === "blocked") return st === "out" || st === "held" || st === "error";
    if (f === "resets") return !!(c.resets && c.resets.count > 0);
    return true;
  }

  function setPref(k, v) {
    S.prefs[k] = v;
    savePrefs();
    render();
  }

  // ---- 渲染：提示条 -----------------------------------------------------------

  function renderBanner() {
    var box = $("banner");
    box.replaceChildren();
    if (S.error) {
      var b = el("div", "banner err");
      b.appendChild(el("span", "grow", (S.cards.length ? "更新失败（显示的是上次的数据）：" : "读取额度失败：") + S.error));
      var r = el("button", "", "重试");
      r.type = "button";
      r.onclick = function () { load(); };
      b.appendChild(r);
      box.appendChild(b);
      return;
    }
    var hasResets = S.cards.some(M.canUseReset);
    if (hasResets && S.who && !S.who.canReset) {
      box.appendChild(el("div", "banner warn",
        "没有找到满权限的 magpie 网关 key，暂时不能在这里使用重置卡。请在 magpie「网关 › 网关 key」里新建一把（不要设成只读、不要限制预算/模型/账户），或在本插件选项 gatewayKey 里填写。"));
    }
  }

  // ---- 渲染：卡片 -------------------------------------------------------------

  function sparkline(points, now) {
    if (!points || points.length < 2) return null;
    var since = now - 48 * 3600e3;
    var pts = points.filter(function (p) { return M.time(p.at) >= since && typeof p.left === "number"; });
    if (pts.length < 3) return null;
    // 几乎是平线就没有信息量，不画
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { lo = Math.min(lo, p.left); hi = Math.max(hi, p.left); });
    if (hi - lo < 5) return null;
    var W = 64, H = 16;
    var t0 = since, t1 = now;
    var d = "";
    pts.forEach(function (p, i) {
      var x = ((M.time(p.at) - t0) / (t1 - t0)) * W;
      var y = H - 1 - (Math.max(0, Math.min(100, p.left)) / 100) * (H - 2);
      d += (i ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    });
    var last = pts[pts.length - 1];
    var s = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, "class": "spark", "aria-hidden": "true" });
    var t = svg("title", {});
    t.textContent = "近 48 小时剩余额度走势";
    s.appendChild(t);
    s.appendChild(svg("path", { d: d + " L" + (((M.time(last.at) - t0) / (t1 - t0)) * W).toFixed(1) + " " + H + " L" + (((M.time(pts[0].at) - t0) / (t1 - t0)) * W).toFixed(1) + " " + H + " Z", fill: "currentColor", opacity: 0.1, stroke: "none" }));
    s.appendChild(svg("path", { d: d, fill: "none", stroke: "currentColor", "stroke-width": 1.3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    return s;
  }

  function windowRow(item, card, now, hist, uniqueNames) {
    var w = item.w;
    var rem = M.remainingOf(w);
    var lvl = M.level(rem);
    var row = el("div", "w");

    var label = el("span", "w-label", item.label || M.windowLabel(w.name));
    label.title = String(w.name || "");
    row.appendChild(label);

    var bar = el("div", "bar");
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(rem)));
    bar.setAttribute("aria-label", (item.label || M.windowLabel(w.name)) + " 剩余");
    var fill = el("div", "fill " + lvl);
    fill.style.width = (w.unlimited ? 100 : rem) + "%";
    bar.appendChild(fill);
    var pace = w.unlimited ? null : M.paceOf(w, now);
    if (pace && rem > 0.5 && M.usedOf(w) > 0) {
      var mark = el("div", "mark");
      mark.style.left = ((1 - pace.elapsed) * 100) + "%";
      mark.title = "按时间匀速使用，此刻应剩 " + M.fmtPct((1 - pace.elapsed) * 100);
      bar.appendChild(mark);
    }
    row.appendChild(bar);

    var val = el("span", "w-val");
    if (w.unlimited) val.textContent = "不限量";
    else if (w.display) {
      val.textContent = w.display;
      val.appendChild(el("small", "", " · 剩 " + M.fmtPct(rem)));
    } else {
      val.appendChild(el("small", "", "剩 "));
      val.appendChild(document.createTextNode(M.fmtPct(rem)));
    }
    if (lvl === "out") val.style.color = "var(--red)";
    else if (lvl === "low") val.style.color = "var(--amber)";
    row.appendChild(val);

    var meta = el("div", "w-meta");
    var r = el("span", "reset");
    var at = M.time(w.resetsAt);
    if (Number.isFinite(at)) {
      var cd = countdown(at, "", " 后重置");
      r.appendChild(cd);
      r.appendChild(document.createTextNode(" · " + M.fmtClock(at, now)));
      r.title = "重置时间 " + new Date(at).toLocaleString();
    } else if (w.unlimited) {
      r.textContent = "";
    } else if (M.usedOf(w) === 0 && M.windowSeconds(w.name)) {
      r.textContent = "未开始计时";
    } else {
      r.textContent = w.runsOutAt ? "额度 " + M.fmtClock(M.time(w.runsOutAt), now) + " 到期" : "";
    }
    meta.appendChild(r);
    if (pace && rem > 0.5 && pace.ahead > 0.15) {
      var p = el("span", "pace fast", "用得偏快");
      p.title = "窗口时间过去 " + M.fmtPct(pace.elapsed * 100) + "，额度已用 " + M.fmtPct(pace.used * 100);
      meta.appendChild(p);
    }
    if (hist && uniqueNames[w.name]) {
      var sp = sparkline(hist[w.name], now);
      if (sp) meta.appendChild(sp);
    }
    if (r.textContent || meta.childNodes.length > 1) row.appendChild(meta);
    else row.classList.add("compact");
    return row;
  }

  function renderCard(c, now) {
    var meta = M.providerMeta(c);
    var st = M.cardStatus(c);
    var key = M.cardKey(c);
    var card = el("article", "card");
    card.dataset.status = st;

    // 头部
    var head = el("header", "c-head");
    var av = el("div", "avatar", (meta.name || "?").slice(0, 1).toUpperCase());
    av.style.setProperty("--c", meta.color);
    av.title = meta.name;
    head.appendChild(av);
    var id = el("div", "c-id");
    var nm = el("div", "c-name");
    var parts = M.splitUser(c);
    nm.appendChild(el("span", "txt", parts.main));
    if (c.plan) nm.appendChild(el("span", "tag", c.plan));
    if (c.seat) nm.appendChild(el("span", "tag", c.seat));
    id.appendChild(nm);
    var sub = [meta.name];
    if (parts.rest) sub.push(parts.rest);
    if (c.from) sub.push("来自 " + c.from);
    id.appendChild(el("div", "c-user", sub.join(" · ")));
    id.title = [M.displayName(c), c.user, c.plan].filter(Boolean).join("\n");
    head.appendChild(id);
    var pill = el("span", "pill " + st, STATUS_TEXT[st]);
    if (st === "held") pill.title = "窗口用尽，magpie 暂不往这个账户派请求";
    head.appendChild(pill);
    if (c.held && st !== "held") {
      var hp = el("span", "pill held", "暂停");
      hp.title = "magpie 暂不往这个账户派请求";
      head.appendChild(hp);
    }
    var rb = el("button", "icon");
    rb.type = "button";
    rb.title = M.isRemote(c) ? "这张卡片来自另一台 magpie，只能在那里刷新" : "重新读取这个账户的额度";
    rb.setAttribute("aria-label", "刷新 " + M.displayName(c));
    rb.appendChild(refreshIcon());
    if (S.busy["r:" + key]) rb.classList.add("busy");
    rb.disabled = M.isRemote(c) || !!S.busy["r:" + key] || S.refreshingAll;
    rb.onclick = function () { refreshOne(c); };
    head.appendChild(rb);
    card.appendChild(head);

    if (c.error) card.appendChild(el("div", "errbox", c.error));

    // 恢复可用时间
    if (st === "out") {
      var av2 = M.availableAt(c);
      var box = el("div", "avail");
      if (av2 && av2 > now) {
        box.appendChild(el("span", "", "恢复可用"));
        var b = el("b", "");
        b.appendChild(countdown(av2, "", " 后"));
        box.appendChild(b);
        box.appendChild(el("span", "", "· " + M.fmtClock(av2, now)));
      } else {
        box.appendChild(el("span", "", "窗口已到重置时间，刷新后即可看到最新额度"));
      }
      card.appendChild(box);
    }

    // 余额
    if (c.balance || c.sharedBalance) {
      var bal = el("div", "balance");
      var amt = el("div", "amt", c.balance || c.sharedBalance);
      if (/^-|\$-/.test(String(c.balance || ""))) amt.classList.add("neg");
      bal.appendChild(amt);
      var pts = c.balanceTrend && c.balanceTrend.points;
      if (pts && pts.length > 1) {
        var vals = pts.map(function (p) { return Number(p.amount); }).filter(Number.isFinite);
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        var norm = pts.map(function (p) { return { at: p.at, left: hi === lo ? 50 : (Number(p.amount) - lo) / (hi - lo) * 100 }; });
        var spk = sparkline(norm, now);
        if (spk) { spk.setAttribute("width", "96"); spk.setAttribute("height", "24"); bal.appendChild(spk); }
      }
      card.appendChild(bal);
    }

    // 窗口
    var groups = M.groupWindows(c);
    if (groups.length) {
      var hist = S.history ? S.history[String(c.provider || "") + "|" + String(c.user || "").toLowerCase()] : null;
      var names = {};
      (c.windows || []).forEach(function (w) { names[w.name] = (names[w.name] || 0) + 1; });
      var unique = {};
      Object.keys(names).forEach(function (n) { if (names[n] === 1) unique[n] = true; });
      var wins = el("div", "wins");
      groups.forEach(function (g, gi) {
        var target = wins;
        if (g.collapsed) {
          var det = el("details", "wgroup");
          if (S.busy["open:" + key + ":" + gi]) det.open = true;
          det.addEventListener("toggle", function () { S.busy["open:" + key + ":" + gi] = det.open; });
          det.appendChild(el("summary", "", g.title + "（" + g.items.length + "）"));
          target = el("div", "wins");
          det.appendChild(target);
          wins.appendChild(det);
        } else if (g.title && groups.length > 1) {
          wins.appendChild(el("div", "wgroup-title", g.title));
        }
        g.items.forEach(function (it) { target.appendChild(windowRow(it, c, now, hist, unique)); });
      });
      card.appendChild(wins);
    } else if (!c.balance && !c.error) {
      card.appendChild(el("div", "c-user", "没有可显示的额度窗口"));
    }

    // 底部：重置卡 + 元信息
    var foot = el("footer", "c-foot");
    var rc = M.resetCards(c);
    if (c.resets && c.resets.count > 0) {
      var rs = el("div", "resets");
      var first = rc[0] ? M.time(rc[0].until) : M.time(c.resets.until);
      var tk = el("span", "ticket" + (Number.isFinite(first) && first - now < 3 * 86400e3 ? " soon" : ""), "重置卡 ×" + c.resets.count);
      tk.title = rc.map(function (x, i) { return "第 " + (i + 1) + " 张：" + (x.until ? new Date(x.until).toLocaleString() + " 过期" : "不过期"); }).join("\n") || "";
      rs.appendChild(tk);
      if (Number.isFinite(first)) rs.appendChild(el("span", "", "最早 " + M.fmtDate(first, now) + " 过期"));
      if (M.canUseReset(c)) {
        var ub = el("button", "", S.busy["x:" + key] ? "使用中…" : "使用重置卡");
        ub.type = "button";
        ub.disabled = !!S.busy["x:" + key];
        if (S.who && !S.who.canReset) { ub.disabled = true; ub.title = "需要满权限的网关 key"; }
        ub.onclick = function () { askReset(c); };
        rs.appendChild(ub);
      } else if (c.resets.count > 0 && M.isRemote(c)) {
        rs.title = "这张卡片来自另一台 magpie，请在那台机器上使用重置卡";
      }
      foot.appendChild(rs);
    }
    var mt = el("div", "meta");
    var until = M.time(c.until);
    if (Number.isFinite(until)) {
      var days = Math.ceil((until - now) / 86400e3);
      var u = el("span", "", (days < 0 ? "订阅已于 " : "订阅 ") + M.fmtDate(until, now) + (days < 0 ? " 到期" : " 到期（" + days + " 天）"));
      if (days >= 0 && days <= 7) u.style.color = "var(--amber)";
      if (days < 0) u.style.color = "var(--red)";
      mt.appendChild(u);
    }
    if (c.renew === "off") mt.appendChild(el("span", "", "不自动续费"));
    if (Array.isArray(c.resetsUsed) && c.resetsUsed.length) mt.appendChild(el("span", "", "已用重置卡 " + c.resetsUsed.length + " 张"));
    var read = M.time(c.readAt || c.asOf);
    if (Number.isFinite(read)) {
      var rd = el("span", "");
      rd.appendChild(document.createTextNode("读取于 "));
      rd.appendChild(ago(read));
      rd.title = new Date(read).toLocaleString();
      mt.appendChild(rd);
    }
    foot.appendChild(mt);
    card.appendChild(foot);
    return card;
  }

  function renderList(now) {
    var box = $("list");
    box.replaceChildren();
    if (!S.loaded) {
      var g = el("div", "grid");
      for (var i = 0; i < 3; i++) g.appendChild(el("div", "skeleton"));
      box.appendChild(g);
      return;
    }
    if (!S.cards.length) {
      if (S.error) return;
      var e = el("div", "empty");
      e.appendChild(el("b", "", "还没有任何账户"));
      e.appendChild(document.createTextNode("在 magpie 里登录 Claude、ChatGPT（Codex）、Google 等订阅账户，或添加有余额查询的服务后，这里会显示它们的额度。"));
      box.appendChild(e);
      return;
    }
    var q = S.prefs.q.trim();
    var list = S.cards.filter(function (c) {
      return (S.prefs.provider === "all" || c.provider === S.prefs.provider) && statusMatch(c, S.prefs.status) && M.matches(c, q);
    });
    list = M.sortCards(list, S.prefs.sort, now);
    if (!list.length) {
      var n = el("div", "empty");
      n.appendChild(el("b", "", "没有符合条件的账户"));
      var clr = el("button", "", "清除筛选");
      clr.type = "button";
      clr.onclick = function () { S.prefs.provider = "all"; S.prefs.status = "all"; S.prefs.q = ""; $("q").value = ""; savePrefs(); render(); };
      n.appendChild(clr);
      box.appendChild(n);
      return;
    }
    if (!S.prefs.group) {
      var grid = el("div", "grid");
      list.forEach(function (c) { grid.appendChild(renderCard(c, now)); });
      box.appendChild(grid);
      return;
    }
    var groups = {};
    var order = [];
    list.forEach(function (c) {
      if (!groups[c.provider]) { groups[c.provider] = []; order.push(c.provider); }
      groups[c.provider].push(c);
    });
    order.forEach(function (p) {
      var cs = groups[p];
      var meta = M.providerMeta(cs[0]);
      var sec = el("section", "section");
      var h = el("div", "section-head");
      var dd = el("span", "dot");
      dd.style.cssText = "display:inline-block;width:9px;height:9px;border-radius:50%;background:" + meta.color;
      h.appendChild(dd);
      h.appendChild(el("h2", "", meta.name + (cs[0].from ? " · " + cs[0].from : "")));
      h.appendChild(el("span", "n", cs.length + " 个账户"));
      h.appendChild(el("span", "grow"));
      sec.appendChild(h);
      var grid2 = el("div", "grid");
      cs.forEach(function (c) { grid2.appendChild(renderCard(c, now)); });
      sec.appendChild(grid2);
      box.appendChild(sec);
    });
  }

  function renderHeader() {
    var sub = $("sub");
    sub.replaceChildren();
    if (!S.loaded) { sub.textContent = "加载中…"; return; }
    var parts = [];
    if (S.cards.length) parts.push(S.cards.length + " 个账户");
    sub.appendChild(document.createTextNode(parts.join(" · ")));
    if (S.fetchedAt) {
      sub.appendChild(document.createTextNode((parts.length ? " · " : "") + "页面更新于 "));
      sub.appendChild(ago(S.fetchedAt));
    }
    var b = $("refreshAll");
    b.classList.toggle("busy", S.refreshingAll);
    b.disabled = S.refreshingAll;
    b.lastElementChild.textContent = S.refreshingAll ? "刷新中…" : "全部刷新";
    $("groupBtn").setAttribute("aria-pressed", S.prefs.group ? "true" : "false");
    if ($("sort").value !== S.prefs.sort) $("sort").value = S.prefs.sort;
  }

  function render() {
    if ($("modal").dataset.lock === "1") { S.pending = true; return; }
    var now = Date.now();
    var y = window.scrollY;
    renderHeader();
    renderStats(now);
    renderFilters();
    renderBanner();
    renderList(now);
    window.scrollTo(0, y);
    S.lastRender = now;
  }

  // ---- 操作 -------------------------------------------------------------------

  function refreshOne(c) {
    var key = "r:" + M.cardKey(c);
    if (S.busy[key]) return;
    S.busy[key] = true;
    render();
    api("POST", "api/refresh", { provider: c.provider, user: c.user || "" }).then(function (j) {
      takeCards(j);
      toast(M.displayName(c) + "：额度已更新", "ok");
    }, function (e) {
      toast(M.displayName(c) + "：刷新失败 — " + e.message, "err");
    }).then(function () {
      delete S.busy[key];
      render();
    });
  }

  function refreshAll() {
    if (S.refreshingAll) return;
    S.refreshingAll = true;
    render();
    api("POST", "api/refresh", {}).then(function (j) {
      takeCards(j);
      toast("所有账户的额度已更新", "ok");
      loadHistory();
    }, function (e) {
      toast("全部刷新失败 — " + e.message, "err");
    }).then(function () {
      S.refreshingAll = false;
      render();
    });
  }

  function closeModal() {
    var m = $("modal");
    m.hidden = true;
    m.replaceChildren();
    m.dataset.lock = "";
    document.removeEventListener("keydown", modalKeys);
    if (S.pending) { S.pending = false; render(); }
  }
  function modalKeys(e) {
    if (e.key === "Escape" && !$("modal").dataset.busy) closeModal();
  }

  function askReset(c) {
    var now = Date.now();
    var who = M.displayName(c);
    var cards = M.resetCards(c);
    var m = $("modal");
    m.replaceChildren();
    m.dataset.lock = "1";
    var d = el("div", "dialog");
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.appendChild(el("h3", "", "使用 Codex 重置卡？"));
    d.appendChild(el("p", "", who + " 有 " + c.resets.count + " 张重置卡。使用一张后，它的所有窗口会立即重新开始计算，就像从没用过一样。此操作无法撤销。"));

    var mini = el("div", "mini");
    M.primaryWindows(c).forEach(function (w) {
      var row = el("div", "");
      row.appendChild(el("span", "", M.windowLabel(w.name) + (w.pool ? "（" + w.pool + "）" : "")));
      var r = M.remainingOf(w);
      var v = el("span", "num", "剩 " + M.fmtPct(r) + (M.time(w.resetsAt) ? " · " + M.fmtClock(M.time(w.resetsAt), now) + " 重置" : ""));
      if (r <= 0.5) v.style.color = "var(--red)";
      row.appendChild(v);
      mini.appendChild(row);
    });
    d.appendChild(mini);

    if (!(c.windows || []).some(function (w) { return M.usedOf(w) > 0; })) {
      d.appendChild(el("p", "warn", "它的窗口都还没有用过，现在使用不会有任何效果（magpie 会保留这张卡）。"));
    }

    var chosen = cards[0] ? cards[0].id || "" : "";
    var note = el("p", "warn");
    note.hidden = true;
    if (cards.length > 1 && cards.every(function (x) { return x.id; })) {
      d.appendChild(el("p", "", "选择要使用的重置卡："));
      var opts = el("div", "opts");
      cards.forEach(function (x, i) {
        var lab = el("label", "opt");
        var inp = el("input");
        inp.type = "radio";
        inp.name = "credit";
        inp.value = x.id;
        inp.checked = i === 0;
        inp.onchange = function () {
          chosen = x.id;
          var firstUntil = M.time(cards[0].until);
          note.hidden = i === 0 || !Number.isFinite(firstUntil);
          note.textContent = "最早过期的那张（" + M.fmtClock(firstUntil, now) + "）会保留，到期前没用掉就作废。";
        };
        lab.appendChild(inp);
        var u = M.time(x.until);
        lab.appendChild(el("span", "", "第 " + (i + 1) + " 张 · " + (Number.isFinite(u) ? M.fmtClock(u, now) + " 过期" : "不过期")));
        if (i === 0) lab.appendChild(el("span", "note", "默认（最早过期）"));
        opts.appendChild(lab);
      });
      d.appendChild(opts);
    } else if (cards[0] && cards[0].until) {
      d.appendChild(el("p", "", "将使用最早过期的一张（" + M.fmtClock(M.time(cards[0].until), now) + " 过期）。"));
    }
    d.appendChild(note);

    var bar = el("div", "bar-row");
    var cancel = el("button", "", "取消");
    cancel.type = "button";
    cancel.onclick = closeModal;
    var go = el("button", "danger", "使用重置卡");
    go.type = "button";
    go.onclick = function () {
      var key = "x:" + M.cardKey(c);
      go.disabled = cancel.disabled = true;
      go.textContent = "使用中…";
      m.dataset.busy = "1";
      S.busy[key] = true;
      var body = { user: c.user };
      if (chosen && cards.length > 1 && chosen !== cards[0].id) body.credit = chosen;
      api("POST", "api/reset", body).then(function (j) {
        if (j.cards) takeCards(j);
        var code = j.outcome && j.outcome.code;
        toast(who + "：" + M.resetOutcome(j.outcome), code === "reset" ? "ok" : "err");
        loadHistory();
      }, function (e) {
        toast(who + "：未能使用重置卡 — " + e.message, "err");
        // 结果不确定（超时等）时读一次最新卡片
        load();
      }).then(function () {
        delete S.busy[key];
        m.dataset.busy = "";
        closeModal();
        render();
      });
    };
    bar.appendChild(cancel);
    bar.appendChild(go);
    d.appendChild(bar);
    m.appendChild(d);
    m.hidden = false;
    m.onclick = function (e) { if (e.target === m && !m.dataset.busy) closeModal(); };
    document.addEventListener("keydown", modalKeys);
    cancel.focus();
  }

  // ---- 定时 -------------------------------------------------------------------

  function tick() {
    var now = Date.now();
    var cds = document.querySelectorAll(".cd");
    for (var i = 0; i < cds.length; i++) fillCountdown(cds[i], now);
    var ags = document.querySelectorAll(".ago");
    for (var j = 0; j < ags.length; j++) ags[j].textContent = M.fmtAgo(Number(ags[j].dataset.ago), now);
  }
  setInterval(function () { if (S.visible) tick(); }, 1000);
  // 每分钟读一次 magpie 缓存的卡片（不触发上游读取）；每 5 分钟读一次历史
  setInterval(function () {
    if (!S.visible || sessionLost) return;
    load();
    if (Date.now() - histAt > 5 * 60e3) loadHistory();
  }, 60e3);

  // ---- 启动 -------------------------------------------------------------------

  $("refreshAll").onclick = refreshAll;
  $("sort").onchange = function () { setPref("sort", $("sort").value); };
  $("groupBtn").onclick = function () { setPref("group", !S.prefs.group); };
  var qTimer = 0;
  $("q").oninput = function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { S.prefs.q = $("q").value; render(); }, 120);
  };
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== $("q") && $("modal").hidden) { e.preventDefault(); $("q").focus(); }
  });

  render();
  if (!SECRET) {
    S.loaded = true;
    S.error = "缺少会话密钥：请从 magpie 侧栏的「凭据额度」打开本页";
    render();
    return;
  }
  api("GET", "api/prefs").then(function (j) {
    var p = j.prefs || {};
    if (typeof p.provider === "string") S.prefs.provider = p.provider;
    if (typeof p.status === "string") S.prefs.status = p.status;
    if (typeof p.sort === "string") S.prefs.sort = p.sort;
    if (typeof p.group === "boolean") S.prefs.group = p.group;
  }, function () {}).then(function () {
    return load();
  }).then(function () {
    if (!sessionLost) loadHistory();
  });
})();
