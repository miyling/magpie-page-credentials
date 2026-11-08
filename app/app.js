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
    collapsedGroups: {},
    refreshingAll: false,
    visible: true,
    prefs: { provider: "all", status: "all", sort: "status", group: true, view: "card", q: "" },
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
      var p = {
        provider: S.prefs.provider,
        status: S.prefs.status,
        sort: S.prefs.sort,
        group: S.prefs.group,
        view: S.prefs.view,
      };
      api("POST", "api/prefs", { prefs: p }).catch(function () {});
    }, 500);
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

  var PNG_ICONS = {
    crush: 1, zcode: 1, alma: 1, hanako: 1, cindy: 1, lody: 1,
    typesafe: 1, atomcode: 1, snow: 1, "mlx-serve": 1, mothx: 1,
    "zoo-code": 1, "kimi-code-desktop": 1,
  };

  function iconUrl(name) {
    if (!name) return "";
    if (name.indexOf("file:") === 0) return "user-icons/" + encodeURIComponent(name.slice(5));
    if (/[:/]/.test(name)) return "";
    return "icons/" + name + "." + (PNG_ICONS[name] ? "png" : "svg");
  }

  function providerIcon(iconName, extraClass, onFail) {
    var src = iconUrl(iconName);
    if (!src) return null;
    var wrap = el("span", "ic" + (extraClass ? " " + extraClass : ""));
    wrap.dataset.icon = iconName;
    wrap.setAttribute("aria-hidden", "true");
    var isColorOrFile = iconName.indexOf("file:") === 0 || /-color$/.test(iconName) || !!PNG_ICONS[iconName];
    if (isColorOrFile) {
      var img = el("img");
      img.src = src;
      img.alt = "";
      img.draggable = false;
      img.onerror = function () { if (onFail) onFail(wrap); };
      wrap.appendChild(img);
    } else {
      var mask = el("span", "mask");
      var abs = new URL(src, document.baseURI).href;
      mask.style.setProperty("--i", 'url("' + abs + '")');
      var probe = new Image();
      probe.onerror = function () { if (onFail) onFail(wrap); };
      probe.src = src;
      wrap.appendChild(mask);
    }
    return wrap;
  }

  function providerAvatar(meta) {
    var letter = (meta.name || "?").slice(0, 1).toUpperCase();
    var av = el("div", "avatar");
    av.style.setProperty("--c", meta.color);
    av.title = meta.name;
    var ic = providerIcon(meta.icon, "", function () {
      av.classList.remove("has-icon");
      av.textContent = letter;
    });
    if (ic) {
      av.classList.add("has-icon");
      av.appendChild(ic);
    } else {
      av.textContent = letter;
    }
    return av;
  }

  function groupIcon(gm) {
    var icons = gm.icons || (gm.icon ? [gm.icon] : []);
    if (icons.length > 1) {
      var st = el("span", "ic-stack");
      icons.slice(0, 3).forEach(function (icName) {
        var disc = el("span", "disc");
        var ic = providerIcon(icName, "");
        if (ic) disc.appendChild(ic);
        st.appendChild(disc);
      });
      return st;
    }
    if (icons[0]) {
      var single = providerIcon(icons[0], "s-ic", function (w) {
        var d = el("span", "s-dot");
        d.style.setProperty("--c", gm.color);
        if (w.parentNode) w.parentNode.replaceChild(d, w);
      });
      if (single) return single;
    }
    var dot = el("span", "s-dot");
    dot.style.setProperty("--c", gm.color);
    return dot;
  }
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
    setTimeout(function () { t.remove(); }, kind === "err" ? 7000 : 3800);
  }

  function copyText(text, label) {
    if (!text) return;
    var ok = function () { toast("已复制：" + (label || text), "ok"); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text) && ok(); });
        return;
      }
    } catch (e) { /* fallback */ }
    if (fallbackCopy(text)) ok();
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      var res = document.execCommand("copy");
      ta.remove();
      return res;
    } catch (e) { return false; }
  }

  // 判断重置卡是否需要依赖本机网关满权限 key（Codex 走网关，智谱等按窗口重置走自身 key）
  function needsGatewayKeyForReset(c) {
    return c && c.provider === "codex" && !(c.resets && c.resets.byWindow);
  }

  // ---- 渲染：汇总（支持点击快捷筛选/排序） ------------------------------------

  var STATUS_TEXT = { ok: "可用", low: "紧张", out: "已耗尽", held: "暂停调度", error: "读取失败", info: "余额" };
  var STATUS_COLOR = { ok: "var(--green)", low: "var(--amber)", held: "color-mix(in srgb, var(--amber) 55%, var(--muted))", out: "var(--red)", error: "color-mix(in srgb, var(--red) 55%, var(--muted))", info: "var(--faint)" };

  function stat(k, v, small, d, opts) {
    opts = opts || {};
    var box = el("div", "stat" + (opts.active ? " active" : ""));
    var head = el("div", "k");
    head.appendChild(el("span", "", k));
    if (opts.hint) head.appendChild(el("span", "k-hint", opts.hint));
    box.appendChild(head);
    var vv = el("div", "v num");
    if (v instanceof Node) vv.appendChild(v); else vv.textContent = v;
    if (small) vv.appendChild(el("small", "", small));
    box.appendChild(vv);
    if (d) {
      var dd = el("div", "d");
      if (d instanceof Node) dd.appendChild(d); else dd.textContent = d;
      box.appendChild(dd);
    }
    if (opts.onClick) {
      box.dataset.clickable = "true";
      box.setAttribute("role", "button");
      box.setAttribute("tabindex", "0");
      box.onclick = opts.onClick;
      box.onkeydown = function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onClick(); }
      };
    }
    return box;
  }

  function renderStats(now) {
    var box = $("stats");
    box.replaceChildren();
    if (!S.cards.length) return;
    var s = M.summary(S.cards, now);

    var a = stat("账户总览", String(s.total), "个", null, {
      active: false,
      hint: S.prefs.status !== "all" || S.prefs.provider !== "all" ? "点击显示全部" : "",
      onClick: S.prefs.status !== "all" || S.prefs.provider !== "all" ? function () {
        S.prefs.provider = "all";
        S.prefs.status = "all";
        savePrefs();
        render();
      } : null,
    });
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
    var subTotal = s.total - s.info;
    var usableSub = usable
      ? "充足 " + s.ok + (s.low ? " · 紧张 " + s.low : "") + (s.out ? " · 已耗尽 " + s.out : "")
      : subTotal ? "所有订阅账户均已耗尽或暂停" : "当前仅有 API 余额账户";
    box.appendChild(stat("现在可用", String(usable), "/ " + subTotal, usableSub, {
      active: S.prefs.status === "usable",
      hint: S.prefs.status === "usable" ? "已筛选" : "筛选可用",
      onClick: function () {
        setPref("status", S.prefs.status === "usable" ? "all" : "usable");
      },
    }));

    if (s.nextReset) {
      var d = el("span", "");
      d.textContent = M.userParts(s.nextReset.card).main + " · " + M.windowLabel(s.nextReset.w.name) + " · " + M.fmtClock(s.nextReset.at, now);
      box.appendChild(stat("下一次窗口重置", countdown(s.nextReset.at, "", " 后"), "", d, {
        active: S.prefs.sort === "reset",
        hint: S.prefs.sort === "reset" ? "按重置排序中" : "按重置排序",
        onClick: function () {
          setPref("sort", S.prefs.sort === "reset" ? "status" : "reset");
        },
      }));
    }

    if (s.resets) {
      var rd = s.soonestResetCard ? "最早一张 " + M.fmtDate(s.soonestResetCard.at, now) + " 过期（" + M.userParts(s.soonestResetCard.card).main + "）" : s.resetAccounts + " 个账户";
      box.appendChild(stat("可用重置卡", String(s.resets), "张 · " + s.resetAccounts + " 个账户", rd, {
        active: S.prefs.status === "resets",
        hint: S.prefs.status === "resets" ? "已筛选" : "筛选重置卡",
        onClick: function () {
          setPref("status", S.prefs.status === "resets" ? "all" : "resets");
        },
      }));
    }
  }

  // ---- 渲染：分类与状态筛选栏 -------------------------------------------------

  function chip(label, n, pressed, onclick, color, iconName) {
    var b = el("button", "chip");
    b.type = "button";
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    var ic = iconName ? providerIcon(iconName, "c-ic", function (w) {
      if (!color) return;
      var dotFallback = el("span", "dot");
      dotFallback.style.setProperty("--c", color);
      if (w.parentNode) w.parentNode.replaceChild(dotFallback, w);
    }) : null;
    if (ic) {
      b.appendChild(ic);
    } else if (color) {
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

    // 按智能分组 key 聚合分类（将零散余额 key 合并为「API 余额」分类）
    var groups = {};
    var order = [];
    S.cards.forEach(function (c) {
      var gk = M.groupKey(c);
      if (!groups[gk]) {
        groups[gk] = { cards: [], n: 0 };
        order.push(gk);
      }
      groups[gk].cards.push(c);
      groups[gk].n++;
    });

    var g1 = el("div", "f-group");
    g1.appendChild(el("span", "f-label", "类别"));
    var p1 = el("div", "chips");
    p1.appendChild(chip("全部", S.cards.length, S.prefs.provider === "all", function () { setPref("provider", "all"); }));
    order.forEach(function (gk) {
      var gm = M.groupMeta(gk, groups[gk].cards);
      p1.appendChild(chip(gm.name, groups[gk].n, S.prefs.provider === gk, function () { setPref("provider", gk); }, gm.color, gm.icon));
    });
    if (S.prefs.provider !== "all" && !groups[S.prefs.provider]) S.prefs.provider = "all";
    g1.appendChild(p1);
    box.appendChild(g1);

    box.appendChild(el("span", "sep"));

    var counts = { all: 0, usable: 0, tight: 0, blocked: 0, resets: 0, balance: 0 };
    S.cards.forEach(function (c) {
      counts.all++;
      var st = M.cardStatus(c);
      if (st === "ok" || st === "low") counts.usable++;
      if (st === "low") counts.tight++;
      if (st === "out" || st === "held" || st === "error") counts.blocked++;
      if (st === "info") counts.balance++;
      if (c.resets && c.resets.count > 0) counts.resets++;
    });
    var g2 = el("div", "f-group");
    g2.appendChild(el("span", "f-label", "状态"));
    var p2 = el("div", "chips");
    [["all", "全部"], ["usable", "可用"], ["tight", "紧张"], ["blocked", "耗尽 / 暂停"], ["resets", "有重置卡"]].forEach(function (x) {
      if (x[0] !== "all" && !counts[x[0]] && S.prefs.status !== x[0]) return;
      p2.appendChild(chip(x[1], x[0] === "all" ? null : counts[x[0]], S.prefs.status === x[0], function () { setPref("status", x[0]); }));
    });
    g2.appendChild(p2);
    box.appendChild(g2);

    if (S.prefs.provider !== "all" || S.prefs.status !== "all" || S.prefs.q.trim()) {
      var rst = el("button", "filter-reset", "清除筛选");
      rst.type = "button";
      rst.onclick = function () {
        S.prefs.provider = "all";
        S.prefs.status = "all";
        S.prefs.q = "";
        $("q").value = "";
        syncSearchUI();
        savePrefs();
        render();
      };
      box.appendChild(rst);
    }
  }

  function providerMatch(c, p) {
    if (p === "all") return true;
    return M.groupKey(c) === p || c.provider === p;
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
    var hasCodexResets = S.cards.some(function (c) { return M.canUseReset(c) && needsGatewayKeyForReset(c); });
    if (hasCodexResets && S.who && !S.who.canReset) {
      box.appendChild(el("div", "banner warn",
        "没有找到满权限的 magpie 网关 key，暂时不能在这里使用 Codex 重置卡。请在 magpie「网关 › 网关 key」里新建一把（不要设成只读、不要限制预算/模型/账户），或在本插件选项 gatewayKey 里填写。"));
    }
  }

  // ---- 通用组件：迷你走势、进度条、状态胶囊 ----------------------------------

  function sparkline(points, now) {
    if (!points || points.length < 2) return null;
    var since = now - 48 * 3600e3;
    var pts = points.filter(function (p) { return M.time(p.at) >= since && typeof p.left === "number"; });
    if (pts.length < 3) return null;
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

  function makeMeterBar(w, rem, lvl, pace, cardBlocked, labelText) {
    var bar = el("div", "bar" + (lvl === "out" ? " is-out" : ""));
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(rem)));
    bar.setAttribute("aria-label", labelText + " 剩余");
    var fillCls = "fill " + lvl + (cardBlocked && lvl !== "out" ? " blocked" : "");
    var fill = el("div", fillCls);
    fill.style.width = (w.unlimited ? 100 : rem) + "%";
    bar.appendChild(fill);
    if (pace && rem > 0.5 && M.usedOf(w) > 0) {
      var mark = el("div", "mark");
      mark.style.left = ((1 - pace.elapsed) * 100) + "%";
      mark.title = "按时间匀速使用，此刻应剩 " + M.fmtPct((1 - pace.elapsed) * 100);
      bar.appendChild(mark);
    }
    return bar;
  }

  // 右侧数值只显示精简百分比（避免 174.19 / 7090 挤占窗口名称导致“额...”截断）；具体数值放到副标题行
  function makeValueSpan(w, rem, lvl, cls) {
    var val = el("span", cls || "w-val");
    if (w.unlimited) val.textContent = "不限量";
    else if (w.text && w.display) val.textContent = w.display;
    else {
      val.appendChild(el("small", "", "剩 "));
      val.appendChild(document.createTextNode(M.fmtPct(rem)));
    }
    if (lvl === "out") val.style.color = "var(--red)";
    else if (lvl === "low") val.style.color = "var(--amber)";
    return val;
  }

  function makeResetSpan(w, now) {
    var r = el("span", "reset");
    var hasDisp = !!(w.display && !w.text);
    if (hasDisp) {
      r.appendChild(document.createTextNode("已用 " + w.display));
    }
    var at = M.time(w.resetsAt);
    if (Number.isFinite(at)) {
      if (hasDisp) r.appendChild(document.createTextNode(" · "));
      var cd = countdown(at, "", " 后重置");
      r.appendChild(cd);
      if (!hasDisp) r.appendChild(document.createTextNode(" · " + M.fmtClock(at, now)));
      r.title = (hasDisp ? "已用 " + w.display + " · " : "") + "重置时间 " + new Date(at).toLocaleString();
    } else if (w.unlimited) {
      /* nothing */
    } else if (w.runsOutAt) {
      if (hasDisp) r.appendChild(document.createTextNode(" · "));
      r.appendChild(document.createTextNode(M.fmtClock(M.time(w.runsOutAt), now) + " 到期"));
    } else if (M.usedOf(w) === 0 && M.windowSeconds(w.name)) {
      if (hasDisp) r.appendChild(document.createTextNode(" · "));
      r.appendChild(document.createTextNode("未开始计时"));
    }
    return r;
  }

  function makeStatusPills(c, st, parentEl) {
    var pill = el("span", "pill " + st, STATUS_TEXT[st]);
    if (st === "out" && c.held) pill.title = "额度已耗尽，magpie 暂不向该账户派发请求";
    else if (st === "held") pill.title = "magpie 暂不向该账户派发请求";
    parentEl.appendChild(pill);
    if (c.held && st !== "held" && st !== "out") {
      var hp = el("span", "pill held", "暂停");
      hp.title = "magpie 暂不向该账户派发请求";
      parentEl.appendChild(hp);
    }
  }

  function resetTicketText(resets) {
    if (!resets || !(resets.count > 0)) return "";
    if (resets.byWindow) {
      var ws = [];
      if (resets.fiveHour > 0) ws.push("5h×" + resets.fiveHour);
      if (resets.weekly > 0) ws.push("周×" + resets.weekly);
      if (ws.length) return "重置卡 " + ws.join(" · ");
    }
    return "重置卡 ×" + resets.count;
  }

  function makeResetActionBtn(c, key, label) {
    var ub = el("button", "reset-btn", S.busy["x:" + key] ? "使用中…" : label);
    ub.type = "button";
    ub.title = "使用一张重置卡";
    var needGwKey = needsGatewayKeyForReset(c) && S.who && !S.who.canReset;
    ub.disabled = !!S.busy["x:" + key] || !!needGwKey;
    if (needGwKey) ub.title = "需要满权限的网关 key";
    ub.onclick = function () { askReset(c); };
    return ub;
  }

  // ---- 渲染：卡片视图 ---------------------------------------------------------

  function windowRow(item, card, now, hist, uniqueNames, cardBlocked) {
    var w = item.w;
    var rem = M.remainingOf(w);
    var lvl = M.level(rem);
    var row = el("div", "w");
    var labelText = item.label || M.windowLabel(w.name);

    var label = el("span", "w-label", labelText);
    label.title = String(w.name || "") + (item.aside ? "（附加配额，不影响主模型可用状态）" : "");
    row.appendChild(label);

    var pace = w.unlimited ? null : M.paceOf(w, now);
    row.appendChild(makeMeterBar(w, rem, lvl, pace, cardBlocked, labelText));
    row.appendChild(makeValueSpan(w, rem, lvl, "w-val"));

    var meta = el("div", "w-meta");
    var r = makeResetSpan(w, now);
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
    head.appendChild(providerAvatar(meta));

    var id = el("div", "c-id");
    var nm = el("div", "c-name");
    var parts = M.userParts(c);
    var nameSpan = el("span", "txt", parts.main);
    nameSpan.title = "点击复制账户标识：" + M.displayName(c);
    nameSpan.onclick = function () { copyText(c.user || M.displayName(c), parts.main); };
    nm.appendChild(nameSpan);
    if (c.plan) nm.appendChild(el("span", "tag", c.plan));
    if (c.seat) nm.appendChild(el("span", "tag", c.seat));
    id.appendChild(nm);

    var subLine = el("div", "c-user");
    var sub = [meta.name];
    if (parts.rest) sub.push(parts.rest);
    if (c.from) sub.push("来自 " + c.from);
    subLine.appendChild(el("span", "", sub.join(" · ")));
    parts.badges.forEach(function (b) { subLine.appendChild(el("span", "tag hash", "#" + b)); });
    id.appendChild(subLine);
    head.appendChild(id);

    makeStatusPills(c, st, head);

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
      var cardBlocked = st === "out" || st === "held";
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
        g.items.forEach(function (it) { target.appendChild(windowRow(it, c, now, hist, unique, cardBlocked)); });
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
      var tk = el("span", "ticket" + (Number.isFinite(first) && first - now < 3 * 86400e3 ? " soon" : ""), resetTicketText(c.resets));
      tk.title = rc.map(function (x, i) {
        var wl = M.resetWindowLabel(x.window);
        return "第 " + (i + 1) + " 张" + (wl ? "（" + wl + "）" : "") + "：" + (x.until ? new Date(x.until).toLocaleString() + " 过期" : "不过期");
      }).join("\n") || "";
      rs.appendChild(tk);
      if (Number.isFinite(first)) rs.appendChild(el("span", "", "最早 " + M.fmtDate(first, now) + " 过期"));
      if (M.canUseReset(c)) {
        rs.appendChild(makeResetActionBtn(c, key, "使用重置卡"));
      } else if (M.isRemote(c)) {
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

  // ---- 渲染：列表视图 (.l-table & .l-row) ------------------------------------

  function listWindowCell(item, poolTitle, cardBlocked, now) {
    var w = item.w;
    var rem = M.remainingOf(w);
    var lvl = M.level(rem);
    var pace = w.unlimited ? null : M.paceOf(w, now);
    var labelText = (poolTitle ? poolTitle + " · " : "") + (item.label || M.windowLabel(w.name));

    var cell = el("div", "lw");
    var top = el("div", "lw-top");
    var lb = el("span", "lw-label", labelText);
    lb.title = String(w.name || "") + (item.aside ? "（附加配额，不影响主模型可用状态）" : "");
    top.appendChild(lb);
    top.appendChild(makeValueSpan(w, rem, lvl, "lw-val"));
    cell.appendChild(top);

    cell.appendChild(makeMeterBar(w, rem, lvl, pace, cardBlocked, labelText));

    var sub = el("div", "lw-sub");
    sub.appendChild(makeResetSpan(w, now));
    if (pace && rem > 0.5 && pace.ahead > 0.15) {
      var p = el("span", "pace fast", "偏快");
      p.title = "窗口时间过去 " + M.fmtPct(pace.elapsed * 100) + "，额度已用 " + M.fmtPct(pace.used * 100);
      sub.appendChild(p);
    }
    if (sub.textContent || sub.childNodes.length > 1) cell.appendChild(sub);
    return cell;
  }

  function renderTableRow(c, now) {
    var meta = M.providerMeta(c);
    var st = M.cardStatus(c);
    var key = M.cardKey(c);
    var parts = M.userParts(c);
    var row = el("div", "l-row");
    row.dataset.status = st;

    // 1. 账户列
    var acct = el("div", "l-acct");
    acct.appendChild(providerAvatar(meta));

    var info = el("div", "l-acct-info");
    var top = el("div", "l-acct-top");
    var nameSpan = el("span", "txt", parts.main);
    nameSpan.title = "点击复制账户标识：" + M.displayName(c);
    nameSpan.onclick = function () { copyText(c.user || M.displayName(c), parts.main); };
    top.appendChild(nameSpan);
    if (c.plan) top.appendChild(el("span", "tag", c.plan));
    if (c.seat) top.appendChild(el("span", "tag", c.seat));
    info.appendChild(top);

    var subLine = el("div", "l-acct-sub");
    var subParts = [meta.name];
    if (parts.rest) subParts.push(parts.rest);
    if (c.from) subParts.push("来自 " + c.from);
    subLine.appendChild(el("span", "", subParts.join(" · ")));
    parts.badges.forEach(function (b) { subLine.appendChild(el("span", "tag hash", "#" + b)); });
    info.appendChild(subLine);
    acct.appendChild(info);
    row.appendChild(acct);

    // 2. 状态列
    var stCol = el("div", "l-status");
    var pillWrap = el("div", "l-meta-row");
    makeStatusPills(c, st, pillWrap);
    stCol.appendChild(pillWrap);
    if (st === "out") {
      var av2 = M.availableAt(c);
      if (av2 && av2 > now) {
        var rec = el("div", "l-status-sub");
        rec.appendChild(countdown(av2, "", " 后恢复"));
        rec.title = "恢复可用时间：" + M.fmtClock(av2, now);
        stCol.appendChild(rec);
      }
    }
    row.appendChild(stCol);

    // 3. 额度窗口列
    var winsCol = el("div", "l-wins");
    if (c.error) {
      winsCol.appendChild(el("div", "errbox", c.error));
    }
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
        if (spk) { spk.setAttribute("width", "88"); spk.setAttribute("height", "22"); bal.appendChild(spk); }
      }
      winsCol.appendChild(bal);
    }
    var groups = M.groupWindows(c);
    if (groups.length) {
      var cardBlocked = st === "out" || st === "held";
      var primaryGrid = el("div", "l-wins-grid");
      groups.forEach(function (g, gi) {
        if (!g.collapsed) {
          var poolTitle = groups.length > 1 ? g.title : "";
          g.items.forEach(function (it) {
            primaryGrid.appendChild(listWindowCell(it, poolTitle, cardBlocked, now));
          });
        } else {
          var det = el("details", "wgroup");
          if (S.busy["open:" + key + ":" + gi]) det.open = true;
          det.addEventListener("toggle", function () { S.busy["open:" + key + ":" + gi] = det.open; });
          det.appendChild(el("summary", "", g.title + "（" + g.items.length + "）"));
          var subGrid = el("div", "l-wins-grid");
          subGrid.style.marginTop = "6px";
          g.items.forEach(function (it) {
            subGrid.appendChild(listWindowCell(it, "", cardBlocked, now));
          });
          det.appendChild(subGrid);
          winsCol.appendChild(det);
        }
      });
      var primaryCount = primaryGrid.childNodes.length;
      if (primaryCount) {
        if (primaryCount === 3) primaryGrid.dataset.cols = "3";
        winsCol.insertBefore(primaryGrid, winsCol.firstChild);
      }
    } else if (!c.balance && !c.error) {
      winsCol.appendChild(el("div", "l-acct-sub", "没有可显示的额度窗口"));
    }
    row.appendChild(winsCol);

    // 4. 重置卡 / 订阅列
    var metaCol = el("div", "l-meta");
    var rc = M.resetCards(c);
    if (c.resets && c.resets.count > 0) {
      var rRow = el("div", "l-meta-row");
      var first = rc[0] ? M.time(rc[0].until) : M.time(c.resets.until);
      var tk = el("span", "ticket" + (Number.isFinite(first) && first - now < 3 * 86400e3 ? " soon" : ""), resetTicketText(c.resets));
      tk.title = rc.map(function (x, i) {
        var wl = M.resetWindowLabel(x.window);
        return "第 " + (i + 1) + " 张" + (wl ? "（" + wl + "）" : "") + "：" + (x.until ? new Date(x.until).toLocaleString() + " 过期" : "不过期");
      }).join("\n") || "";
      rRow.appendChild(tk);
      if (Number.isFinite(first)) rRow.appendChild(el("span", "", M.fmtDate(first, now) + " 过期"));
      metaCol.appendChild(rRow);
    }
    var until = M.time(c.until);
    if (Number.isFinite(until)) {
      var days = Math.ceil((until - now) / 86400e3);
      var u = el("div", "sub-exp", (days < 0 ? "订阅已于 " : "订阅 ") + M.fmtDate(until, now) + (days < 0 ? " 到期" : " 到期（" + days + " 天）"));
      if (days >= 0 && days <= 7) u.style.color = "var(--amber)";
      if (days < 0) u.style.color = "var(--red)";
      metaCol.appendChild(u);
    }
    var read = M.time(c.readAt || c.asOf);
    if (Number.isFinite(read)) {
      var rd = el("div", "");
      rd.appendChild(document.createTextNode("读取于 "));
      rd.appendChild(ago(read));
      rd.title = new Date(read).toLocaleString();
      metaCol.appendChild(rd);
    }
    row.appendChild(metaCol);

    // 5. 操作列
    var acts = el("div", "l-acts");
    if (M.canUseReset(c)) {
      acts.appendChild(makeResetActionBtn(c, key, "重置卡"));
    }
    var rb2 = el("button", "icon");
    rb2.type = "button";
    rb2.title = M.isRemote(c) ? "这张卡片来自另一台 magpie，只能在那里刷新" : "重新读取这个账户的额度";
    rb2.setAttribute("aria-label", "刷新 " + M.displayName(c));
    rb2.appendChild(refreshIcon());
    if (S.busy["r:" + key]) rb2.classList.add("busy");
    rb2.disabled = M.isRemote(c) || !!S.busy["r:" + key] || S.refreshingAll;
    rb2.onclick = function () { refreshOne(c); };
    acts.appendChild(rb2);
    row.appendChild(acts);

    return row;
  }

  function makeTableHeader() {
    var thead = el("div", "l-thead");
    function sortTh(label, sortKey, fallbackKey) {
      var active = S.prefs.sort === sortKey || (fallbackKey && S.prefs.sort === fallbackKey);
      var th = el("div", "l-th sortable" + (active ? " sorted" : ""));
      th.appendChild(el("span", "", label));
      if (active) th.appendChild(el("span", "", "▾"));
      th.onclick = function () {
        if (sortKey === "risk" && S.prefs.sort === "risk") setPref("sort", "roomy");
        else setPref("sort", sortKey);
      };
      return th;
    }
    thead.appendChild(sortTh("账户", "name"));
    thead.appendChild(sortTh("状态", "status"));
    thead.appendChild(sortTh(S.prefs.sort === "roomy" ? "额度窗口（剩余最多）" : S.prefs.sort === "risk" ? "额度窗口（剩余最少）" : "额度窗口 / 重置时间", "risk", "roomy"));
    thead.appendChild(sortTh("重置卡 / 订阅", "reset"));
    thead.appendChild(el("div", "l-th right", "操作"));
    return thead;
  }

  // ---- 渲染：列表与分组容器（列表视图仅显示一次表头） -------------------------

  function makeGroupBadges(cs, now) {
    var gs = M.summary(cs, now);
    var badges = el("div", "section-badges");
    if (gs.ok) badges.appendChild(el("span", "s-badge ok", "可用 " + gs.ok));
    if (gs.low) badges.appendChild(el("span", "s-badge low", "紧张 " + gs.low));
    if (gs.out + gs.held) badges.appendChild(el("span", "s-badge out", "耗尽 " + (gs.out + gs.held)));
    if (gs.resets) badges.appendChild(el("span", "s-badge ticket", "重置卡 ×" + gs.resets));
    return badges;
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
      return providerMatch(c, S.prefs.provider) && statusMatch(c, S.prefs.status) && M.matches(c, q);
    });
    list = M.sortCards(list, S.prefs.sort, now);
    if (!list.length) {
      var n = el("div", "empty");
      n.appendChild(el("b", "", "没有符合筛选条件的账户"));
      var clr = el("button", "", "清除筛选");
      clr.type = "button";
      clr.onclick = function () {
        S.prefs.provider = "all";
        S.prefs.status = "all";
        S.prefs.q = "";
        $("q").value = "";
        syncSearchUI();
        savePrefs();
        render();
      };
      n.appendChild(clr);
      box.appendChild(n);
      return;
    }

    // 整理分组：零散余额 key 自动归入「API 余额」组
    var groups = {};
    var order = [];
    list.forEach(function (c) {
      var gk = M.groupKey(c);
      if (!groups[gk]) { groups[gk] = []; order.push(gk); }
      groups[gk].push(c);
    });
    // 把 API 余额组排在订阅与套餐之后
    order.sort(function (a, b) {
      return (a === "kind:balance" ? 1 : 0) - (b === "kind:balance" ? 1 : 0);
    });

    // 列表视图：全页共用一个表头，分组以内嵌分组带展示，避免多个单行小表重复表头
    if (S.prefs.view === "list") {
      var table = el("div", "l-table");
      table.appendChild(makeTableHeader());
      if (!S.prefs.group || order.length <= 1) {
        list.forEach(function (c) { table.appendChild(renderTableRow(c, now)); });
      } else {
        order.forEach(function (gk) {
          var cs = groups[gk];
          var gm = M.groupMeta(gk, cs);
          var grp = el("div", "l-group" + (S.collapsedGroups[gk] ? " collapsed" : ""));
          var gh = el("div", "l-group-head");
          gh.setAttribute("role", "button");
          gh.setAttribute("tabindex", "0");
          gh.title = "点击展开 / 折叠分组";
          gh.appendChild(el("span", "chev", "▾"));
          gh.appendChild(groupIcon(gm));
          gh.appendChild(el("h2", "", gm.name));
          gh.appendChild(el("span", "n", cs.length + " 个账户"));
          gh.appendChild(makeGroupBadges(cs, now));
          var toggle = function () {
            S.collapsedGroups[gk] = !S.collapsedGroups[gk];
            grp.classList.toggle("collapsed", !!S.collapsedGroups[gk]);
          };
          gh.onclick = toggle;
          gh.onkeydown = function (ev) {
            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
          };
          grp.appendChild(gh);
          var gBody = el("div", "l-group-body");
          cs.forEach(function (c) { gBody.appendChild(renderTableRow(c, now)); });
          grp.appendChild(gBody);
          table.appendChild(grp);
        });
      }
      box.appendChild(table);
      return;
    }

    // 卡片视图
    if (!S.prefs.group) {
      var grid = el("div", "grid");
      list.forEach(function (c) { grid.appendChild(renderCard(c, now)); });
      box.appendChild(grid);
      return;
    }
    order.forEach(function (gk) {
      var cs = groups[gk];
      var gm = M.groupMeta(gk, cs);
      var sec = el("section", "section" + (S.collapsedGroups[gk] ? " collapsed" : ""));
      var h = el("div", "section-head");
      h.setAttribute("role", "button");
      h.setAttribute("tabindex", "0");
      h.title = "点击展开 / 折叠分组";
      h.appendChild(el("span", "chev", "▾"));
      h.appendChild(groupIcon(gm));
      h.appendChild(el("h2", "", gm.name));
      h.appendChild(el("span", "n", cs.length + " 个账户"));
      h.appendChild(makeGroupBadges(cs, now));
      h.appendChild(el("span", "grow"));
      var toggle = function () {
        S.collapsedGroups[gk] = !S.collapsedGroups[gk];
        sec.classList.toggle("collapsed", !!S.collapsedGroups[gk]);
      };
      h.onclick = toggle;
      h.onkeydown = function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
      };
      sec.appendChild(h);
      var body = el("div", "section-body");
      var grid2 = el("div", "grid");
      cs.forEach(function (c) { grid2.appendChild(renderCard(c, now)); });
      body.appendChild(grid2);
      sec.appendChild(body);
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
    $("viewCard").setAttribute("aria-pressed", S.prefs.view !== "list" ? "true" : "false");
    $("viewList").setAttribute("aria-pressed", S.prefs.view === "list" ? "true" : "false");
    if ($("sort").value !== S.prefs.sort) $("sort").value = S.prefs.sort;
  }

  function render() {
    if ($("modal").dataset.lock === "1") { S.pending = true; return; }
    var now = Date.now();
    var y = document.body.scrollTop || window.scrollY;
    renderHeader();
    renderStats(now);
    renderFilters();
    renderBanner();
    renderList(now);
    document.body.scrollTop = y;
    if (window.scrollY !== y) window.scrollTo(0, y);
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
    var meta = M.providerMeta(c);
    var cards = M.resetCards(c);
    var byWin = !!(c.resets && c.resets.byWindow);
    var m = $("modal");
    m.replaceChildren();
    m.dataset.lock = "1";
    var d = el("div", "dialog");
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.appendChild(el("h3", "", "使用 " + meta.name + " 重置卡？"));

    if (byWin) {
      d.appendChild(el("p", "", who + " 当前有 " + c.resets.count + " 张重置卡。使用周额度重置卡会立即重置 7 天窗口并同步重置 5 小时窗口；使用 5 小时重置卡仅重置 5 小时窗口。此操作无法撤销。"));
    } else {
      d.appendChild(el("p", "", who + " 有 " + c.resets.count + " 张重置卡。使用一张后，它的所有窗口会立即重新开始计算，就像从没用过一样。此操作无法撤销。"));
    }

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

    if (!M.primaryWindows(c).some(function (w) { return M.usedOf(w) > 0; })) {
      d.appendChild(el("p", "warn", "它的主窗口都还没有消耗额度，现在使用可能不会产生效果。"));
    }

    var chosenIdx = 0;
    var note = el("p", "warn");
    note.hidden = true;
    if (cards.length > 1) {
      d.appendChild(el("p", "", "选择要使用的重置卡："));
      var opts = el("div", "opts");
      cards.forEach(function (x, i) {
        var lab = el("label", "opt");
        var inp = el("input");
        inp.type = "radio";
        inp.name = "credit";
        inp.value = String(i);
        inp.checked = i === 0;
        inp.onchange = function () {
          chosenIdx = i;
          var firstUntil = M.time(cards[0].until);
          note.hidden = i === 0 || !Number.isFinite(firstUntil);
          note.textContent = "最早过期的那张（" + M.fmtClock(firstUntil, now) + "）会保留，到期前没用掉就作废。";
        };
        lab.appendChild(inp);
        var u = M.time(x.until);
        var wl = M.resetWindowLabel(x.window);
        lab.appendChild(el("span", "", "第 " + (i + 1) + " 张" + (wl ? "（" + wl + "）" : "") + " · " + (Number.isFinite(u) ? M.fmtClock(u, now) + " 过期" : "不过期")));
        if (i === 0) lab.appendChild(el("span", "note", "默认（最早过期）"));
        opts.appendChild(lab);
      });
      d.appendChild(opts);
    } else if (cards[0]) {
      var wl0 = M.resetWindowLabel(cards[0].window);
      var u0 = M.time(cards[0].until);
      d.appendChild(el("p", "", "将使用" + (wl0 ? "「" + wl0 + "」重置卡" : "最早过期的一张") + (Number.isFinite(u0) ? "（" + M.fmtClock(u0, now) + " 过期）" : "") + "。"));
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
      var picked = cards[chosenIdx] || {};
      var body = {
        provider: c.provider || "codex",
        user: c.user || "",
        byWindow: byWin,
      };
      if (picked.id && cards.length > 1 && chosenIdx > 0) body.credit = picked.id;
      if (picked.window) body.window = picked.window;
      if (picked.until) body.until = picked.until;
      api("POST", "api/reset", body).then(function (j) {
        if (j.cards) takeCards(j);
        var code = j.outcome && j.outcome.code;
        toast(who + "：" + M.resetOutcome(j.outcome), code === "reset" ? "ok" : "err");
        loadHistory();
      }, function (e) {
        toast(who + "：未能使用重置卡 — " + e.message, "err");
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
  setInterval(function () {
    if (!S.visible || sessionLost) return;
    load();
    if (Date.now() - histAt > 5 * 60e3) loadHistory();
  }, 60e3);

  // ---- 启动与快捷键 -----------------------------------------------------------

  function syncSearchUI() {
    var has = !!$("q").value;
    $("clearQ").hidden = !has;
    $("qHint").hidden = has;
  }

  $("refreshAll").onclick = refreshAll;
  $("sort").onchange = function () { setPref("sort", $("sort").value); };
  $("groupBtn").onclick = function () { setPref("group", !S.prefs.group); };
  $("viewCard").onclick = function () { setPref("view", "card"); };
  $("viewList").onclick = function () { setPref("view", "list"); };
  $("clearQ").onclick = function () {
    $("q").value = "";
    S.prefs.q = "";
    syncSearchUI();
    render();
    $("q").focus();
  };

  var qTimer = 0;
  $("q").oninput = function () {
    syncSearchUI();
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { S.prefs.q = $("q").value; render(); }, 100);
  };
  $("q").onkeydown = function (e) {
    if (e.key === "Escape") {
      if ($("q").value) {
        e.preventDefault();
        $("q").value = "";
        S.prefs.q = "";
        syncSearchUI();
        render();
      } else {
        $("q").blur();
      }
    }
  };

  document.addEventListener("keydown", function (e) {
    if (!$("modal").hidden) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      $("q").focus();
    } else if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      setPref("view", S.prefs.view === "list" ? "card" : "list");
    } else if (e.key === "g" || e.key === "G") {
      e.preventDefault();
      setPref("group", !S.prefs.group);
    }
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
    if (p.view === "list" || p.view === "card") S.prefs.view = p.view;
  }, function () {}).then(function () {
    return load();
  }).then(function () {
    if (!sessionLost) loadHistory();
  });
})();
